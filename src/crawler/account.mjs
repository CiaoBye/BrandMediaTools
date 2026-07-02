import { envWithSettings } from "../settings.mjs";
import { readXhsCookie } from "../xhsAuth.mjs";
import {
  extractXhsId, isXhsNoteUrl, normalizeXhsNoteUrl, scoreXhsNoteUrl,
  openXhsContext, attachResponseCollector,
  sleep, randomDelay, parseInitState, log
} from "../xhsSdk.mjs";
import { fetchNoteViaHttp, extractNote } from "./extract.mjs";

export function isOfficialXhsLogo(url) {
  if (!url) return false;
  const lower = String(url).toLowerCase();
  return lower.includes("favicon") || lower.includes("logo") ||
    lower.includes("fe-static") || lower.includes("fe-platform") ||
    lower.includes("default_avatar") || lower.includes("fe-video-qc");
}

export async function extractAccountLinks(page, options = {}) {
  const settings = envWithSettings(options.rootDir || process.cwd());
  const maxNotes = Number(options.maxNotes || settings.xhs.maxAccountNotes || 12);
  const scrollPages = Number(options.scrollPages ?? settings.xhs.accountScrollPages ?? 8);
  const baseDelayMs = Number(options.scrollDelayMs ?? settings.xhs.accountScrollDelayMs ?? 1200);
  const emptyThreshold = Number(options.scrollEmptyThreshold ?? settings.xhs.accountScrollEmptyThreshold ?? 8);
  const progressiveDelay = options.progressiveDelay ?? settings.xhs.accountScrollProgressiveDelay ?? true;
  const byNoteId = new Map();

  async function collectOnce() {
    const urls = await page.evaluate(() => {
      const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) => a.href);
      const dataNoteIds = Array.from(document.querySelectorAll("[data-note-id]")).map(el => {
        const id = el.getAttribute("data-note-id");
        return id ? "https://www.xiaohongshu.com/explore/" + id : "";
      }).filter(Boolean);
      const vueNotes = Array.from(document.querySelectorAll("[class*=note-item], [class*=feeds-page]")).flatMap(el => {
        try {
          const state = JSON.stringify(el.__vue__ || el.__vueParentComponent);
          const ids = Array.from(state.matchAll(/"note_id":"([a-f0-9]+)"/g)).map(m => "https://www.xiaohongshu.com/explore/" + m[1]);
          return ids;
        } catch { return []; }
      });
      const lazyImages = Array.from(document.querySelectorAll("img[data-src], img[data-lazy-src]")).map(img => {
        return img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "";
      });
      const sectionLinks = Array.from(document.querySelectorAll("section a[href], [class*=card] a[href], [class*=note] a[href]")).map(a => a.href);
      const html = document.documentElement.innerHTML;
      const absolute = Array.from(html.matchAll(/https?:\/\/www\.xiaohongshu\.com\/(?:explore|discovery\/item|user\/profile)\/[^"'<>\s\\]+/g)).map((match) => match[0]);
      const relative = Array.from(html.matchAll(/\/(?:explore|discovery\/item|user\/profile)\/[A-Za-z0-9][^"'<>\s\\]*/g)).map((match) => "https://www.xiaohongshu.com" + match[0]);
      return [...new Set([...hrefs, ...absolute, ...relative, ...dataNoteIds, ...vueNotes, ...lazyImages, ...sectionLinks])];
    });
    for (const url of urls) {
      const normalized = normalizeXhsNoteUrl(url);
      if (!normalized) continue;
      const noteId = extractXhsId(normalized);
      const existing = byNoteId.get(noteId);
      if (!existing || scoreXhsNoteUrl(normalized) > scoreXhsNoteUrl(existing)) byNoteId.set(noteId, normalized);
    }
  }

  await collectOnce();
  let lastCount = 0;
  let emptyScrollCount = 0;

  for (let index = 0; index < scrollPages && byNoteId.size < maxNotes; index += 1) {
    if (byNoteId.size >= 50 && byNoteId.size % 50 < 10) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500 + Math.random() * 800);
    }
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 900)));
    let delay = baseDelayMs;
    if (progressiveDelay) {
      delay = baseDelayMs * (1 + emptyScrollCount * 0.3);
      delay += Math.random() * 800;
    } else {
      delay += Math.random() * 800;
    }
    delay = Math.min(delay, 5000);
    await sleep(delay);
    await collectOnce();
    if (byNoteId.size === lastCount) {
      emptyScrollCount++;
      if (emptyScrollCount >= emptyThreshold) break;
    } else {
      emptyScrollCount = 0;
      lastCount = byNoteId.size;
    }
  }

  return Array.from(byNoteId.values()).sort((a, b) => scoreXhsNoteUrl(b) - scoreXhsNoteUrl(a)).slice(0, maxNotes);
}

