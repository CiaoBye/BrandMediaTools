import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "./storage.mjs";
import { sendJson, sendText, readBody, serveFile, crawlAndStore, diagnose, getCached, setCached, clearCache, clearCacheByPrefix } from "./server-utils.mjs";
import { crawlXhs, extractXhsUrls, extractPageLinks, isXhsNoteUrl, mergeXhsLinks, openXhsContext, saveXhsCookieFromBrowser, searchXhs, collectComments } from "./xhsCrawler.mjs";
import { sleep, isAccountUrl } from "./xhsSdk.mjs";
import { persistNoteAssets } from "./downloader.mjs";
import { analyzeNote } from "./aiAnalyzer.mjs";
import { parseBool, loadSettings, clearSettingsCache, aiPresets, resolveAiConfig } from "./settings.mjs";
import { analyzeViral, analyzeTitle, analyzeBody } from "./xhsViralAnalysis.mjs";
import { getTitleStats, getBodyStats, getEngagementStats, getVisualStyleStats, getMarketingGoalStats, getContentTypeStats, getAuthorStats, getLibraryStats } from "./contentAnalysis.mjs";
import { generateReport } from "./reportGenerator.mjs";
import { startQrLogin, checkQrLoginStatus, collectQrCookies, cancelQrLogin } from "./xhsLogin.mjs";
import { encryptCookie, decryptCookie, readXhsCookie, resolveCookie, checkCookieValid } from "./xhsAuth.mjs";
import { startScheduler, stopScheduler, runHealthCheckNow } from "./scheduler.mjs";
import { fmtDate } from "./time.mjs";
import { Logger } from "./logger.mjs";
import { sendWebhook } from "./webhook.mjs";
import { startSignServer, stopSignServer } from "./xhsApiClient.mjs";
import { exportForEagle } from "./eagleExporter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const storage = new Storage(rootDir);
const logger = new Logger(rootDir);
const port = Number(process.env.PORT || 4173);

mkdirSync(path.join(rootDir, "data", "library"), { recursive: true });

process.on("unhandledRejection", (reason) => {
  logger.error("未捕获的 Promise 拒绝", reason instanceof Error ? { message: reason.message, stack: reason.stack } : { reason: String(reason) });
});
process.on("uncaughtException", (error) => {
  logger.error("未捕获的异常", { message: error.message, stack: error.stack });
  stopScheduler();
  process.exit(1);
});

const ctx = { rootDir, storage, logger };

const ROUTES = [];

function route(method, pathname, handler) {
  ROUTES.push({ method, pathname, handler });
}

// ===== System =====
route("GET", "/api/health", (req, res) => {
  sendJson(res, 200, { ok: true, name: "小红书品牌内容情报工具" });
});

route("GET", "/api/logs", (req, res, url) => {
  sendJson(res, 200, logger.getLogs(Number(url.searchParams.get("offset")) || 0, Number(url.searchParams.get("limit")) || 200));
});
route("GET", "/api/logs/search", (req, res, url) => {
  const q = url.searchParams.get("q") || "";
  sendJson(res, 200, { lines: q ? logger.search(q) : [] });
});
route("DELETE", "/api/logs", (req, res) => { logger.clear(); sendJson(res, 200, { ok: true }); });

route("GET", "/api/notifications", (req, res) => {
  sendJson(res, 200, { items: storage.listNotifications(), unread: storage.getUnreadNotificationCount() });
});
route("POST", "/api/notifications/read-all", (req, res) => { storage.markAllNotificationsRead(); sendJson(res, 200, { ok: true }); });
route("POST", null, (req, res, url) => {
  const m = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (m && req.method === "POST") { sendJson(res, 200, storage.markNotificationRead(m[1])); return true; }
  return false;
});

route("GET", "/api/jobs", (req, res) => sendJson(res, 200, storage.listJobs()));
route("GET", "/api/brands/recent", (req, res) => sendJson(res, 200, storage.getRecentBrands()));

// ===== Stats & Reports =====
route("GET", "/api/stats", (req, res, url) => {
  const range = url.searchParams.get("range") || "";
  const key = `stats::${range}`;
  let data = getCached(key);
  if (!data) { data = storage.getStats(range); setCached(key, data); }
  sendJson(res, 200, data);
});
route("GET", "/api/stats/interaction", (req, res, url) => {
  const range = url.searchParams.get("range") || "";
  const key = `interaction::${range}`;
  let data = getCached(key);
  if (!data) { data = storage.getInteractionStats(range); setCached(key, data); }
  sendJson(res, 200, data);
});
route("GET", "/api/stats/top-notes", (req, res, url) => sendJson(res, 200, storage.getTopNotes(Number(url.searchParams.get("limit")) || 20, url.searchParams.get("range") || "")));
route("GET", "/api/stats/tag-cloud", (req, res, url) => sendJson(res, 200, storage.getTagCloud(Number(url.searchParams.get("limit")) || 30)));

