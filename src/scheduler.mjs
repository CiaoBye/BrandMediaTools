import { crawlXhs, searchXhs, followAccount, saveXhsCookieFromBrowser } from "./xhsCrawler.mjs";
import { persistNoteAssets } from "./downloader.mjs";
import { checkCookieValid, decryptCookie, encryptCookie, readXhsCookie, resolveCookie } from "./xhsAuth.mjs";
import { sendWebhook } from "./webhook.mjs";
import { envWithSettings } from "./settings.mjs";

let timer = null;
let lastHealthCheck = 0;
const _runningTasks = new Set(); // 任务级粒度锁，允许不同任务并发执行

import { beijingNow as now } from "./time.mjs";

function addMinutes(dateStr, minutes) {
  const d = new Date(dateStr);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

function recoverStaleRunningState(storage) {
  try {
    storage.db.prepare(`
      UPDATE task_logs
      SET status = '失败',
          message = message || '（服务重启时自动结束残留运行状态）',
          finished_at = ?
      WHERE status = '运行中' AND finished_at IS NULL
    `).run(now());
    storage.db.prepare(`
      UPDATE scheduled_tasks
      SET status = '等待中', updated_at = ?
      WHERE status = '运行中'
    `).run(now());
  } catch (error) {
    console.warn("[scheduler] 恢复残留运行状态失败:", error.message);
  }
}

async function checkAccountHealth(rootDir, storage) {
  try {
    const settings = envWithSettings(rootDir);
    const accounts = storage.listXhsAccounts();
    for (const account of accounts) {
      if (!account.status || account.status === "未知") continue;
      const full = storage.getXhsAccount(account.id);
      if (!full || !full.cookie_encrypted) continue;
      const cookie = decryptCookie(full.cookie_encrypted, rootDir);
      let check = await checkCookieValid(rootDir, cookie);
      if (!check.valid && settings.xhs.autoRefreshCookie !== false) {
        try {
          const refresh = await saveXhsCookieFromBrowser(rootDir, {
            waitMs: Number(settings.xhs.cookieRefreshWaitMs || 8000),
            proxy: settings.xhs.proxy || "",
            interactive: false
          });
          const refreshedCookie = readXhsCookie(rootDir);
          const refreshedCheck = await checkCookieValid(rootDir, refreshedCookie);
          const canAssignToAccount = accounts.length === 1 || (refresh.nickname && refresh.nickname === account.name);
          if (refreshedCheck.valid && refreshedCookie && canAssignToAccount) {
            check = refreshedCheck;
            storage.upsertXhsAccount({
              name: account.name,
              cookieEncrypted: encryptCookie(refreshedCookie, rootDir),
              status: "有效",
              lastCheckAt: now(),
              lastUsedAt: now()
            });
          }
        } catch (refreshError) {
          console.warn("[scheduler] 自动刷新 Cookie 未完成:", refreshError.message);
        }
      }
      if (check.valid && check.cookieUpdated && check.cookieUpdated !== cookie) {
        storage.upsertXhsAccount({
          name: account.name,
          cookieEncrypted: encryptCookie(check.cookieUpdated, rootDir),
          status: "有效",
          lastCheckAt: now(),
          lastUsedAt: now()
        });
      }
      const valid = check.valid;
      const newStatus = valid ? "有效" : "无效";
      if (newStatus !== account.status) {
        storage.upsertXhsAccount({ name: account.name, status: newStatus, lastCheckAt: now() });
        if (!valid) {
          storage.createNotification({
            type: "account_expired",
            title: `账号「${account.name}」Cookie 已失效`,
            message: `请重新打开专用浏览器绑定或更新完整 Cookie`,
            level: "error",
            relatedId: account.id
          });
        }
      } else {
        storage.upsertXhsAccount({ name: account.name, lastCheckAt: now() });
      }
    }
  } catch (e) { console.error("[scheduler] 账号健康检查失败:", e.message); }
}

async function refreshAuthForTask(rootDir, storage, task) {
  const settings = envWithSettings(rootDir);
  if (settings.xhs.autoRefreshCookie === false) return { ok: false, reason: "后台刷新已关闭" };
  try {
    const refresh = await saveXhsCookieFromBrowser(rootDir, {
      waitMs: Number(settings.xhs.cookieRefreshWaitMs || 8000),
      proxy: settings.xhs.proxy || "",
      interactive: false
    });
    const refreshedCookie = readXhsCookie(rootDir);
    const refreshedCheck = await checkCookieValid(rootDir, refreshedCookie);
    if (!refreshedCheck.valid || !refreshedCookie) {
      return { ok: false, reason: refreshedCheck.reason || "专用浏览器不是有效登录态" };
    }

    const accounts = storage.listXhsAccounts();
    let account = task.account_id ? storage.getXhsAccount(task.account_id) : null;
    if (!account && accounts.length === 1) account = accounts[0];
    const canAssign = account && (accounts.length === 1 || refresh.nickname === account.name || refreshedCheck.nickname === account.name);
    if (canAssign) {
      storage.upsertXhsAccount({
        name: account.name,
        cookieEncrypted: encryptCookie(refreshedCookie, rootDir),
        status: "有效",
        lastCheckAt: now(),
        lastUsedAt: now()
      });
    }
    return { ok: true, accountUpdated: Boolean(canAssign), nickname: refresh.nickname || refreshedCheck.nickname || "" };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function runSchedulerCycle(rootDir, storage, options = {}) {
    let processedTasks = 0;
    try {
      const crawlFn = options.crawlXhs || crawlXhs;
      const searchFn = options.searchXhs || searchXhs;
      const followFn = options.followAccount || followAccount;
      const persistFn = options.persistNoteAssets || persistNoteAssets;
      // Account health check every 2 hours
      const twoHoursMs = 2 * 60 * 60 * 1000;
      if (!options.skipHealthCheck && Date.now() - lastHealthCheck > twoHoursMs) {
        lastHealthCheck = Date.now();
        await checkAccountHealth(rootDir, storage);
      }

      const tasks = storage.getDueTasks();
      for (const task of tasks) {
        processedTasks++;
        if (_runningTasks.has(task.id)) continue; // 跳过正在运行的任务
        _runningTasks.add(task.id);
        const logId = storage.createTaskLog(task.id, "运行中", `开始执行：${task.name}`);
        try {
          storage.updateScheduledTask(task.id, { status: "运行中", lastRunAt: now() });

          let noteCount = 0;
          if (task.task_type === "crawl" && task.config?.url) {
            let cookie = "";
            if (task.account_id) {
              const account = storage.getXhsAccount(task.account_id);
              if (account?.cookie_encrypted) cookie = decryptCookie(account.cookie_encrypted, rootDir);
            }
            const notes = await crawlFn({ url: task.config.url, tags: task.config.tags || [] }, { rootDir, cookie });
            for (const note of notes) {
              const saved = storage.upsertNote(note);
              const assets = await persistFn(rootDir, { ...note, id: saved.id, collectedAt: saved.collectedAt });
              storage.addAssets(saved.id, assets);
              noteCount++;
            }
          }
          if (task.task_type === "search" && task.config?.keyword) {
            let cookie = "";
            if (task.account_id) {
              const account = storage.getXhsAccount(task.account_id);
              if (account?.cookie_encrypted) cookie = decryptCookie(account.cookie_encrypted, rootDir);
            }
            const result = await searchFn(task.config.keyword, { rootDir, cookie });
            noteCount = result.count || 0;
          }
          if (task.task_type === "follow" && (task.config?.userId || task.config?.authorUrl)) {
            let cookie = "";
            if (task.account_id) {
              const account = storage.getXhsAccount(task.account_id);
              if (account?.cookie_encrypted) cookie = decryptCookie(account.cookie_encrypted, rootDir);
            }
            if (!cookie || cookie.length < 30) {
              cookie = resolveCookie(rootDir, storage);
            }
            const { extractXhsId } = await import("./xhsSdk.mjs");
            const userId = task.config.userId || extractXhsId(task.config.authorUrl || "");
            if (!userId) throw new Error("无法解析账号 ID");
            const followed = storage.getFollowedAccountByUserId(userId);
            let knownNoteIds = [];
            if (followed?.last_cursor) {
              try {
                const parsedIds = JSON.parse(followed.last_cursor);
                if (Array.isArray(parsedIds)) {
                  knownNoteIds = parsedIds.filter(nid => {
                    return !!storage.findNoteByNoteId(nid);
                  });
                }
              } catch { knownNoteIds = []; }
            }
            if (followed?.user_id) {
              const dbKnownNoteIds = storage.listNotes({ authorId: followed.user_id })
                .map((note) => note.noteId || extractXhsId(note.sourceUrl || ""))
                .filter(Boolean);
              knownNoteIds = Array.from(new Set([...knownNoteIds, ...dbKnownNoteIds]));
            }
            const result = await followFn({ userId, knownNoteIds, brand: task.config.brand }, { rootDir, cookie });
            let newCount = 0;
            for (const note of result.notes) {
              const noteId = note.noteId || extractXhsId(note.sourceUrl || "");
              const existing = noteId ? storage.findNoteByNoteId(noteId) : storage.findNoteBySourceUrl(note.sourceUrl);
              if (!existing) {
                const saved = storage.upsertNote(note);
                const assets = await persistFn(rootDir, { ...note, id: saved.id, collectedAt: saved.collectedAt });
                storage.addAssets(saved.id, assets);
                newCount++;
              }
            }
            const updated = storage.upsertFollowedAccount({
              userId,
              authorName: result.authorName || followed?.author_name || "",
              avatarUrl: result.avatarUrl || followed?.avatar_url || "",
              authorUrl: task.config.authorUrl || followed?.author_url || "",
              brand: task.config.brand || followed?.brand || "",
              lastCursor: result.cursor || "",
              lastCheckAt: now(),
              totalFound: result.totalFound
            });
            if (updated) {
              storage.createFollowCheck({
                accountId: updated.id,
                newNotes: newCount,
                totalNotes: result.totalFound
              });
            }
            noteCount = newCount;
            if (newCount > 0) {
              sendWebhook(rootDir, "定时跟随完成", `账号：${result.authorName || task.config.brand || userId}\n新增笔记：${newCount} 条\n总笔记：${result.totalFound} 篇`);
            }
          }

          const nextRun = task.interval_minutes > 0 ? addMinutes(now(), task.interval_minutes) : "";
          storage.updateScheduledTask(task.id, { status: "等待中", nextRunAt: nextRun, lastRunAt: now() });
          storage.finishTaskLog(logId, "成功", `完成，处理 ${noteCount} 条`, noteCount);
        } catch (error) {
          const isCookieError = error.message.includes("Cookie") || error.message.includes("登录") || error.message.includes("会话") || error.message.includes("过期") || error.message.includes("登录已过期");
          if (isCookieError) {
            const refresh = options.skipHealthCheck ? { ok: false, reason: "skip refresh in test mode" } : await refreshAuthForTask(rootDir, storage, task);
            if (refresh.ok) {
              storage.updateScheduledTask(task.id, { status: "等待中", nextRunAt: now(), lastRunAt: now() });
              storage.finishTaskLog(logId, "失败", `Cookie refreshed from dedicated browser profile; task will retry on the next scheduler cycle.${refresh.nickname ? ` account=${refresh.nickname}` : ""}`);
              continue;
            }
            storage.updateScheduledTask(task.id, { status: "暂停", lastRunAt: now() });
            storage.finishTaskLog(logId, "失败", `由于抓取使用的 Cookie 已过期失效，定时任务已自动挂起防风控封禁：${error.message}`);
            sendWebhook(rootDir, "账号掉线自动挂起定时任务", `任务名称：${task.name}\n异常原因：${error.message}\n该任务已被系统自动置为暂停状态以实施安全保护，请登录前端进行 Cookie 重装。`);
            storage.createNotification({
              type: "account_expired",
              title: `定时任务「${task.name}」已自动暂停`,
              message: `检测到抓取 Cookie 已过期。为防止频繁无效访问引发风控已将其挂起。请通过「账号管理」重新登录后恢复任务。`,
              level: "error"
            });
          } else {
            const nextRun = task.interval_minutes > 0 ? addMinutes(now(), task.interval_minutes) : "";
            storage.updateScheduledTask(task.id, { status: "失败", nextRunAt: nextRun, lastRunAt: now() });
            storage.finishTaskLog(logId, "失败", error.message);
          }
        } finally {
          _runningTasks.delete(task.id);
        }
      }
      return { skipped: false, processedTasks };
    } catch (e) {
      console.error("[scheduler] 主循环错误:", e.message);
      return { skipped: false, processedTasks, error: e.message };
    }
}

export function startScheduler(rootDir, storage) {
  if (timer) return;
  recoverStaleRunningState(storage);
  timer = setInterval(() => {
    runSchedulerCycle(rootDir, storage).catch((error) => {
      console.error("[scheduler] 调度轮询失败:", error.message);
    });
  }, 60000);
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function runHealthCheckNow(rootDir, storage) {
  await checkAccountHealth(rootDir, storage);
}