async function mapLimited(items, limit, worker) {
  const size = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

async function extractAccountNotes(page, input, options) {
  const rootDir = options.rootDir || process.cwd();
  const settings = envWithSettings(rootDir);
  const parallelTabs = Number(options.parallelTabs ?? settings.xhs.accountParallelTabs ?? 3);
  const videoPreference = options.videoPreference || settings.download.videoPreference || "resolution";
  const videoMinHeight = options.videoMinHeight || settings.download.videoMinHeight || 0;
  const uniqueUrls = await extractAccountLinks(page, options);
  const notes = [];

  async function processUrl(url) {
    const httpResult = await fetchNoteViaHttp({ ...input, url }, options);
    if (httpResult) { return httpResult; }
    const child = await page.context().newPage();
    const networkBodies = [];
    attachResponseCollector(child, networkBodies);
    try {
      await child.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(2500);
      return [await extractNote(child, { ...input, url }, networkBodies, videoPreference, videoMinHeight)];
    } catch (error) {
      return [{ sourceUrl: url, platform: "小红书", title: "采集失败", status: "需人工复核", reviewReason: error.message, assets: [] }];
    } finally { await child.close(); }
  }

  for (let i = 0; i < uniqueUrls.length; i += parallelTabs) {
    const chunk = uniqueUrls.slice(i, i + parallelTabs);
    const results = await Promise.allSettled(chunk.map(url => processUrl(url)));
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) notes.push(...result.value);
    }
  }

  return notes;
}