route("GET", "/api/stats/content-analysis", (req, res, url) => {
  const range = url.searchParams.get("range") || "";
  const key = `content-analysis::${range}`;
  let result = getCached(key);
  if (!result) {
    const notes = storage.listNotes();
    const filtered = range ? notes.filter((n) => {
      const d = n.collectedAt || "";
      if (!d) return false;
      const from = new Date();
      if (range === "7") from.setDate(from.getDate() - 7);
      else if (range === "30") from.setDate(from.getDate() - 30);
      else if (range === "90") from.setDate(from.getDate() - 90);
      else return true;
      return new Date(d) >= from;
    }) : notes;
    result = {
      titleStats: getTitleStats(filtered, analyzeTitle),
      bodyStats: getBodyStats(filtered, analyzeBody),
      engagementStats: getEngagementStats(filtered, (m) => {
        const likes = Number(m.likedCount || m.likeCount || m.likes || 0);
        const comments = Number(m.commentCount || m.comments || 0);
        const collects = Number(m.collectedCount || m.collectCount || m.collects || 0);
        const shares = Number(m.shareCount || m.shares || 0);
        return { likes, comments, collects, shares, total: likes + comments + collects + shares };
      }),
      visualStyle: getVisualStyleStats(filtered), marketingGoals: getMarketingGoalStats(filtered),
      contentTypes: getContentTypeStats(filtered), authors: getAuthorStats(filtered), libraries: getLibraryStats(filtered), totalNotes: filtered.length
    };
    setCached(key, result);
  }
  sendJson(res, 200, result);
});

route("GET", "/api/reports/weekly-brief", (req, res) => {
  const key = "report::weekly";
  let report = getCached(key);
  if (!report) { report = generateReport(storage.listNotes(), "weekly", analyzeTitle); setCached(key, report); }
  sendJson(res, 200, report);
});
route("GET", "/api/reports/monthly-review", (req, res) => {
  const key = "report::monthly";
  let report = getCached(key);
  if (!report) { report = generateReport(storage.listNotes(), "monthly", analyzeTitle); setCached(key, report); }
  sendJson(res, 200, report);
});

// ===== Diagnosis =====
route("GET", "/api/diagnose", async (req, res) => {
  try { sendJson(res, 200, await diagnose(rootDir, storage)); } catch (e) { sendJson(res, 500, { error: e.message }); }
});

// ===== Brand Comparison =====
route("GET", "/api/stats/brand-compare", (req, res) => {
  const notes = storage.listNotes();
  const brands = [...new Set(notes.map(n => n.brand).filter(Boolean))];
  const result = brands.map(brand => {
    const bn = notes.filter(n => n.brand === brand);
    const m = bn.map(n => n.metrics || {});
    const avgLike = bn.length ? Math.round(m.reduce((s, v) => s + Number(v.likedCount || v.likes || 0), 0) / bn.length) : 0;
    const avgComment = bn.length ? Math.round(m.reduce((s, v) => s + Number(v.commentCount || v.comments || 0), 0) / bn.length) : 0;
    const avgCollect = bn.length ? Math.round(m.reduce((s, v) => s + Number(v.collectedCount || v.collects || 0), 0) / bn.length) : 0;
    const videoCount = bn.filter(n => n.contentType === "视频笔记").length;
    const imageCount = bn.filter(n => n.contentType === "图文笔记").length;
    const tags = [...new Set(bn.flatMap(n => n.tags || []).filter(Boolean))].slice(0, 10);
    const hookRate = bn.length ? Math.round(bn.filter(n => n.title && /[？?！!]/.test(n.title)).length / bn.length * 100) : 0;
    const authors = [...new Set(bn.map(n => n.authorName).filter(Boolean))];
    return { brand, totalNotes: bn.length, avgLike, avgComment, avgCollect, videoCount, imageCount, authors, topTags: tags, totalInteractions: avgLike + avgComment + avgCollect };
  }).sort((a, b) => b.totalInteractions - a.totalInteractions);
  sendJson(res, 200, result);
});

// ===== XHS Accounts + QR Login =====
route("GET", "/api/xhs-accounts", (req, res) => sendJson(res, 200, storage.listXhsAccounts()));
route("POST", "/api/xhs-accounts", async (req, res) => {
  const body = await readBody(req);
  const data = {};
  if (body.name) data.name = body.name;
  if (body.cookie) data.cookieEncrypted = encryptCookie(body.cookie, rootDir);
  if (body.status) data.status = body.status;
  sendJson(res, 200, storage.upsertXhsAccount(data));
});
route("DELETE", null, async (req, res, url) => {
  if (req.method === "DELETE" && url.pathname.startsWith("/api/xhs-accounts/")) {
    const id = url.pathname.replace("/api/xhs-accounts/", "");
    const deleted = storage.deleteXhsAccount(id);
    sendJson(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "未找到" });
    return true;
  }
  return false;
});
route("GET", "/api/xhs-accounts/check-cookie", async (req, res, url) => {
  const id = url.searchParams.get("id");
  if (!id) { sendJson(res, 400, { error: "缺少账号 ID" }); return; }
  const account = storage.getXhsAccount(id);
  if (!account || !account.cookie_encrypted) { sendJson(res, 200, { valid: false, reason: "未配置 Cookie" }); return; }
  const cookie = decryptCookie(account.cookie_encrypted, rootDir);
  const check = await checkCookieValid(rootDir, cookie);
  storage.upsertXhsAccount({ name: account.name, status: check.valid ? "有效" : "无效", lastCheckAt: new Date().toISOString() });
  sendJson(res, 200, { ...check, status: check.valid ? "有效" : "无效" });
});
route("POST", "/api/xhs-accounts/check-all", async (req, res) => {
  try { await runHealthCheckNow(rootDir, storage); sendJson(res, 200, { ok: true }); } catch (error) { sendJson(res, 500, { error: error.message }); }
});

