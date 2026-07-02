import { checkCookieValid } from "../xhsAuth.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { envWithSettings } from "../settings.mjs";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Race a promise against a timeout.
 */
async function withTimeout(promise, ms, label) {
  let timer = null;
  const result = await Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label || "操作超时（" + ms + "ms）")), ms);
    })
  ]);
  if (timer) clearTimeout(timer);
  return result;
}

/**
 * 在全局浏览器中导航到小红书，等待用户登录（头模式）或提取已有 Cookie（无头模式）
 */
export async function saveXhsCookieFromBrowser(rootDir, options = {}) {
  const { getGlobalContext, launchCdpChrome, getPlaywright, findInstalledBrowser } = await import("../xhsSdk.mjs");
  const settings = envWithSettings(rootDir);
  const waitMs = Number(options.waitMs || 120000);
  // deadline 在 while 循环前重新计算，排除浏览器创建和导航的耗时
  const interactive = options.interactive !== false;
  let browser = null;
  let ctx = null;
  let browserOwnedByTool = false;
  let contextOwnedByTool = false;

  async function openAuthProfile(headless) {
    const { chromium } = await getPlaywright();
    const profileDir = path.join(rootDir, ".browser-profile", "chrome-cdp");
    mkdirSync(profileDir, { recursive: true });
    const executablePath = settings.xhs.browserExecutable || findInstalledBrowser() || "";
    const launchOptions = {
      headless,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-component-update",
        "--disable-sync",
        "--disable-background-networking",
        "--window-size=1440,960"
      ],
      viewport: { width: 1440, height: 900 },
      userAgent: settings.xhs.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai"
    };
    if (executablePath) launchOptions.executablePath = executablePath;
    const proxyUrl = options.proxy || settings.xhs.proxy || process.env.XHS_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "";
    if (proxyUrl) {
      launchOptions.proxy = { server: proxyUrl };
    }
    try {
      contextOwnedByTool = true;
      return await withTimeout(
        chromium.launchPersistentContext(profileDir, launchOptions),
        20000,
        "专用浏览器 profile 启动超时（20秒）。请关闭已打开的专用浏览器窗口后重试。"
      );
    } catch (error) {
      contextOwnedByTool = false;
      throw new Error(`专用浏览器 profile 启动失败：${error.message}`);
    }
  }

  async function closeOwnedBrowser() {
    if (contextOwnedByTool && ctx) {
      try { await ctx.close(); } catch {}
      return;
    }
    if (browserOwnedByTool && browser) {
      try { await browser.close(); } catch {}
    }
  }

  if (!interactive && settings.xhs.cdpPort > 0) {
    // 非交互模式（健康巡检等）才走 CDP
    try {
      const cdp = await withTimeout(launchCdpChrome(settings.xhs.cdpPort, rootDir), 15000, "CDP Chrome 启动超时（15秒）。请确认 Chrome 未在运行，或检查设置中的调试端口。");
      browser = cdp.browser;
      ctx = cdp.context;
      browserOwnedByTool = cdp.launchedByTool === true;
    } catch (acqErr) {
      console.warn("[auth] CDP 模式失败，降级为 createBrowser:", acqErr.message?.slice(0, 60));
    }
  }
  if (!ctx) {
    if (interactive) {
      ctx = await openAuthProfile(false);
    } else {
      try {
        ctx = await openAuthProfile(true);
      } catch (profileError) {
        console.warn("[auth] 专用 profile 后台读取失败，尝试全局上下文:", profileError.message?.slice(0, 80));
        ctx = getGlobalContext();
      }
    }
  }
  if (!ctx) {
    throw new Error("未能打开专用浏览器授权态。请先通过「打开专用浏览器绑定」完成一次正常登录。");
  }

  const pages = ctx.pages();
  let page = pages[0] || await ctx.newPage();

  async function pageAuthState() {
    try {
      return await page.evaluate(() => {
        const unwrap = (v) => (v && typeof v === "object" ? (v._value || v._rawValue || v) : v || {});
        const s = window.__INITIAL_STATE__ || {};
        const user = s.user || {};
        const userInfo = unwrap(user.userInfo);
        const pageData = unwrap(user.userPageData);
        const loggedIn = unwrap(user.loggedIn);
        const auth = unwrap(user.auth);
        const basic = pageData.basicInfo || {};
        const rawUserId = userInfo.userId || userInfo.id || basic.userId || basic.redId || "";
        const userId = /^guest/i.test(String(rawUserId || "")) ? "" : rawUserId;
        const nickname = userInfo.nickname || basic.nickname || "";
        const isGuest = !userId || !nickname;
        const isLoggedIn = Boolean(userId) && Boolean(nickname);
        const body = document.body.innerText || "";
        return {
          isLoggedIn,
          isGuest,
          nickname,
          userId,
          hasLoginText: body.includes("登录小红书") || body.includes("手机号登录") || body.includes("请输入手机号"),
          path: location.pathname
        };
      });
    } catch {
      return { isLoggedIn: false, isGuest: true, nickname: "", userId: "", hasLoginText: false, path: "" };
    }
  }

  async function collectCookieString() {
    const cookies = await ctx.cookies("https://www.xiaohongshu.com");
    return cookies
      .filter((c) => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  let nickname = "";
  let cookieStr = "";
  let state = null;
  await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await sleep(2500);
  state = await pageAuthState();
  if (!state.isLoggedIn) {
    if (!interactive) {
      await closeOwnedBrowser();
      throw new Error("专用浏览器当前不是有效登录态，后台刷新跳过。请先通过「打开专用浏览器绑定」完成一次正常登录。");
    }
    console.log("[auth] 当前不是有效登录态，已打开登录页，请在弹出的浏览器窗口中正常登录小红书。");
    await page.goto("https://www.xiaohongshu.com/login", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    // Check if the page/context is still alive
    try { await page.evaluate(() => 1); } catch (navErr) {
      const remainingMs = deadline - Date.now();
      if (remainingMs > 10000) {
        console.warn("[auth] 浏览器页面不可访问，尝试重建...", navErr.message?.slice(0, 60));
        try { page = await ctx.newPage(); } catch { page = null; }
        if (page) {
          await page.goto("https://www.xiaohongshu.com/login", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        }
      } else {
        break;
      }
    }
    await sleep(2000);
    cookieStr = await collectCookieString();
    state = await pageAuthState();
    const hasWebSession = cookieStr.includes("web_session=");
    if (hasWebSession && state.isLoggedIn) {
      nickname = state.nickname || "";
      break;
    }
    if (interactive && !page.url().includes("xiaohongshu.com")) {
      await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    }
  }

  if (!cookieStr.includes("a1=") || !cookieStr.includes("web_session=")) {
    await closeOwnedBrowser();
    throw new Error("未检测到完整的小红书登录 Cookie。请在弹出的专用 Chrome 中完成登录后重试。");
  }

  const valid = await checkCookieValid(rootDir, cookieStr);
  if (!valid.valid) {
    await closeOwnedBrowser();
    throw new Error(`浏览器 Cookie 仍不是有效登录态：${valid.reason}`);
  }

  const cookiePath = path.join(rootDir, "data", "xhs-cookie.txt");
  mkdirSync(path.dirname(cookiePath), { recursive: true });
  const savedCookie = valid.cookieUpdated || cookieStr;
  writeFileSync(cookiePath, savedCookie, "utf8");
  await closeOwnedBrowser();

  return {
    ok: true, cookiePath,
    hasWebSession: savedCookie.includes("web_session="),
    savedLength: savedCookie.length,
    nickname: nickname || valid.nickname || "",
    note: "Cookie 已从专用浏览器授权态提取并保存",
  };
}

export async function whoami(rootDir, cookieOverride) {
  return checkCookieValid(rootDir, cookieOverride || readXhsCookie(rootDir));
}