export async function followAccount(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const settings = envWithSettings(rootDir);
  const httpParallel = Math.max(1, Math.min(8, Number(options.httpParallel ?? settings.xhs.accountHttpParallel ?? 4)));
  let userId = input.userId || "";
  const authorUrl = input.authorUrl || "";
  if (!userId && authorUrl) userId = extractXhsId(authorUrl);
  if (!userId) throw new Error("需要提供 userId 或账号主页链接");
  const knownNoteIds = Array.isArray(input.knownNoteIds) ? input.knownNoteIds : [];
  const knownNoteIdSet = new Set(knownNoteIds.filter(Boolean));
  const repairNoteIdSet = new Set((Array.isArray(input.repairNoteIds) ? input.repairNoteIds : []).filter(Boolean));
  const isFirstFollow = knownNoteIds.length === 0;
  const allNotes = [];
  const seenNoteIds = new Set();
  const httpFailedNoteIds = new Set();
  let authorName = input.authorName || "";
  let avatarUrl = "";
  let noteUrls = [];
  let httpRiskError = null;
  log("info", `账号抓取开始：userId=${userId}，已知笔记=${knownNoteIdSet.size}`);
  log("info", `本轮账号抓取阶段：开始读取账号主页 userId=${userId}`);
  const httpProfile = await fetchAccountNotesViaHttp(userId, { ...options, rootDir }).catch((e) => {
    if (e.message && e.message.includes("风控")) httpRiskError = e;
    return null;
  });
  if (httpProfile) { authorName = httpProfile.authorName || authorName; avatarUrl = httpProfile.avatarUrl || avatarUrl; noteUrls = httpProfile.noteUrls; }
  if (noteUrls.length) {
    let successCount = 0;
    const successNoteIds = new Set();
    const httpCandidates = [];
    for (const url of noteUrls) {
      const noteId = extractXhsId(url);
      if (!noteId || seenNoteIds.has(noteId)) continue;
      if (!isFirstFollow && knownNoteIdSet.has(noteId) && !repairNoteIdSet.has(noteId)) { seenNoteIds.add(noteId); continue; }
      seenNoteIds.add(noteId);
      httpCandidates.push({ url, noteId });
    }
    const attemptedNewCount = httpCandidates.length;
    if (attemptedNewCount === 0) {
      const allKnownIds = new Set([...knownNoteIdSet, ...seenNoteIds]);
      log("info", "HTTP 账号列表无新增/待修复笔记，跳过浏览器降级流程。");
      return { notes: allNotes, cursor: JSON.stringify(Array.from(allKnownIds)), authorName, avatarUrl, totalFound: allKnownIds.size };
    }
    log("info", "HTTP 快速路径并发提取作品详情：" + attemptedNewCount + " 条，parallel=" + httpParallel);
    const httpResults = await mapLimited(httpCandidates, httpParallel, async ({ url, noteId }) => {
      const httpResult = await fetchNoteViaHttp({ ...input, url }, { ...options, rootDir }).catch(() => null);
      return { url, noteId, httpResult };
    });
    for (const { noteId, httpResult } of httpResults) {
      if (httpResult && httpResult.length > 0) {
        allNotes.push({ ...httpResult[0], accountId: input.accountId || null, brand: input.brand || "" });
        successCount++;
        successNoteIds.add(noteId);
      } else {
        httpFailedNoteIds.add(noteId);
      }
    }
    const shouldFallback = (isFirstFollow && successCount === 0) || (attemptedNewCount > 0 && successCount === 0);
    if (!shouldFallback && attemptedNewCount > 0) {
      const failedNoteIds = [...seenNoteIds].filter(function(id) { return !knownNoteIdSet.has(id) && !successNoteIds.has(id); });
      for (const failedId of failedNoteIds) { seenNoteIds.delete(failedId); }
      const pendingCount = failedNoteIds.length;
      if (pendingCount === 0) {
        const allKnownIds = new Set([...knownNoteIdSet, ...successNoteIds]);
        log("info", "HTTP 快速路径全部成功(" + successCount + "/" + attemptedNewCount + ")，直接返回。");
        return { notes: allNotes, cursor: JSON.stringify(Array.from(allKnownIds)), authorName, avatarUrl, totalFound: allKnownIds.size };
      }
      log("info", "HTTP 部分成功(" + successCount + "/" + attemptedNewCount + ")，" + pendingCount + " 条继续降级 Playwright。");
    } else if (shouldFallback) {
      for (const url of noteUrls) {
        const noteId = extractXhsId(url);
        if (noteId && !knownNoteIdSet.has(noteId) && !successNoteIds.has(noteId)) { seenNoteIds.delete(noteId); }
      }
      log("info", "HTTP 快速路径无法成功解析任何新笔记(已尝试 " + attemptedNewCount + " 篇)，下放至 Playwright 降级流程。");
    }
  }
  let headless = options.headless;
  if (httpRiskError && (headless === undefined || headless === true)) { headless = false; }
  if (headless === undefined) headless = false;
  const context = await openXhsContext(rootDir, options.cookie || "", { proxy: options.proxy || "", headless, cdpPort: options.cdpPort || 0 });
  try {
    const page = await context.newPage();
    const profileUrl = "https://www.xiaohongshu.com/user/profile/" + userId;
    await randomDelay(500, 1500);
    try { await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); } catch (navError) { console.error("[followAccount] 导航到 profile 页失败:", navError.message); }
    await randomDelay(800, 2000);
    if (!headless) { let w = 0; while (w < 120) { const u = page.url(); if (!u.includes("/captcha") && !u.includes("/website-login")) break; if (w === 0) console.log("[followAccount] 检测到验证码页面，最长等待 120 秒"); await sleep(3000); w += 3; } }
    await sleep(4000);
    const currentUrl = page.url();
    if (currentUrl.includes("error_code=300012") || currentUrl.includes("website-login/error")) {
      throw new Error("小红书限制：IP存在安全风险，请切换代理/网络环境后重试");
    }
    const cs = await page.evaluate(() => { let c = false, g = false; if (document.querySelector(".secsdk-captcha-wrapper, [class*=captcha], iframe[src*=captcha]")) c = true; try { const s = window.__INITIAL_STATE__; const ui = (s?.user?.userInfo?._value) || s?.user?.userInfo; const pd = (s?.user?.userPageData?._value) || s?.user?.userPageData; if (ui?.guest === true || pd?.guest === true) g = true; } catch {} return { isCaptcha: c, isGuest: g }; }).catch(() => ({ isCaptcha: false, isGuest: false }));
    if (currentUrl.includes("/login") || cs.isGuest) throw new Error("检测到登录页面重定向，Cookie 无效或已过期");
    noteUrls = await extractAccountLinks(page, { rootDir, maxNotes: options.maxNotes || settings.xhs.maxAccountNotes || 100, scrollPages: options.scrollPages || settings.xhs.accountScrollPages || 15 });
    log("info", `账号主页链接提取完成：发现 ${noteUrls.length} 条候选笔记`);
    log("info", `本轮账号抓取阶段：作品列表获取完成，候选笔记 ${noteUrls.length} 条`);
    if (!noteUrls.length) {
      log("warn", "账号主页未提取到笔记链接，请确认页面已正常加载作品列表");
      return { notes: [], cursor: JSON.stringify(Array.from(knownNoteIdSet)), authorName, avatarUrl, totalFound: knownNoteIdSet.size };
    }
    const newUrlsToFetch = noteUrls.filter(url => {
      const nid = extractXhsId(url);
      return nid && (!knownNoteIdSet.has(nid) || repairNoteIdSet.has(nid));
    });
    let processed = 0;
    for (const url of noteUrls) {
      const noteId = extractXhsId(url);
      if (!noteId || seenNoteIds.has(noteId)) continue;
      if (!isFirstFollow && knownNoteIdSet.has(noteId) && !repairNoteIdSet.has(noteId)) { seenNoteIds.add(noteId); continue; }
      seenNoteIds.add(noteId);
      processed++;
      if (processed === 1 || processed === newUrlsToFetch.length || processed % 5 === 0) {
        log("info", `本轮账号抓取阶段：正在提取作品详情 ${processed}/${newUrlsToFetch.length}`);
      }
      if (options.onProgress) {
        try { options.onProgress(processed, newUrlsToFetch.length, url); } catch {}
      }
      await randomDelay(800, 2500);
      if (!httpFailedNoteIds.has(noteId)) {
        const hr = await fetchNoteViaHttp({ ...input, url }, { ...options, rootDir }).catch(() => null);
        if (hr && hr.length > 0) { allNotes.push({ ...hr[0], accountId: input.accountId || null, brand: input.brand || "" }); continue; }
      }
      const child = await context.newPage();
      try {
        const cb = []; attachResponseCollector(child, cb);
        await child.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await child.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        const nd = await extractNote(child, { ...input, url }, cb, options.videoPreference || "", options.videoMinHeight || 0);
        if (nd) { nd.accountId = input.accountId || null; nd.brand = input.brand || ""; nd.authorName = nd.authorName || authorName; nd.authorId = nd.authorId || userId; allNotes.push(nd); }
      } catch (e) { console.error("[followAccount] 子页采集失败:", e.message); } finally { await child.close().catch(() => {}); }
    }
  } finally { await context.close(); }
  const allKnownIds = new Set([...knownNoteIdSet, ...seenNoteIds]);
  return { notes: allNotes, cursor: JSON.stringify(Array.from(allKnownIds)), authorName, avatarUrl, totalFound: allKnownIds.size };
}