route("POST", "/api/auth/qr/start", async (req, res) => {
  const body = await readBody(req);
  try { sendJson(res, 200, await startQrLogin(rootDir, body.accountName || "default", { proxy: body.proxy || "" })); } catch (error) { sendJson(res, 500, { error: error.message }); }
});
route("GET", "/api/auth/qr/status", async (req, res, url) => {
  try { sendJson(res, 200, await checkQrLoginStatus(url.searchParams.get("accountName") || "default")); } catch (error) { sendJson(res, 500, { error: error.message }); }
});
route("POST", "/api/auth/qr/finalize", async (req, res) => {
  const body = await readBody(req);
  const accountName = body.accountName || "default";
  try {
    const result = await collectQrCookies(accountName);
    if (result.ok) {
      const encrypted = encryptCookie(result.cookieString, rootDir);
      const name = result.nickname || accountName;
      storage.upsertXhsAccount({ name, cookieEncrypted: encrypted, status: "有效" });
      try {
        const settings = (await import("./settings.mjs")).envWithSettings(rootDir);
        const cookieFile = path.isAbsolute(settings.xhs.cookieFile) ? settings.xhs.cookieFile : path.join(rootDir, settings.xhs.cookieFile);
        mkdirSync(path.dirname(cookieFile), { recursive: true });
        writeFileSync(cookieFile, result.cookieString, "utf8");
      } catch {}
      sendJson(res, 200, { ok: true, cookieCount: result.cookieCount, accountName: name });
    } else { sendJson(res, 500, { ok: false, error: result.error }); }
  } catch (error) { sendJson(res, 500, { ok: false, error: error.message }); }
});
route("POST", "/api/auth/qr/cancel", async (req, res) => {
  const body = await readBody(req);
  cancelQrLogin(body.accountName || "default");
  sendJson(res, 200, { ok: true });
});

// ===== Scheduled Tasks =====
route("GET", "/api/scheduled-tasks", (req, res) => sendJson(res, 200, storage.listScheduledTasks()));
route("POST", "/api/scheduled-tasks", async (req, res) => {
  sendJson(res, 201, storage.createScheduledTask(await readBody(req)));
});
route("GET", "/api/task-logs", (req, res) => sendJson(res, 200, storage.listTaskLogs()));
route("PUT", null, async (req, res, url) => {
  if (req.method === "PUT" && url.pathname.startsWith("/api/scheduled-tasks/")) {
    sendJson(res, 200, storage.updateScheduledTask(url.pathname.replace("/api/scheduled-tasks/", ""), await readBody(req)));
    return true;
  }
  return false;
});
route("DELETE", null, async (req, res, url) => {
  if (req.method === "DELETE" && url.pathname.startsWith("/api/scheduled-tasks/")) {
    const deleted = storage.deleteScheduledTask(url.pathname.replace("/api/scheduled-tasks/", ""));
    sendJson(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "未找到" });
    return true;
  }
  return false;
});

// ===== Accounts (Competitor) =====
route("GET", "/api/accounts", (req, res) => sendJson(res, 200, storage.listAccounts()));
route("POST", "/api/accounts", async (req, res) => {
  const created = storage.createAccount(await readBody(req));
  logger.info("新增竞品账号", { brand: created.brand, accountName: created.account_name });
  sendJson(res, 201, created);
});
route("PUT", null, async (req, res, url) => {
  if (req.method === "PUT" && url.pathname.startsWith("/api/accounts/") && !url.pathname.endsWith("/follow")) {
    const id = url.pathname.replace("/api/accounts/", "");
    const body = await readBody(req);
    const updated = storage.updateAccount(id, body);
    if (!updated) { sendJson(res, 404, { error: "未找到账号" }); return true; }
    logger.info("更新竞品账号", { id, brand: updated.brand });
    sendJson(res, 200, updated);
    return true;
  }
  return false;
});
route("DELETE", null, async (req, res, url) => {
  if (req.method === "DELETE" && url.pathname.startsWith("/api/accounts/") && !url.pathname.endsWith("/follow")) {
    const id = url.pathname.replace("/api/accounts/", "");
    const account = storage.getAccount(id);
    if (!account) { sendJson(res, 404, { error: "未找到" }); return true; }
    storage.deleteAccount(id);
    if (account?.account_url) {
      const userId = account.account_url.match(/user\/profile\/([^/?]+)/)?.[1];
      if (userId) {
        const f = storage.getFollowedAccountByUserId(userId);
        if (f) storage.deleteFollowedAccount(f.id);
        deleteFollowTasks(userId);
      }
    }
    logger.info("删除竞品账号", { id });
    sendJson(res, 200, { ok: true });
    return true;
  }
  return false;
});

// ===== Follow Account =====
function deleteFollowTasks(userId) {
  if (!userId) return 0;
  let count = 0;
  for (const task of storage.listScheduledTasks()) {
    if (task.task_type === "follow" && task.config?.userId === userId && storage.deleteScheduledTask(task.id)) count++;
  }
  return count;
}

