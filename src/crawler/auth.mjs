import { readXhsCookie, checkCookieValid } from "../xhsAuth.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 在全局持久浏览器中打开小红书等待用户登录，然后保存 Cookie
 * 后续所有抓取自动复用这个浏览器的登录态
 */
export async function saveXhsCookieFromBrowser(rootDir, options = {}) {
  const { getGlobalContext, initGlobalBrowser } = await import("../xhsSdk.mjs");

  // 确保全局浏览器已启动
  let ctx = getGlobalContext();
  if (!ctx) {
    await initGlobalBrowser(rootDir);
    ctx = getGlobalContext();
  }

  // 在浏览器中打开小红书
  const pages = ctx.pages();
  let page = pages[0] || await ctx.newPage();
  if (!page.url().includes("xiaohongshu.com")) {
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded", timeout: 45000,
    });
  }

  // 检测是否已登录
  const currentUrl = page.url();
  if (currentUrl.includes("login") || currentUrl.includes("captcha")) {
    console.log("[auth] 检测到登录页，等待用户在浏览器中登录...");
    for (let i = 0; i < 120; i++) {
      const u = page.url();
      if (!u.includes("login") && !u.includes("captcha")) break;
      await sleep(1000);
    }
  }

  // 从浏览器提取 Cookie
  const cookies = await ctx.cookies("https://www.xiaohongshu.com");
  const cookieStr = cookies
    .filter((c) => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  if (!cookieStr.includes("a1=") || !cookieStr.includes("web_session=")) {
    throw new Error("浏览器中未检测到小红书登录态。请在打开的浏览器中登录后重试。");
  }

  // 保存到文件（供其他模块读取）
  const cookiePath = path.join(rootDir, "data", "xhs-cookie.txt");
  mkdirSync(path.dirname(cookiePath), { recursive: true });
  writeFileSync(cookiePath, cookieStr, "utf8");
  try { (await import("../xhsApiClient.mjs")).clearCookieCache(); } catch {}

  return {
    ok: true, cookiePath,
    hasWebSession: cookieStr.includes("web_session="),
    savedLength: cookieStr.length,
    note: "全局浏览器登录态已保存，后续抓取自动复用",
  };
}

export async function whoami(rootDir, cookieOverride) {
  return checkCookieValid(rootDir, cookieOverride || readXhsCookie(rootDir));
}
