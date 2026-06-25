import { randomBytes } from "node:crypto";
import { sleep, createBrowser, getGlobalContext, initGlobalBrowser } from "./xhsSdk.mjs";

const sessions = new Map();

export async function startQrLogin(rootDir, accountName = "default", options = {}) {
  const existing = sessions.get(accountName);
  if (existing) {
    try { await existing.browser.close(); } catch {}
    sessions.delete(accountName);
  }

  // 优先使用全局持久浏览器（头模式或无头模式均可扫码）
  let context = getGlobalContext();
  let browser = null;
  if (!context) {
    const result = await createBrowser(rootDir, { headless: false, proxy: options.proxy });
    browser = result.browser;
    context = result.context;
  }

  const page = await context.newPage();
  await page.goto("https://www.xiaohongshu.com/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(5000);

  // 提取二维码
  let qrBase64 = null;
  try {
    qrBase64 = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (c) return c.toDataURL("image/png");
      const imgs = Array.from(document.images);
      const q = imgs.find((img) => img.src && (img.src.includes("qr") || (img.width > 80 && img.width < 400)));
      return q ? q.src : null;
    });
  } catch {}
  if (!qrBase64) {
    try {
      const el = await page.$("canvas") || await page.$('[class*="qr"]') || await page.$(".qrcode-img");
      if (el) {
        const buf = await el.screenshot({ type: "png" });
        qrBase64 = `data:image/png;base64,${buf.toString("base64")}`;
      }
    } catch {}
  }
  if (!qrBase64) {
    if (browser) try { await browser.close(); } catch {}
    throw new Error("登录页已打开，但未识别到二维码。请检查网络后重试。");
  }

  const sessionId = Date.now().toString(36) + randomBytes(4).toString("hex");
  const initialCookies = await context.cookies(["https://www.xiaohongshu.com"]);
  sessions.set(accountName, { sessionId, browser, context, page, startTime: Date.now(), accountName, initialCookies });
  return { sessionId, accountName, qrBase64 };
}

export async function checkQrLoginStatus(accountName) {
  const session = sessions.get(accountName);
  if (!session) return { status: "expired" };
  try {
    const page = session.page;
    const currentUrl = page.url();

    // URL 已离开登录页 → 等待 Cookie 就绪后判定
    if (!currentUrl.includes("/login")) {
      await sleep(1500);
      const cookies = await session.context.cookies(["https://www.xiaohongshu.com"]);
      if (cookies.some((c) => c.name === "web_session" && c.value.length > 10)) {
        return { status: "logged_in", cookieCount: cookies.length };
      }
      return { status: "pending" };
    }

    // 仍在登录页 → 检查当前页面状态是否变更
    const stateRaw = await page.evaluate(() => {
      try {
        const s = window.__INITIAL_STATE__;
        if (!s) return { _error: "no_state" };
        const ui = s.user?.userInfo;
        const val = ui?._value || ui?._rawValue || ui;
        const pd = s.user?.userPageData;
        const pdVal = pd?._value || pd?._rawValue || pd;
        return {
          loggedIn: s.user?.loggedIn,
          guest: val?.guest,
          userId: val?.userId,
          userInfoKeys: typeof ui === 'object' && ui ? Object.keys(ui).slice(0, 10) : typeof ui,
          pageDataKeys: typeof pd === 'object' && pd ? Object.keys(pd).slice(0, 5) : typeof pd,
          hasUser: !!s.user,
          pageDataStr: JSON.stringify(pdVal).slice(0, 200),
          valStr: JSON.stringify(val).slice(0, 200)
        };
      } catch (e) { return { _error: e.message }; }
    });
    const isLogged = stateRaw.loggedIn === true || (stateRaw.userId && stateRaw.guest !== true);
    if (isLogged) {
      await sleep(1500);
      return { status: "logged_in", cookieCount: 1 };
    }

    if (Date.now() - session.startTime > 300000) return { status: "timeout" };
    return { status: "pending" };
  } catch { return { status: "expired" }; }
}

export async function collectQrCookies(accountName) {
  const session = sessions.get(accountName);
  if (!session) return { ok: false, error: "会话已过期" };
  try {
    // 等待 Cookie 稳定
    await sleep(2000);
    const cookies = await session.context.cookies(["https://www.xiaohongshu.com"]);
    const cookieString = cookies
      .filter((c) => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const hasSession = cookies.some((c) => c.name === "web_session" && c.value.length > 10);
    if (!hasSession) return { ok: false, error: "未检测到有效登录会话，请重新扫码" };

    // 提取真实昵称（多重降级）
    let nickname = "";
    try {
      const p = await session.context.newPage();
      await p.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 15000 });
      await sleep(4000);
      nickname = await p.evaluate(() => {
        // 1. __INITIAL_STATE__ 中的用户信息
        try {
          const s = window.__INITIAL_STATE__;
          if (!s) return "";
          const ui = s.user?.userInfo;
          if (ui) {
            const val = ui._value || ui._rawValue || ui;
            if (val.nickname) return val.nickname;
          }
          // userPageData 也可能包含
          const pd = s.user?.userPageData;
          if (pd) {
            const pageData = pd._value || pd._rawValue || pd;
            if (pageData.basicInfo?.nickname) return pageData.basicInfo.nickname;
          }
          // feed 中可能有当前用户信息
          const feedState = s.feed;
          if (feedState?.userInfo?.nickname) return feedState.userInfo.nickname;
        } catch {}
        // 2. DOM 降级：页面上的用户名元素
        for (const sel of ["[class*='username'] [class*='name']", "[class*='nickname']", ".user-name", "[class*='user'] [class*='name']", "[class*='userName']"]) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        // 3. <title> 降级
        const title = document.title;
        const m = title.match(/^(.+?)\s*[-–—]\s*小红书/);
        if (m) return m[1].trim();
        return "";
      });
      await p.close();
    } catch {}
    return { ok: true, cookieString, cookieCount: cookies.length, nickname: nickname || accountName };
  } finally {
    if (session.browser) try { await session.browser.close(); } catch {}
    sessions.delete(accountName);
  }
}

export function cancelQrLogin(accountName) {
  const session = sessions.get(accountName);
  if (session) {
    if (session.browser) session.browser.close().catch(() => {});
    sessions.delete(accountName);
  }
}

export function closeAllSessions() {
  for (const [, session] of sessions) {
    if (session.browser) session.browser.close().catch(() => {});
  }
  sessions.clear();
}