route("GET", "/api/follow/accounts", (req, res) => {
  const accounts = storage.listFollowedAccounts().map((a) => {
    const checks = storage.getFollowTimeline(a.id, 5);
    const noteCount = storage.listNotes({ authorId: a.user_id }).length;
    return { ...a, noteCount, recentChecks: checks.length, recentNewNotes: checks.reduce((sum, c) => sum + c.new_notes, 0), checks };
  });
  sendJson(res, 200, accounts);
});
route("POST", "/api/follow/start", async (req, res) => {
  const body = await readBody(req);
  if (!body.authorUrl) { sendJson(res, 400, { error: "请提供账号主页链接" }); return; }
  try {
    const { extractXhsId } = await import("./xhsSdk.mjs");
    const userId = extractXhsId(body.authorUrl);
    const task = storage.createScheduledTask({ name: `跟随：${body.brand || body.authorUrl.substring(0, 40)}`, taskType: "follow", config: { userId, authorUrl: body.authorUrl, brand: body.brand }, intervalMinutes: Number(body.intervalMinutes) || 1440, accountId: body.accountId || null });
    storage.upsertFollowedAccount({ userId, authorUrl: body.authorUrl, brand: body.brand });
    sendJson(res, 200, { ok: true, task, userId });
  } catch (error) { sendJson(res, 500, { error: error.message }); }
});
route("POST", "/api/follow/crawl", async (req, res) => {
  const body = await readBody(req);
  let userId = body.userId || "";
  if (!userId && body.authorUrl) { const { extractXhsId } = await import("./xhsSdk.mjs"); userId = extractXhsId(body.authorUrl); }
  if (!userId) { sendJson(res, 400, { error: "请提供 userId 或账号主页链接" }); return; }
  try {
    const settings = (await import("./settings.mjs")).envWithSettings(rootDir);
    const useCdp = settings.xhs.cdpPort > 0;
    const cookieRaw = resolveCookie(rootDir, storage);
    if (!cookieRaw && !useCdp) { sendJson(res, 400, { error: "未找到有效的登录 Cookie。请通过「账号管理」扫码登录或粘贴 Cookie，或开启 CDP 模式使用 Chrome 自带登录态。" }); return; }
    const { followAccount } = await import("./xhsCrawler.mjs");
    const followed = storage.getFollowedAccountByUserId(userId);
    let knownNoteIds = [];
    try { knownNoteIds = JSON.parse(followed?.last_cursor || "[]"); } catch {}
    const result = await followAccount({ userId, authorUrl: body.authorUrl, brand: body.brand, knownNoteIds }, { rootDir, cookie: cookieRaw || "", cdpPort: useCdp ? (settings.xhs.cdpPort || 9222) : 0 });
    let newCount = 0;
    for (const note of result.notes) {
      if (!storage.findNoteBySourceUrl(note.sourceUrl)) {
        const saved = storage.upsertNote(note);
        storage.addAssets(saved.id, await persistNoteAssets(rootDir, { ...note, id: saved.id, collectedAt: saved.collectedAt }));
        newCount++;
      }
    }
    const actualUserId = userId || result.notes[0]?.authorId || "";
    if (actualUserId) {
      const updated = storage.upsertFollowedAccount({ userId: actualUserId, authorName: result.authorName, avatarUrl: result.avatarUrl, authorUrl: body.authorUrl, brand: body.brand, lastCursor: result.cursor || "", lastCheckAt: new Date().toISOString(), totalFound: result.totalFound });
      if (updated) storage.createFollowCheck({ accountId: updated.id, newNotes: newCount, totalNotes: result.totalFound });
    }
    if (newCount > 0) { clearCache(); sendWebhook(rootDir, "账号追踪完成", `账号：${result.authorName || userId}\n新增笔记：${newCount} 条\n总笔记：${result.totalFound} 篇`); }
    sendJson(res, 200, { ok: true, notes: result.notes.length, newNotes: newCount, authorName: result.authorName, avatarUrl: result.avatarUrl || "" });
  } catch (error) { sendJson(res, 500, { error: error.message }); }
});
route("GET", null, async (req, res, url) => {
  const m = url.pathname.match(/^\/api\/follow\/accounts\/([^/]+)\/timeline$/);
  if (m && req.method === "GET") {
    const account = storage.getFollowedAccount(m[1]);
    if (!account) { sendJson(res, 404, { error: "未找到" }); return true; }
    sendJson(res, 200, { account, checks: storage.getFollowTimeline(account.id, 365) });
    return true;
  }
  return false;
});
route("DELETE", null, async (req, res, url) => {
  const m = url.pathname.match(/^\/api\/follow\/accounts\/([^/]+)$/);
  if (m && req.method === "DELETE") {
    const account = storage.getFollowedAccount(m[1]);
    const deleted = storage.deleteFollowedAccount(m[1]);
    if (deleted) deleteFollowTasks(account?.user_id);
    sendJson(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "未找到" });
    return true;
  }
  return false;
});

