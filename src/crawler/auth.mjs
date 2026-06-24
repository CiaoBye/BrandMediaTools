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
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  } catch {
    // 自动启动 CDP Chrome
    const result = await launchCdpChrome(cdpPort, rootDir);
    browser = result.browser;
  }

  try {
    const ctx = browser.contexts()[0] || await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded", timeout: 45000,
    });

    const url = page.url();
    if (url.includes("login")) {
      throw new Error("Chrome 未登录小红书。请在浏览器窗口中登录小红书后再试。");
    }

    await sleep(Number(options.waitMs || 3000));

    const cookies = await ctx.cookies("https://www.xiaohongshu.com");
    const cookieString = cookies
      .filter((c) => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    if (!cookieString || !cookieString.includes("a1=")) {
      throw new Error("未检测到小红书 Cookie。请确保在 Chrome 中已登录小红书。");
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
    try { await browser.close(); } catch {}
  }
}

export async function whoami(rootDir, cookieOverride) {
  return checkCookieValid(rootDir, cookieOverride || readXhsCookie(rootDir));
}
