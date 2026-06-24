import { readXhsCookie, checkCookieValid } from "../xhsAuth.mjs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { envWithSettings } from "../settings.mjs";
import path from "node:path";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 从 CDP Chrome 提取小红书 Cookie
 * 1. 连接已运行的 Chrome（需 --remote-debugging-port=9222）
 * 2. 导航到小红书
 * 3. 提取 Cookie → 保存到 data/xhs-cookie.txt
 */
export async function saveXhsCookieFromBrowser(rootDir, options = {}) {
  const { chromium } = await (await import("playwright")).chromium;
  const settings = envWithSettings(rootDir);
  const cdpPort = options.cdpPort || settings.xhs.cdpPort || 9222;

  // 仅连接已有 Chrome，不启动新进程
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  } catch {
    throw new Error(
      `Chrome CDP 连接失败（端口 ${cdpPort}）。\n` +
      `请先完全关闭所有 Chrome，然后用以下命令重新启动：\n` +
      `  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${cdpPort}\n` +
      `启动后在 Chrome 中登录小红书，再点击「从 Chrome 提取 Cookie」。`
    );
  }

  try {
    const ctx = browser.contexts()[0] || await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded", timeout: 45000,
    });
    await sleep(Number(options.waitMs || 5000));

    const cookies = await ctx.cookies("https://www.xiaohongshu.com");
    const cookieString = cookies
      .filter((c) => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    if (!cookieString || !cookieString.includes("a1=")) {
      throw new Error("未检测到小红书登录态（缺少 a1 cookie）。");
    }

    const cookiePath = path.join(rootDir, "data", "xhs-cookie.txt");
    mkdirSync(path.dirname(cookiePath), { recursive: true });
    writeFileSync(cookiePath, cookieString, "utf8");

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
