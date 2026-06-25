import { readXhsCookie, checkCookieValid } from "../xhsAuth.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 在全局浏览器中导航到小红书，等待用户登录（头模式）或提取已有 Cookie（无头模式）
 */
export async function saveXhsCookieFromBrowser(rootDir, options = {}) {
  const { getGlobalContext, initGlobalBrowser } = await import("../xhsSdk.mjs");

  let ctx = getGlobalContext();
  if (!ctx) {
    await initGlobalBrowser(rootDir);
    ctx = getGlobalContext();
  }

  const pages = ctx.pages();
  let page = pages[0] || await ctx.newPage();

  if (!page.url().includes("xiaohongshu.com")) {
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded", timeout: 45000,
    });
  }

  const currentUrl = page.url();
  const headless = options.headless !== undefined ? options.headless : true;

  if (!headless && (currentUrl.includes("login") || currentUrl.includes("captcha"))) {
    console.log("[auth] 有头模式等待用户在浏览器中登录...");
    for (let i = 0; i < 120; i++) {
      const u = page.url();
      if (!u.includes("login") && !u.includes("captcha")) break;
      await sleep(1000);
    }
  }

  const cookies = await ctx.cookies("https://www.xiaohongshu.com");
  const cookieStr = cookies
    .filter((c) => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  if (!cookieStr.includes("a1=")) {
    throw new Error("未检测到小红书的 Cookie。请通过「扫码登录」或手动粘贴 Cookie。");
  }

  const cookiePath = path.join(rootDir, "data", "xhs-cookie.txt");
  mkdirSync(path.dirname(cookiePath), { recursive: true });
  writeFileSync(cookiePath, cookieStr, "utf8");
  try { (await import("../xhsApiClient.mjs")).clearCookieCache(); } catch {}

  return {
    ok: true, cookiePath,
    hasWebSession: cookieStr.includes("web_session="),
    savedLength: cookieStr.length,
    note: "Cookie 已从全局浏览器提取并保存",
  };
}

export async function whoami(rootDir, cookieOverride) {
  return checkCookieValid(rootDir, cookieOverride || readXhsCookie(rootDir));
}
