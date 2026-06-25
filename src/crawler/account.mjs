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
  return (
    lower.includes("favicon") ||
    lower.includes("logo") ||
    lower.includes("fe-static") ||
    lower.includes("fe-platform") ||
    lower.includes("default_avatar") ||
    lower.includes("fe-video-qc")
  );
}

async function fetchAccountNotesViaHttp(userId, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const cookie = options.cookie || readXhsCookie(rootDir);
  const profileUrl = `https://www.xiaohongshu.com/user/profile/${userId}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(profileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Cookie: cookie,
        Referer: "https://www.xiaohongshu.com/",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const finalUrl = res.url || profileUrl;
    if (finalUrl.includes("captcha") || finalUrl.includes("website-login")) {
      throw new Error("小红书风控验证码拦截，请稍后重试或更换 IP/网络环境");
    }
    if (res.status !== 200) return null;

    const html = await res.text();
    if (html.includes("滑动太频繁") || html.includes("website-login/captcha") || html.includes("verifyType=")) {
      throw new Error("小红书风控验证码拦截，请稍后重试或更换 IP/网络环境");
    }
    if (html.includes("手机号登录") || html.includes("登录小红书")) return null;

    const state = parseInitState(html);
    if (!state) return null;

    const pd = state.user?.userPageData;
    const pageData = pd?._value || pd?._rawValue || pd || {};
    let authorName = pageData.basicInfo?.nickname || pageData.nickname || "";
    
    let avatarUrl = "";
    const ssrAv = pageData.basicInfo?.image || pageData.avatar || pageData.image || "";
    if (ssrAv && !isOfficialXhsLogo(ssrAv)) {
      avatarUrl = ssrAv;
    } else {
      const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
      if (ogMatch && !isOfficialXhsLogo(ogMatch[1])) {
        avatarUrl = ogMatch[1];
      } else {
        avatarUrl = ssrAv || (ogMatch ? ogMatch[1] : "");
      }
    }

    if (!authorName) {
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      if (titleMatch) authorName = titleMatch[1].replace(/ - 小红书.*$/, "").trim();
    }

    const notes = state.user?.notes || state.notes || state.noteResult || [];
    if (!Array.isArray(notes) || !notes.length) return null;

    const noteUrls = notes.map(n => {
      const id = n.id || n.note_id || n.noteId || "";
      if (!id) return "";
      const xsec = n.xsec_token || "";
      return xsec
        ? `https://www.xiaohongshu.com/explore/${id}?xsec_token=${xsec}`
        : `https://www.xiaohongshu.com/explore/${id}`;
    }).filter(Boolean);

    if (!noteUrls.length) return null;
    return { authorName, avatarUrl, noteUrls };
  } catch (e) {
    if (e.message && e.message.includes("风控")) throw e;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractAccountLinks(page, options = {}) {
  const settings = envWithSettings(options.rootDir || process.cwd());
  const maxNotes = Number(options.maxNotes || settings.xhs.maxAccountNotes || 12);
  const scrollPages = Number(options.scrollPages ?? settings.xhs.accountScrollPages ?? 8);
  const scrollDelayMs = Number(options.scrollDelayMs ?? settings.xhs.accountScrollDelayMs ?? 1200);
  const byNoteId = new Map();
  async function collectOnce() {
    const urls = await page.evaluate(() => {
      const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) => a.href);
      const html = document.documentElement.innerHTML;
      const absolute = Array.from(html.matchAll(/https?:\/\/www\.xiaohongshu\.com\/(?:explore|discovery\/item|user\/profile)\/[^"'<>\s\\]+/g)).map((match) => match[0]);
      const relative = Array.from(html.matchAll(/\/(?:explore|discovery\/item|user\/profile)\/[A-Za-z0-9][^"'<>\s\\]*/g)).map((match) => `https://www.xiaohongshu.com${match[0]}`);
      return [...hrefs, ...absolute, ...relative];
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
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 900)));
    await sleep(scrollDelayMs);
    await collectOnce();
    if (byNoteId.size === lastCount) {
      emptyScrollCount++;
      if (emptyScrollCount >= 3) break;
    } else {
      emptyScrollCount = 0;
      lastCount = byNoteId.size;
    }
  }
  return Array.from(byNoteId.values()).sort((a, b) => scoreXhsNoteUrl(b) - scoreXhsNoteUrl(a)).slice(0, maxNotes);
}

async function extractAccountNotes(page, input, options) {
  const rootDir = options.rootDir || process.cwd();
  const settings = envWithSettings(rootDir);
  const videoPreference = options.videoPreference || settings.download.videoPreference || "resolution";
  const videoMinHeight = options.videoMinHeight || settings.download.videoMinHeight || 0;
  const uniqueUrls = await extractAccountLinks(page, options);
  const notes = [];
  for (const url of uniqueUrls) {
    const httpResult = await fetchNoteViaHttp({ ...input, url }, options);
    if (httpResult) { notes.push(...httpResult); continue; }
    const child = await page.context().newPage();
    const networkBodies = [];
    attachResponseCollector(child, networkBodies);
    try {
      await child.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(2500);
      notes.push(await extractNote(child, { ...input, url }, networkBodies, videoPreference, videoMinHeight));
    } catch (error) {
      notes.push({ sourceUrl: url, platform: "小红书", title: "采集失败", status: "需人工复核", reviewReason: error.message, assets: [] });
    } finally { await child.close(); }
  }
  return notes;
}

export async function followAccount(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  let userId = input.userId || "";
  const authorUrl = input.authorUrl || "";
  if (!userId && authorUrl) userId = extractXhsId(authorUrl);
  if (!userId) throw new Error("需要提供 userId 或账号主页链接");

  const knownNoteIds = Array.isArray(input.knownNoteIds) ? input.knownNoteIds : [];
  const knownNoteIdSet = new Set(knownNoteIds.filter(Boolean));
  const isFirstFollow = knownNoteIds.length === 0;
  const allNotes = [];
  const seenNoteIds = new Set();
  let authorName = input.authorName || "";
  let avatarUrl = "";
  let noteUrls = [];
  let httpRiskError = null;
  const httpProfile = await fetchAccountNotesViaHttp(userId, { ...options, rootDir }).catch((e) => {
    if (e.message && e.message.includes("风控")) httpRiskError = e;
    return null;
  });
  if (httpProfile) {
    authorName = httpProfile.authorName || authorName;
    avatarUrl = httpProfile.avatarUrl || avatarUrl;
    noteUrls = httpProfile.noteUrls;
  }

  if (noteUrls.length) {
    let successCount = 0;
    let attemptedNewCount = 0;
    for (const url of noteUrls) {
      const noteId = extractXhsId(url);
      if (!noteId || seenNoteIds.has(noteId)) continue;
      if (!isFirstFollow && knownNoteIdSet.has(noteId)) { seenNoteIds.add(noteId); continue; }
      seenNoteIds.add(noteId);
      attemptedNewCount++;
      const httpResult = await fetchNoteViaHttp({ ...input, url }, { ...options, rootDir }).catch(() => null);
      if (httpResult && httpResult.length > 0) {
        const note = { ...httpResult[0], accountId: input.accountId || null, brand: input.brand || "" };
        note.authorName = note.authorName || authorName;
        note.authorId = note.authorId || userId;
        if (!authorName && note.authorName) authorName = note.authorName;
        allNotes.push(note);
        successCount++;
      }
    }
    const shouldFallback =
      // 首次跟随且 HTTP 路径一条都没有采集到
      (isFirstFollow && successCount === 0) ||
      // 有待采集的新笔记，但全部 HTTP 失败
      (attemptedNewCount > 0 && successCount === 0);
    if (!shouldFallback) {
      const allKnownIds = new Set([...knownNoteIdSet, ...seenNoteIds]);
      return { notes: allNotes, cursor: JSON.stringify(Array.from(allKnownIds)), authorName, avatarUrl, totalFound: allKnownIds.size };
    } else {
      for (const url of noteUrls) {
        const noteId = extractXhsId(url);
        if (noteId && !knownNoteIdSet.has(noteId)) {
          seenNoteIds.delete(noteId);
        }
      }
      log("info", `HTTP 快速路径无法成功解析任何新笔记（已尝试 ${attemptedNewCount} 篇），下放至 Playwright 降级流程。`);
    }
  }

  let headless = options.headless;
  if (httpRiskError && (headless === undefined || headless === true)) {
    console.log("[followAccount] HTTP 快速路径遇到风控，自动切换有头模式让用户处理验证码");
    headless = false;
  }
  if (headless === undefined) headless = false;
  const context = await openXhsContext(rootDir, options.cookie || "", {
    proxy: options.proxy || "", headless, cdpPort: options.cdpPort || 0
  });
  try {
    const page = await context.newPage();
    const profileUrl = `https://www.xiaohongshu.com/user/profile/${userId}`;
    await randomDelay(500, 1500);
    try {
      await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    } catch (navError) { console.error("[followAccount] 导航到 profile 页失败:", navError.message); }
    await randomDelay(800, 2000);
    if (!headless) {
      let waited = 0;
      while (waited < 120) {
        const u = page.url();
        if (!u.includes("/captcha") && !u.includes("/website-login")) break;
        if (waited === 0) console.log("[followAccount] 检测到验证码页面，请在浏览器窗口中手动滑动验证（最长等待 120 秒）");
        await sleep(3000);
        waited += 3;
      }
    }
    await sleep(4000);

    const checkStatus = await page.evaluate(() => {
      let isCaptcha = false;
      let isGuest = false;
      
      const captchaElements = document.querySelector(".secsdk-captcha-wrapper, #js-secsdk-svg, [class*='captcha'], [id*='captcha'], iframe[src*='captcha']");
      if (captchaElements) isCaptcha = true;
      
      try {
        const s = window.__INITIAL_STATE__;
        const userInfo = (s?.user?.userInfo?._value) || (s?.user?.userInfo?._rawValue) || s?.user?.userInfo;
        const userPageData = (s?.user?.userPageData?._value) || (s?.user?.userPageData?._rawValue) || s?.user?.userPageData;
        
        if (userInfo?.guest === true || userPageData?.guest === true || s?.user?.userPageData?._value?.guest === true) {
          isGuest = true;
        }
        if (!userInfo?.nickname && !userPageData?.basicInfo?.nickname) {
          const loginBox = document.querySelector("[class*='login'], [id*='login']");
          if (loginBox) isGuest = true;
        }
      } catch {
        isGuest = true;
      }
      
      return { isCaptcha, isGuest };
    }).catch(() => ({ isCaptcha: false, isGuest: false }));

    const currentUrl = page.url();
    if (currentUrl.includes("captcha") || currentUrl.includes("website-login") || checkStatus.isCaptcha) {
      if (headless) throw new Error("小红书风控验证码拦截。建议在设置中关闭「无头浏览器」后重试，以便手动处理验证码，或更换 IP/网络环境。");
      throw new Error("验证码等待超时（120 秒）。请稍后重试或更换 IP/网络环境。");
    }
    if (currentUrl.includes("/login") || checkStatus.isGuest) {
      const hint = checkStatus.isGuest ? "（Cookie 为访客会话，非登录态）" : "";
      throw new Error(`检测到登录页面重定向，Cookie 无效或已过期${hint}。请通过「账号管理」重新扫码登录或保存有效 Cookie。`);
    }

    let info = { name: "", avatar: "" };
    for (let attempt = 0; attempt < 3; attempt++) {
      info = await page.evaluate(() => {
        const title = document.title || "";
        const nameMatch = title.match(/^(.+?)\s*[-–—]\s*小红书/);
        const ogTitle = document.querySelector("meta[property='og:title']")?.content || "";
        const h1 = document.querySelector("h1, [class*='name'], [class*='nickname'], [class*='userName'], [class*='username']");
        const ogImage = document.querySelector("meta[property='og:image']")?.content || "";
        const avatarEl = document.querySelector("img[class*='avatar'], [class*='avatar'] img")?.src || "";
        let ssrName = "", ssrAvatar = "";
        try {
          const s = window.__INITIAL_STATE__;
          if (s) {
            const pd = s.user?.userPageData;
            const pageData = pd?._value || pd?._rawValue || pd || {};
            ssrName = pageData.basicInfo?.nickname || pageData.nickname || pageData.name || "";
            ssrAvatar = pageData.basicInfo?.image || pageData.avatar || pageData.avatar_url || pageData.avatarUrl || pageData.image || "";
          }
        } catch {}
        return {
          name: nameMatch ? nameMatch[1].trim() : (ogTitle && !ogTitle.includes("小红书") ? ogTitle.trim() : (h1?.textContent?.trim() || ssrName || "")),
          avatar: (() => {
            const isOfficial = (u) => {
              if (!u) return false;
              const l = String(u).toLowerCase();
              return l.includes("favicon") || l.includes("logo") || l.includes("fe-static") || l.includes("fe-platform") || l.includes("default_avatar") || l.includes("fe-video-qc");
            };
            if (ssrAvatar && !isOfficial(ssrAvatar)) return ssrAvatar;
            if (avatarEl && !isOfficial(avatarEl)) return avatarEl;
            if (ogImage && !isOfficial(ogImage)) return ogImage;
            return ssrAvatar || avatarEl || ogImage || "";
          })()
        };
      }).catch(() => ({ name: "", avatar: "" }));
      if (info.name) break;
      await sleep(3000); // 等待 JS 渲染完成（最多 3 次×3s）
    }
    if (!authorName) authorName = info.name;
    if (!avatarUrl) avatarUrl = info.avatar;

    const settings = envWithSettings(rootDir);
    const limitNotes = options.maxNotes || settings.xhs.maxAccountNotes || 100;
    const pages = options.scrollPages || settings.xhs.accountScrollPages || 15;
    noteUrls = await extractAccountLinks(page, { rootDir, maxNotes: limitNotes, scrollPages: pages });
    if (!noteUrls.length) {
      noteUrls = await page.evaluate(() => {
        try {
          const s = window.__INITIAL_STATE__;
          if (!s) return [];
          const notes = s.user?.notes || s.notes || s.noteResult || [];
          if (Array.isArray(notes)) return notes.map(n => {
            const id = n.id || n.note_id || n.noteId || "";
            if (!id) return "";
            const xsec = n.xsec_token || "";
            return xsec ? `https://www.xiaohongshu.com/explore/${id}?xsec_token=${xsec}` : `https://www.xiaohongshu.com/explore/${id}`;
          }).filter(Boolean);
          const html = document.documentElement.innerHTML;
          const matches = Array.from(html.matchAll(/\/explore\/([a-zA-Z0-9]+)/g));
          return [...new Set(matches.map(m => `https://www.xiaohongshu.com/explore/${m[1]}`))];
        } catch { return []; }
      }).catch(() => []);
    }
    if (!noteUrls.length) {
      try {
        const fallbackCookie = options.cookie || readXhsCookie(rootDir);
        const fallbackCtrl = new AbortController();
        const fallbackTimer = setTimeout(() => fallbackCtrl.abort(), 10000);
        let resp;
        try {
          resp = await fetch(profileUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36", Cookie: fallbackCookie },
            signal: fallbackCtrl.signal
          });
        } finally { clearTimeout(fallbackTimer); }
        const html = await resp.text();
        const initState = parseInitState(html);
        const userNotes = initState?.user?.notes || initState?.notes || initState?.noteResult || [];
        if (Array.isArray(userNotes) && userNotes.length) {
          noteUrls = userNotes.map(n => {
            const id = n.id || n.note_id || n.noteId || "";
            if (!id) return "";
            const xsec = n.xsec_token || "";
            return xsec ? `https://www.xiaohongshu.com/explore/${id}?xsec_token=${xsec}` : `https://www.xiaohongshu.com/explore/${id}`;
          }).filter(Boolean);
        }
      } catch (e) { console.error("[followAccount] HTTP 直连 profile 页失败:", e.message); }
    }
    if (!noteUrls.length) {
      const pageAnalysis = await page.evaluate(() => {
        const noteItems = document.querySelectorAll("a[href*='/explore/'], a[href*='/discovery/item/'], [class*='note-item']");
        const hasNotes = noteItems.length > 0;
        const hasBasicProfile = !!(document.querySelector(".nickname, .name, [class*='name'], [class*='avatar']") || document.title.includes("小红书"));
        const htmlText = document.body ? (document.body.innerText || "") : "";
        const isExplicitEmpty = htmlText.includes("还没有") || htmlText.includes("暂无") || htmlText.includes("空空") || htmlText.includes("无内容");
        return { hasNotes, hasBasicProfile, isExplicitEmpty };
      }).catch(() => ({ hasNotes: false, hasBasicProfile: false, isExplicitEmpty: false }));

      if (!pageAnalysis.hasNotes && !pageAnalysis.isExplicitEmpty) {
        if (!pageAnalysis.hasBasicProfile) {
          throw new Error("页面加载失败：未能在页面中检测到小红书账号基本信息，可能被防爬风控拦截或网络加载超时。");
        }
        throw new Error("列表加载异常：已获取到账号基本信息，但未能渲染作品列表，且未检测到内容为空的提示，请重试。");
      }
      return { notes: [], cursor: JSON.stringify(Array.from(knownNoteIdSet)), authorName, avatarUrl, totalFound: knownNoteIdSet.size };
    }

    for (const url of noteUrls) {
      const noteId = extractXhsId(url);
      if (!noteId || seenNoteIds.has(noteId)) continue;
      if (!isFirstFollow && knownNoteIdSet.has(noteId)) { seenNoteIds.add(noteId); continue; }
      seenNoteIds.add(noteId);
      await randomDelay(800, 2500);

      const httpResult = await fetchNoteViaHttp({ ...input, url }, { ...options, rootDir }).catch(() => null);
      if (httpResult && httpResult.length > 0) {
        const note = { ...httpResult[0], accountId: input.accountId || null, brand: input.brand || "" };
        note.authorName = note.authorName || authorName;
        note.authorId = note.authorId || userId;
        if (!authorName && note.authorName) authorName = note.authorName;
        allNotes.push(note);
        continue;
      }

      const child = await context.newPage();
      try {
        const childBodies = [];
        attachResponseCollector(child, childBodies);
        await child.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await child.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        const noteData = await extractNote(child, { ...input, url }, childBodies, options.videoPreference || "", options.videoMinHeight || 0);
        if (noteData) {
          noteData.accountId = input.accountId || null;
          noteData.brand = input.brand || "";
          noteData.authorName = noteData.authorName || authorName;
          noteData.authorId = noteData.authorId || userId;
          if (!authorName && noteData.authorName) authorName = noteData.authorName;
          allNotes.push(noteData);
        }
      } catch (e) {
        console.error(`[followAccount] 子页采集失败: ${url} - ${e.message}`);
      } finally { await child.close().catch(() => {}); }
    }
  } finally { await context.close(); }

  const allKnownIds = new Set([...knownNoteIdSet, ...seenNoteIds]);
  return { notes: allNotes, cursor: JSON.stringify(Array.from(allKnownIds)), authorName, avatarUrl, totalFound: allKnownIds.size };
}

export { extractAccountNotes, fetchAccountNotesViaHttp };
