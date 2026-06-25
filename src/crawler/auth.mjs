import { readXhsCookie, checkCookieValid } from "../xhsAuth.mjs";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 从 CDP Chrome 提取小红书 Cookie
 * 1. 尝试连接已有 CDP Chrome
 * 2. 连接失败则自动启动（强杀旧进程 + --remote-debugging-port）
 * 3. 提取 Cookie → 保存到 data/xhs-cookie.txt
 */
export async function saveXhsCookieFromBrowser(rootDir, options = {}) {
  const { launchCdpChrome } = await import("../xhsSdk.mjs");
  const { chromium } = await import("playwright");
  const settings = (await import("../settings.mjs")).envWithSettings(rootDir);
  const cdpPort = options.cdpPort || settings.xhs.cdpPort || 9222;

  let browser;
  let selfLaunched = false; // 区分「连接已有」vs「自行启动」
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  } catch {
    // 自动启动 CDP Chrome
    const result = await launchCdpChrome(cdpPort, rootDir);
    browser = result.browser;
    selfLaunched = true;
  }

  try {
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
        throw new Error("未能建立浏览器上下文会话，请确保 Chrome 浏览器已完全启动且处于可用状态。");
      }
    }
    const page = await ctx.newPage();
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded", timeout: 45000,
    });

    // 登录等待循环，最长 60 秒，若检测到 a1 cookie 且 URL 不含 login，则代表登录成功
    let isLoggedIn = false;
    let cookies = [];
    let cookieString = "";
    
    for (let i = 0; i < 60; i++) {
      const currentUrl = page.url();
      cookies = await ctx.cookies("https://www.xiaohongshu.com");
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

    if (!isLoggedIn) {
      throw new Error("登录超时或未检测到有效的小红书 Cookie。请确保在打开的浏览器中完成扫码或验证码登录。");
    }

    const cookiePath = path.join(rootDir, "data", "xhs-cookie.txt");
    mkdirSync(path.dirname(cookiePath), { recursive: true });
    writeFileSync(cookiePath, cookieString, "utf8");
    // 通知 API 客户端清缓存
    try { (await import("../xhsApiClient.mjs")).clearCookieCache(); } catch {}

    return {
      ok: true, cookiePath, cookieCount: cookies.length,
      hasWebSession: cookieString.includes("web_session="),
      savedLength: cookieString.length,
    };
  } finally {
    // 仅关闭自行启动的浏览器，不关闭用户已有的外部 Chrome
    if (selfLaunched) try { await browser.close(); } catch {}
  }
}

export async function whoami(rootDir, cookieOverride) {
  return checkCookieValid(rootDir, cookieOverride || readXhsCookie(rootDir));
}
