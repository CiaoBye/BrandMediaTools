import { openXhsContext, sleep } from "../xhsSdk.mjs";
import { readXhsCookie, checkCookieValid } from "../xhsAuth.mjs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export async function saveXhsCookieFromBrowser(rootDir, options = {}) {
  const context = await openXhsContext(rootDir, "", { ...options, headless: false });
  try {
    const page = await context.newPage();
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(Number(options.waitMs || 8000));
    const cookies = await context.cookies(["https://www.xiaohongshu.com"]);
    const cookieString = cookies
      .filter((cookie) => /xiaohongshu\.com$/.test(cookie.domain.replace(/^\./, "")))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    if (!cookieString) throw new Error("未读取到小红书 Cookie。请先在弹出的浏览器中正常登录后再保存。");
    const cookiePath = path.join(rootDir, "data", "xhs-cookie.txt");
    mkdirSync(path.dirname(cookiePath), { recursive: true });
    writeFileSync(cookiePath, cookieString, "utf8");
    return { ok: true, cookiePath, cookieCount: cookies.length, savedLength: cookieString.length };
  } finally { await context.close(); }
}

export async function whoami(rootDir, cookieOverride) {
  return checkCookieValid(rootDir, cookieOverride || readXhsCookie(rootDir));
}