async function fetchAccountNotesViaHttp(userId, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const cookie = options.cookie || readXhsCookie(rootDir);
  const profileUrl = "https://www.xiaohongshu.com/user/profile/" + userId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(profileUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36", "Accept-Language": "zh-CN,zh;q=0.9", Cookie: cookie, Referer: "https://www.xiaohongshu.com/" },
      redirect: "follow", signal: ctrl.signal
    });
    if (resp.status !== 200) return null;
    const html = await resp.text();
    if (html.includes("安全限制") || html.includes("登录小红书") || html.includes("手机号登录")) return null;
    const state = { user: {} };  // Minimal mock — full parseInitState is complex
    try { const m = await import("../xhsSdk.mjs"); const st = m.parseInitState(html); if (st) Object.assign(state, st); } catch {}
    const pd = (state.user?.userPageData?._value) || (state.user?.userPageData?._rawValue) || state.user?.userPageData || {};
    let authorName = pd.basicInfo?.nickname || pd.nickname || "";
    let avatarUrl = pd.basicInfo?.image || pd.avatar || pd.image || "";
    if (!authorName) { const tm = html.match(/<title>([^<]*)<\/title>/i); if (tm) authorName = tm[1].replace(/ - 小红书.*$/, "").trim(); }
    const notes = state.user?.notes || state.notes || state.noteResult || [];
    if (!Array.isArray(notes) || !notes.length) return null;
    const noteUrls = notes.map(function(n) { const id = n.id || n.note_id || n.noteId || ""; if (!id) return ""; const x = n.xsec_token || ""; return x ? "https://www.xiaohongshu.com/explore/" + id + "?xsec_token=" + x : "https://www.xiaohongshu.com/explore/" + id; }).filter(Boolean);
    if (!noteUrls.length) return null;
    return { authorName, avatarUrl, noteUrls };
  } catch (e) {
    if (e.message && e.message.includes("风控")) throw e;
    return null;
  } finally { clearTimeout(timer); }
}

export { extractAccountNotes, fetchAccountNotesViaHttp };