// ===== Account Follow Toggle (from accounts page) =====
route("POST", null, async (req, res, url) => {
  const m = url.pathname.match(/^\/api\/accounts\/([^/]+)\/follow$/);
  if (!m || req.method !== "POST") return false;
  const account = storage.getAccount(m[1]);
  if (!account) { sendJson(res, 404, { error: "未找到账号" }); return true; }
  if (!account.account_url) { sendJson(res, 400, { error: "未配置主页链接" }); return true; }
  try {
    const body = await readBody(req);
    const { extractXhsId } = await import("./xhsSdk.mjs");
    const userId = extractXhsId(account.account_url);
    if (!userId) { sendJson(res, 400, { error: "无法提取用户 ID" }); return true; }
    if (storage.getFollowedAccountByUserId(userId)) { sendJson(res, 200, { ok: true, alreadyFollowing: true }); return true; }
    storage.upsertFollowedAccount({ userId, authorName: account.account_name || account.brand, authorUrl: account.account_url, brand: account.brand, avatarUrl: body?.avatarUrl || "" });
    storage.createScheduledTask({ name: `跟随：${account.brand || account.account_name || userId.substring(0, 8)}`, taskType: "follow", config: { userId, authorUrl: account.account_url, brand: account.brand }, intervalMinutes: 1440 });
    storage.createNotification({ type: "follow", title: `开始跟随 ${account.brand || account.account_name}`, message: "已创建定时跟踪任务", level: "info" });
    sendJson(res, 200, { ok: true, userId }); return true;
  } catch (error) { sendJson(res, 500, { error: error.message }); return true; }
});
route("DELETE", null, async (req, res, url) => {
  const m = url.pathname.match(/^\/api\/accounts\/([^/]+)\/follow$/);
  if (!m || req.method !== "DELETE") return false;
  const account = storage.getAccount(m[1]);
  if (!account || !account.account_url) { sendJson(res, 404, { error: "未找到" }); return true; }
  try {
    const { extractXhsId } = await import("./xhsSdk.mjs");
    const userId = extractXhsId(account.account_url);
    if (userId) {
      const f = storage.getFollowedAccountByUserId(userId);
      if (f) storage.deleteFollowedAccount(f.id);
      deleteFollowTasks(userId);
    }
    sendJson(res, 200, { ok: true }); return true;
  } catch (error) { sendJson(res, 500, { error: error.message }); return true; }
});

// ===== Detect Name =====
route("POST", "/api/accounts/detect-name", async (req, res) => {
  const body = await readBody(req);
  const profileUrl = body?.url;
  if (!profileUrl) { sendJson(res, 400, { error: "请提供链接" }); return; }
  try {
    const isProfile = isAccountUrl(profileUrl);
    const cookieRaw = resolveCookie(rootDir, storage);
    const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html", "Accept-Language": "zh-CN,zh;q=0.9" };
    if (cookieRaw) headers.Cookie = cookieRaw;
    if (!isProfile) {
      const resp = await fetch(profileUrl, { headers });
      const html = await resp.text();
      const { parseInitState } = await import("./xhsSdk.mjs");
      const state = parseInitState(html);
      let name = "";
      let avatarUrl = "";
      if (state?.note?.noteDetailMap) {
        const note = Object.values(state.note.noteDetailMap).find((item) => item?.note?.author);
        name = note?.note?.author?.nickname || note?.note?.user?.nickname || "";
        avatarUrl = note?.note?.author?.avatar || note?.note?.user?.avatar || "";
      }
      if (!name) { const m = html.match(/<title>([^<]*)<\/title>/i); if (m) name = m[1].replace(/ - 小红书.*$/, "").trim(); }
      if (!avatarUrl) { const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i); if (m) avatarUrl = m[1]; }
      sendJson(res, 200, { name, avatarUrl }); return;
    }
    let name = "";
    let avatarUrl = "";
    try {
      const context = await openXhsContext(rootDir, cookieRaw, { headless: true });
      try {
        const page = await context.newPage();
        await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await sleep(5000);
        if (!page.url().includes("/login")) {
          for (let i = 0; i < 5; i++) {
            await sleep(3000);
            const info = await page.evaluate(() => {
              const title = document.title || "";
              let n = "";
              const m = title.match(/^(.+?)\s*[-–—]\s*小红书/);
              if (m) n = m[1].trim();
              const ogTitle = document.querySelector("meta[property='og:title']")?.content || "";
              if (!n && ogTitle && !ogTitle.includes("小红书")) n = ogTitle.trim();
              const h1 = document.querySelector("h1, [class*='name'], [class*='nickname'], [class*='userName'], [class*='username']");
              if (!n && h1?.textContent?.trim()) n = h1.textContent.trim();
              try { const s = window.__INITIAL_STATE__; const pd = s?.user?.userPageData; const pageData = pd?._value || pd?._rawValue || pd || {}; if (!n) n = pageData.basicInfo?.nickname || pageData.nickname || pageData.name || ""; const a = pageData.basicInfo?.image || pageData.avatar || pageData.avatar_url || pageData.avatarUrl || pageData.image || ""; return { name: n, avatarUrl: a }; } catch { return { name: n, avatarUrl: "" }; }
            }).catch(() => ({ name: "", avatarUrl: "" }));
            name = info.name || name;
            avatarUrl = info.avatarUrl || avatarUrl;
            if (name) break;
          }
        }
        if (!avatarUrl) {
          avatarUrl = await page.evaluate(() => {
            const og = document.querySelector("meta[property='og:image']")?.content || "";
            if (og) return og;
            const img = document.querySelector("img[class*='avatar']");
            return img?.src || "";
          }).catch(() => "");
        }
      } finally { await context.close(); }
    } catch {
      try { const resp = await fetch(profileUrl, { headers }); const html = await resp.text(); const m = html.match(/<title>([^<]*)<\/title>/i); if (m) name = m[1].replace(/ - 小红书.*$/, "").trim(); const am = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i); if (am) avatarUrl = am[1]; } catch {}
    }
    sendJson(res, 200, { name, avatarUrl });
  } catch (error) { sendJson(res, 500, { error: error.message }); }
});

// ===== Notes =====
route("GET", "/api/notes", (req, res, url) => sendJson(res, 200, storage.listNotes(Object.fromEntries(url.searchParams.entries()))));
route("GET", "/api/notes/libraries", (req, res, url) => sendJson(res, 200, storage.listNotes({ libraryType: url.searchParams.get("type") || undefined })));

