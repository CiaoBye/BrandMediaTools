import { readXhsCookie, checkCookieValid } from "../xhsAuth.mjs";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let _cdpBrowserRef = null;

/**
 * 从 CDP Chrome 提取小红书 Cookie
 * 首次调用会启动 CDP Chrome，后续调用复用已有浏览器实例
 */
export async function saveXhsCookieFromBrowser(rootDir, options = {}) {
  const { launchCdpChrome } = await import("../xhsSdk.mjs");
  const { chromium } = await import("playwright");
  const settings = (await import("../settings.mjs")).envWithSettings(rootDir);
  const cdpPort = options.cdpPort || settings.xhs.cdpPort || 9222;

  let browser;
  try {
    browser = _cdpBrowserRef || await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  } catch {
    const result = await launchCdpChrome(cdpPort, rootDir);
    browser = result.browser;
  }

  _cdpBrowserRef = browser;

  let ctx = browser.contexts()[0];
  if (!ctx) {
    for (let i = 0; i < 6; i++) {
      await sleep(500);
      ctx = browser.contexts()[0];
      if (ctx) break;
    }
  }
  if (!ctx) {
    try { ctx = await browser.newContext(); } catch {
      throw new Error("未能建立浏览器上下文会话");
    }
  }

  // 始终从浏览器提取最新 Cookie（不信任文件里的旧 Cookie）
  let page = ctx.pages()[0] || await ctx.newPage();
  if (!page.url().includes("xiaohongshu.com")) {
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded", timeout: 45000,
    });
  }

  // 检测当前 URL 是否被重定向到登录页
  const currentUrl = page.url();
  if (currentUrl.includes("login") || currentUrl.includes("captcha")) {
    // 需要用户手动登录，等待最多 120 秒
    for (let i = 0; i < 120; i++) {
      const u = page.url();
      if (!u.includes("login") && !u.includes("captcha")) break;
      await sleep(1000);
    }
  }

  // 从浏览器提取 Cookie
  const browserCookies = await ctx.cookies("https://www.xiaohongshu.com");
  let cookieString = browserCookies
    .filter((c) => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  if (!cookieString.includes("a1=") || !cookieString.includes("web_session=")) {
    throw new Error("浏览器中未检测到小红书登录态。请在打开的 Chrome 中登录 xiaohongshu.com 后重试。");
  }

  const cookiePath = path.join(rootDir, "data", "xhs-cookie.txt");
  mkdirSync(path.dirname(cookiePath), { recursive: true });
  writeFileSync(cookiePath, cookieString, "utf8");
  try { (await import("../xhsApiClient.mjs")).clearCookieCache(); } catch {}

  return {
    ok: true, cookiePath,
    hasWebSession: cookieString.includes("web_session="),
    savedLength: cookieString.length,
    browserKeptAlive: !!_cdpBrowserRef,
    note: "已从浏览器提取最新 Cookie，优于文件旧 Cookie",
  };
}

/** 关闭 CDP 浏览器 */
export async function closeCdpBrowser() {
  if (_cdpBrowserRef) {
    try { await _cdpBrowserRef.close(); } catch {}
    _cdpBrowserRef = null;
  }
}

export function getCdpBrowser() { return _cdpBrowserRef; }

export async function whoami(rootDir, cookieOverride) {
  return checkCookieValid(rootDir, cookieOverride || readXhsCookie(rootDir));
}
