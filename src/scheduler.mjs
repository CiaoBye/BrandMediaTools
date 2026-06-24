import { crawlXhs, searchXhs, followAccount } from "./xhsCrawler.mjs";
import { persistNoteAssets } from "./downloader.mjs";
import { checkCookieValid, decryptCookie, resolveCookie } from "./xhsAuth.mjs";
import { sendWebhook } from "./webhook.mjs";

let timer = null;
let lastHealthCheck = 0;
let running = false;

import { beijingNow as now } from "./time.mjs";

function addMinutes(dateStr, minutes) {
  const d = new Date(dateStr);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

async function checkAccountHealth(rootDir, storage) {
  try {
    const accounts = storage.listXhsAccounts();
    for (const account of accounts) {
      if (!account.status || account.status === "未知") continue;
      const full = storage.getXhsAccount(account.id);
      if (!full || !full.cookie_encrypted) continue;
      const cookie = decryptCookie(full.cookie_encrypted, rootDir);
      const valid = (await checkCookieValid(rootDir, cookie)).valid;
      const newStatus = valid ? "有效" : "无效";
      if (newStatus !== account.status) {
        storage.upsertXhsAccount({ name: account.name, status: newStatus, lastCheckAt: now() });
        if (!valid) {
          storage.createNotification({
            type: "account_expired",
            title: `账号「${account.name}」Cookie 已失效`,
            message: `请重新扫码登录或更新 Cookie`,
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

export async function runSchedulerCycle(rootDir, storage, options = {}) {
    if (running) return { skipped: true, reason: "上一轮尚未完成" };
    running = true;
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
              try { knownNoteIds = JSON.parse(followed.last_cursor); } catch { knownNoteIds = []; }
              if (!Array.isArray(knownNoteIds)) knownNoteIds = [];
            }
            const result = await followFn({ userId, knownNoteIds, brand: task.config.brand }, { rootDir, cookie });
            let newCount = 0;
            for (const note of result.notes) {
              const existing = storage.findNoteBySourceUrl(note.sourceUrl);
              if (!existing) {
                const saved = storage.upsertNote(note);
                const assets = await persistFn(rootDir, { ...note, id: saved.id, collectedAt: saved.collectedAt });
                storage.addAssets(saved.id, assets);
                newCount++;
              }
            }
            const updated = storage.upsertFollowedAccount({
              userId,
              authorName: result.authorName,
              avatarUrl: result.avatarUrl,
              authorUrl: task.config.authorUrl || "",
              brand: task.config.brand || "",
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
          const nextRun = task.interval_minutes > 0 ? addMinutes(now(), task.interval_minutes) : "";
          storage.updateScheduledTask(task.id, { status: "失败", nextRunAt: nextRun, lastRunAt: now() });
          storage.finishTaskLog(logId, "失败", error.message);
        }
      }
      return { skipped: false, processedTasks };
    } catch (e) {
      console.error("[scheduler] 主循环错误:", e.message);
      return { skipped: false, processedTasks, error: e.message };
    } finally { running = false; }
}

export function startScheduler(rootDir, storage) {
  if (timer) return;
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
