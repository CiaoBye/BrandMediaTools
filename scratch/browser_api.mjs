/**
 * 在 CDP Chrome 浏览器上下文中执行小红书 API 请求
 * 利用浏览器真实的 JS 环境 + Cookie + 指纹绕过 WAF
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const cdpPort = 9222;
const rootDir = process.cwd();

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 确保 CDP Chrome 运行中 */
async function ensureCdp() {
  const { chromium } = await import("playwright");
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    return browser;
  } catch {
    console.log("启动 CDP Chrome...");
    const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const profileDir = path.join(rootDir, ".browser-profile", "chrome-cdp");
    mkdirSync(profileDir, { recursive: true });
    const batContent = `@echo off\ntaskkill /f /im chrome.exe >nul 2>&1\nping -n 4 127.0.0.1 >nul\nstart "" /min "${chromePath}" --remote-debugging-port=${cdpPort} --remote-allow-origins=* --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check --disable-gpu\n`;
    const batPath = path.join(rootDir, "data", ".cdp-launch.bat");
    writeFileSync(batPath, batContent, "utf8");
    execSync(`"${batPath}"`, { stdio: "ignore", timeout: 5000 });
    setTimeout(() => { try { rmSync(batPath, { force: true }); } catch {} }, 10000);

    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      try {
        const b = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        console.log(`CDP 已就绪 (${i + 1}s)`);
        return b;
      } catch {}
    }
    throw new Error("CDP Chrome 启动超时");
  }
}

/** 在浏览器页面的 JS 上下文中执行 API 请求 */
async function apiViaBrowser(uri, method = "GET", params = {}, payload = {}) {
  const browser = await ensureCdp();
  const ctx = browser.contexts()[0] || await browser.newContext();
  const pages = ctx.pages();
  const page = pages[0] || await ctx.newPage();

  // 先确保在小红书域上（让 Cookie 可用）
  if (!page.url().includes("xiaohongshu.com")) {
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  // 在浏览器中执行 API 请求
  const result = await page.evaluate(async ({ uri, method, params, payload }) => {
    const base = "https://edith.xiaohongshu.com";
    let url;
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
      },
    };

    if (method === "POST") {
      opts.body = JSON.stringify(payload);
      url = base + uri;
    } else {
      const qs = new URLSearchParams(params).toString();
      url = base + uri + (qs ? "?" + qs : "");
    }

    try {
      const resp = await fetch(url, opts);
      const text = await resp.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      return {
        status: resp.status,
        success: json?.success,
        code: json?.code,
        msg: json?.msg,
        data: json?.data || json,
        raw: text.slice(0, 200),
      };
    } catch (err) {
      return { status: 0, error: err.message };
    }
  }, { uri, method, params, payload });

  return result;
}

async function main() {
  // 让用户先确认登录
  const browser = await ensureCdp();
  const ctx = browser.contexts()[0] || await browser.newContext();
  const cookies = await ctx.cookies("https://www.xiaohongshu.com");
  const hasA1 = cookies.some(c => c.name === "a1");
  const hasWebSession = cookies.some(c => c.name === "web_session");

  if (!hasA1 || !hasWebSession) {
    console.log("❌ 未检测到登录态");
    console.log("请在弹出的 Chrome 窗口中登录 xiaohongshu.com，然后重新运行此脚本");
    // 打开小红书让用户登录
    const pages = ctx.pages();
    const page = pages[0] || await ctx.newPage();
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("等待 120 秒供用户登录...");
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      const c = await ctx.cookies("https://www.xiaohongshu.com");
      if (c.some(x => x.name === "a1") && c.some(x => x.name === "web_session")) {
        console.log(`✅ 已检测到登录 (${i + 1}s)`);
        break;
      }
      if (i % 10 === 9) console.log(`  等待中... ${i + 1}s`);
    }
  } else {
    console.log("✅ 已有登录态");
  }

  // 保存 Cookie
  const allCookies = await ctx.cookies("https://www.xiaohongshu.com");
  const cookieStr = allCookies
    .filter(c => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
    .map(c => `${c.name}=${c.value}`)
    .join("; ");
  const p = path.join(rootDir, "data", "xhs-cookie.txt");
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, cookieStr, "utf8");
  console.log(`Cookie 已保存 (${cookieStr.length} chars)`);

  // 测试各端点
  const endpoints = [
    ["POST", "/api/sns/web/v1/feed", {}, { source_note_id: "66d34b3a000000001b00e4b9" }],
    ["GET", "/api/sns/web/v1/user_posted", { user_id: "5e5f7f36000000000100e4b9", num: "30" }, {}],
    ["POST", "/api/sns/web/v1/search/notes", {}, { keyword: "母婴", page_size: 10, sort: "general", note_type: 0 }],
  ];

  for (const [method, uri, params, payload] of endpoints) {
    console.log(`\n🌐 ${method} ${uri}`);
    const result = await apiViaBrowser(uri, method, params, payload);
    console.log(`  状态: ${result.status}`);
    console.log(`  响应: success=${result.success} code=${result.code} msg=${result.msg}`);
    if (result.data) {
      const d = JSON.stringify(result.data).slice(0, 200);
      console.log(`  data: ${d}`);
    }
  }

  console.log("\n=== 测试完成 ===");
  // 不关闭浏览器，保持会话
}

main().catch(console.error);
