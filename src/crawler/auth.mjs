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

  // 如果已经有 Cookie 了，先尝试用现有 Cookie 访问
  const existingCookie = readXhsCookie(rootDir);
  let isLoggedIn = false;
  let cookieString = "";

  // 检查现有 Cookie 是否有效（访问首页看是否 200）
  if (existingCookie && existingCookie.includes("a1=") && existingCookie.includes("web_session=")) {
    try {
      const r = await fetch("https://www.xiaohongshu.com/explore", {
        headers: { Cookie: existingCookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        redirect: "manual",
      });
      if (r.status === 200) {
        isLoggedIn = true;
        cookieString = existingCookie;
      }
    } catch {}
  }

  let page;
  if (!isLoggedIn) {
    page = await ctx.newPage();
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded", timeout: 45000,
    });

    for (let i = 0; i < 120; i++) {
      const currentUrl = page.url();
      const cookies = await ctx.cookies("https://www.xiaohongshu.com");
      cookieString = cookies
        .filter((c) => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");

      if (cookieString.includes("a1=") && cookieString.includes("web_session=") && !currentUrl.includes("login")) {
        isLoggedIn = true;
        break;
      }
      await sleep(1000);
    }
  }

  if (!isLoggedIn) {
    throw new Error("登录超时或未检测到有效 Cookie。请在打开的浏览器中完成扫码登录。");
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