route("DELETE", null, async (req, res, url) => {
  const m = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
  if (m && req.method === "DELETE") {
    const deleted = storage.deleteNote(m[1]);
    if (deleted) clearCache();
    sendJson(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "未找到笔记" });
    return true;
  }
  return false;
});
route("POST", null, async (req, res, url) => {
  const m = url.pathname.match(/^\/api\/notes\/([^/]+)\/library$/);
  if (!m || req.method !== "POST") return false;
  const body = await readBody(req);
  const note = storage.setNoteLibraryType(m[1], body.libraryType || null);
  if (!note) { sendJson(res, 404, { error: "未找到笔记" }); return true; }
  clearCache();
  sendJson(res, 200, note); return true;
});

// ===== Batch Operations =====
route("POST", "/api/notes/batch-delete", async (req, res) => {
  const body = await readBody(req);
  if (!Array.isArray(body.ids) || !body.ids.length) { sendJson(res, 400, { error: "请提供要删除的笔记 ID 列表" }); return; }
  const deleted = storage.batchDeleteNotes(body.ids);
  if (deleted > 0) clearCache();
  sendJson(res, 200, { ok: true, deleted });
});
route("POST", "/api/notes/batch/export", async (req, res) => {
  const body = await readBody(req);
  const format = body.format === "csv" ? "csv" : "json";
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const content = storage.exportNotes(ids, format);
  if (format === "csv") {
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="notes_export_${fmtDate(new Date())}.csv"` });
    res.end(content);
  } else { sendJson(res, 200, JSON.parse(content)); }
});
route("POST", "/api/notes/batch/tags", async (req, res) => {
  const body = await readBody(req);
  if (!Array.isArray(body.ids) || !body.ids.length) { sendJson(res, 400, { error: "请选择要更新的笔记" }); return; }
  clearCache();
  sendJson(res, 200, { ok: true, updated: storage.batchUpdateTags(body.ids, Array.isArray(body.tags) ? body.tags : []) });
});
route("POST", "/api/notes/batch/brand", async (req, res) => {
  const body = await readBody(req);
  if (!Array.isArray(body.ids) || !body.ids.length) { sendJson(res, 400, { error: "请选择要更新的笔记" }); return; }
  if (!body.brand || !body.brand.trim()) { sendJson(res, 400, { error: "请提供品牌名称" }); return; }
  clearCache();
  sendJson(res, 200, { ok: true, updated: storage.batchUpdateBrand(body.ids, body.brand.trim()) });
});
route("POST", "/api/notes/batch/library", async (req, res) => {
  const body = await readBody(req);
  if (!Array.isArray(body.ids) || !body.ids.length) { sendJson(res, 400, { error: "请选择要更新的笔记" }); return; }
  const libType = body.libraryType || "";
  if (libType && !["选题库", "脚本模板库", "视觉参考库", "营销话术库", ""].includes(libType)) { sendJson(res, 400, { error: "无效的分类类型" }); return; }
  clearCache();
  sendJson(res, 200, { ok: true, updated: storage.batchSetLibraryType(body.ids, libType || null) });
});
route("POST", "/api/notes/batch/eagle", async (req, res) => {
  const body = await readBody(req);
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const allNotes = ids.length > 0 ? ids.map((id) => storage.getNote(id)).filter(Boolean) : storage.listNotes();
  try {
    const result = exportForEagle(rootDir, allNotes);
    sendJson(res, 200, result);
  } catch (error) { sendJson(res, 500, { error: `Eagle 导出失败：${error.message}` }); }
});

// ===== Analyze & Comments =====
route("POST", null, async (req, res, url) => {
  const m = url.pathname.match(/^\/api\/notes\/([^/]+)\/analyze$/);
  if (!m || req.method !== "POST") return false;
  const note = storage.getNote(m[1]);
  if (!note) { sendJson(res, 404, { error: "未找到笔记" }); return true; }
  storage.saveAnalysis(note.id, await analyzeNote(note, loadSettings(rootDir)));
  clearCache();
  sendJson(res, 200, { ok: true });
  return true;
});
route("POST", "/api/analyze/viral", async (req, res) => {
  const body = await readBody(req);
  try { sendJson(res, 200, analyzeViral(body.note || {}, body.comments || [])); } catch (error) { sendJson(res, 500, { error: error.message }); }
});

// ===== Webhook =====
route("POST", "/api/webhook/test", async (req, res) => {
  const body = await readBody(req);
  try {
    await sendWebhook(rootDir, "品牌情报测试", "这是一条测试通知\n如果你看到这条消息，说明 webhook 配置正确 ✅", {
      webhookUrl: body.url || "",
      webhookPlatform: body.platform || ""
    });
    sendJson(res, 200, { ok: true });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
});

// ===== Comments =====
route("GET", null, (req, res, url) => {
  const m = url.pathname.match(/^\/api\/notes\/([^/]+)\/comments$/);
  if (m && req.method === "GET") { sendJson(res, 200, storage.getComments(m[1])); return true; }
  return false;
});
route("POST", null, async (req, res, url) => {
  const m = url.pathname.match(/^\/api\/notes\/([^/]+)\/comments$/);
  if (!m || req.method !== "POST") return false;
  const body = await readBody(req);
  const note = storage.getNote(m[1]);
  if (!note) { sendJson(res, 404, { error: "未找到笔记" }); return true; }
  try {
    const result = await collectComments(note.sourceUrl, { rootDir, headless: !!body.headless, proxy: body.proxy || "" });
    if (result.count > 0) storage.saveComments(m[1], result.comments);
    sendJson(res, 200, result); return true;
  } catch (error) { sendJson(res, 500, { error: error.message }); return true; }
});

// ===== Settings =====
route("GET", "/api/settings", (req, res) => {
  const s = loadSettings(rootDir);
  sendJson(res, 200, { xhs: { ...s.xhs, cookie: "" }, download: s.download, ai: s.ai, notification: s.notification || {} });
});
route("GET", "/api/settings/ai-presets", (req, res) => sendJson(res, 200, aiPresets));
route("PUT", "/api/settings", async (req, res) => {
  const body = await readBody(req);
  if (!body || typeof body !== "object") { sendJson(res, 400, { error: "无效的配置数据" }); return; }
  const merged = loadSettings(rootDir);
  if (body.xhs) Object.assign(merged.xhs, body.xhs);
  if (body.download) Object.assign(merged.download, body.download);
  if (body.ai) Object.assign(merged.ai, body.ai);
  if (body.notification) Object.assign(merged.notification, body.notification);
  writeFileSync(path.join(rootDir, "data", "settings.json"), JSON.stringify(merged, null, 2), "utf8");
  clearSettingsCache();
  logger.info("设置已保存", { aiProvider: merged.ai?.provider, folderName: merged.download?.folderName });
  sendJson(res, 200, { ok: true });
});
route("POST", "/api/settings/ai/test", async (req, res) => {
  try {
    const settings = loadSettings(rootDir);
    const { apiKey, baseUrl, model } = resolveAiConfig(settings);
    if (!apiKey) { sendJson(res, 400, { error: "未配置 API 密钥" }); return; }
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "回复「连接成功」这 4 个字" }], temperature: 0, max_tokens: 20 })
    });
    const payload = await response.json();
    if (!response.ok) { sendJson(res, 400, { error: `API 错误：${payload.error?.message || `HTTP ${response.status}`}` }); return; }
    sendJson(res, 200, { ok: true, model, reply: (payload.choices?.[0]?.message?.content || "").trim() });
  } catch (e) { sendJson(res, 500, { error: `测试失败：${e.message}` }); }
});
route("POST", "/api/settings/xhs-cookie", async (req, res) => {
  const body = await readBody(req);
  const cookie = String(body.cookie || "").trim();
  if (!cookie || !cookie.includes("=")) { sendJson(res, 400, { error: "请粘贴有效的小红书 Cookie" }); return; }
  writeFileSync(path.join(rootDir, "data", "xhs-cookie.txt"), cookie, "utf8");
  sendJson(res, 200, { ok: true, message: "小红书 Cookie 已保存" });
});
route("POST", "/api/settings/xhs-cookie/from-browser", async (req, res) => {
  const body = await readBody(req);
  try {
    const result = await saveXhsCookieFromBrowser(rootDir, { waitMs: Number(body.waitMs || 8000), proxy: body.proxy || "" });
    sendJson(res, 200, { ok: true, message: "已从本机浏览器登录态保存小红书 Cookie", ...result });
  } catch (error) { sendJson(res, 500, { ok: false, error: error.message }); }
});

// ===== Crawl =====
route("POST", "/api/crawl", async (req, res) => {
  try {
    const result = await crawlAndStore(await readBody(req), { rootDir, storage });
    if (result.notes.length > 0) { clearCache(); sendWebhook(rootDir, "采集完成", `入库 ${result.notes.length} 条，跳过 ${result.skipped?.length || 0} 条`); }
    sendJson(res, 200, { jobId: result.jobs[0] || null, jobIds: result.jobs, inputUrls: result.inputUrls, notes: result.notes, skipped: result.skipped });
  } catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); }
});
route("POST", "/api/search", async (req, res) => {
  const body = await readBody(req);
  if (!body.keyword?.trim()) { sendJson(res, 400, { error: "请提供搜索关键词" }); return; }
  const cookieRaw = resolveCookie(rootDir, storage);
  try { sendJson(res, 200, await searchXhs(body.keyword.trim(), { rootDir, cookie: cookieRaw, headless: !!body.headless, proxy: body.proxy || "" })); } catch (error) { sendJson(res, 500, { error: error.message }); }
});
route("POST", "/xhs/detail", async (req, res) => {
  const body = await readBody(req);
  try {
    const result = await crawlAndStore(body, { rootDir, storage, apiMode: true });
    sendJson(res, 200, { message: result.notes.length ? "success" : result.skipped.length ? "skipped" : "empty", params: { url: body.url || "", download: !!body.download, index: body.index || null, cookie: body.cookie ? "[provided]" : "", proxy: body.proxy || "", skip: !!body.skip }, data: result.notes[0] || result.skipped[0] || null, dataList: result.notes, skipped: result.skipped });
  } catch (error) { sendJson(res, error.statusCode || 500, { message: error.message, params: body, data: null }); }
});
route("POST", "/xhs/links", async (req, res) => {
  const body = await readBody(req);
  const parsedUrls = extractXhsUrls(body.url || body.shareText || "");
  if (!parsedUrls.length) { sendJson(res, 400, { message: "请提供链接", links: [] }); return; }
  const directNoteLinks = parsedUrls.filter((item) => isXhsNoteUrl(item));
  const pageUrl = parsedUrls.find((item) => !isXhsNoteUrl(item)) || "";
  if (!pageUrl) { sendJson(res, 200, { message: "success", count: directNoteLinks.length, links: mergeXhsLinks(parsedUrls) }); return; }
  let browserContext = null;
  try {
    browserContext = await openXhsContext(rootDir, body.cookie || "", { headless: !!body.headless, proxy: body.proxy || "" });
    const page = await browserContext.newPage();
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const diagnosis = await page.evaluate(() => ({ title: document.title, url: location.href, text: document.body?.innerText?.slice(0, 500) || "" }));
    const links = await extractPageLinks(page, { rootDir, maxNotes: body.maxNotes, scrollPages: body.scrollPages, scrollDelayMs: body.scrollDelayMs });
    sendJson(res, 200, { message: links.length ? "success" : "empty", inputUrl: pageUrl, count: links.length, links: mergeXhsLinks(directNoteLinks, links), diagnosis });
  } catch (error) {
    if (directNoteLinks.length) { sendJson(res, 200, { message: "partial", inputUrl: pageUrl, count: directNoteLinks.length, links: mergeXhsLinks(directNoteLinks), error: error.message }); return; }
    sendJson(res, 500, { message: error.message, links: [] });
  } finally { if (browserContext) await browserContext.close(); }
});

// ===== Health =====
route("POST", "/api/xhs/health", async (req, res) => {
  try {
    const { buildHealthReport, diagnoseNote } = await import("./xhsHealth.mjs");
    const allNotes = storage.listNotes();
    const report = buildHealthReport(allNotes);
    sendJson(res, 200, report);
  } catch (error) { sendJson(res, 500, { error: error.message }); }
});

// ===== Dispatch =====
async function handleApi(req, res, url) {
  for (const r of ROUTES) {
    try {
      let matched = false;
      if (r.pathname === null) {
        const result = await r.handler(req, res, url);
        if (result === true) { matched = true; }
      } else if (url.pathname === r.pathname && req.method === r.method) {
        await r.handler(req, res, url);
        matched = true;
      }
      if (matched) return;
    } catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); return; }
  }
  sendJson(res, 404, { error: "接口不存在" });
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; media-src 'self' blob: http: https:; connect-src 'self'; frame-ancestors 'none'");
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    // 基于 asset ID 的文件访问（避免 URL 路径中的 ../ 被规范化）
    // 必须放在 /api/ 检查之前，否则会被 handleApi 拦截
    const assetFileMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/file$/);
    if (assetFileMatch && req.method === "GET") {
      const asset = storage.getAsset(assetFileMatch[1]);
      if (!asset || !asset.localPath) { sendText(res, 404, "素材不存在或无本地文件"); return; }
      const filePath = path.isAbsolute(asset.localPath) ? asset.localPath : path.join(rootDir, asset.localPath);
      if (!existsSync(filePath)) { sendText(res, 404, "文件不存在"); return; }
      serveFile(res, filePath);
      return;
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/xhs/detail" || url.pathname === "/xhs/links") {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname === "/vendor/chart.umd.js") {
      serveFile(res, path.join(rootDir, "node_modules", "chart.js", "dist", "chart.umd.js"));
      return;
    }
    if (url.pathname.startsWith("/files/") || req.url.startsWith("/files/")) {
      const rawPath = (req.url || "").split("?")[0].replace(/^\/files\//, "");
      const decodedPath = decodeURIComponent(rawPath);
      const filePath = path.resolve(rootDir, decodedPath);
      if (!existsSync(filePath)) { sendText(res, 404, "Not found"); return; }
      const allowedRoots = [
        path.resolve(rootDir, "data", "library"),
        path.resolve(rootDir, "data", "eagle-export")
      ];
      try {
        const settings = loadSettings(rootDir);
        const rawFolder = settings.download?.folderName || "library";
        const libraryRoot = path.isAbsolute(rawFolder) ? path.resolve(rawFolder) : path.resolve(rootDir, "data", rawFolder);
        allowedRoots.push(libraryRoot);
      } catch {}
      const realPath = realpathSync(filePath);
      const allowed = allowedRoots.some((root) => {
        if (!existsSync(root)) return false;
        const realRoot = realpathSync(root);
        return realPath === realRoot || realPath.startsWith(realRoot + path.sep);
      });
      if (!allowed) { sendText(res, 403, "Forbidden"); return; }
      serveFile(res, filePath);
      return;
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const filePath = path.normalize(path.join(publicDir, requested));
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) { sendText(res, 403, "Forbidden"); return; }
    serveFile(res, filePath);
  } catch (error) { sendJson(res, 500, { error: error.message }); }
});

startScheduler(rootDir, storage);
startSignServer(rootDir).catch((e) => console.warn("[signserver] 启动失败:", e.message));
async function cleanupOnExit() {
  stopSignServer();
  try { const m = await import('./xhsSdk.mjs'); if (m.cleanupCdpChrome) m.cleanupCdpChrome(); } catch {}
  stopScheduler();
}
process.on("exit", () => cleanupOnExit());
process.on("SIGINT", async () => { await cleanupOnExit(); process.exit(); });
process.on("SIGTERM", async () => { await cleanupOnExit(); process.exit(); });

server.listen(port, "127.0.0.1", () => {
  console.log(`小红书品牌内容情报工具已启动：http://127.0.0.1:${port}`);
});
