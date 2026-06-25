/**
 * 混合方案：xhshow 生成签名 + CDP 浏览器发出请求
 * 兼顾签名正确性和浏览器指纹
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const cdpPort = 9222;
const signPort = 9223;
const rootDir = process.cwd();

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 调用 xhshow 签名服务 */
async function getSignedHeaders(uri, method, cookies, payload = {}, params = {}) {
  const resp = await fetch(`http://127.0.0.1:${signPort}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri, cookies, method, params, payload, sign_format: "xyw" }),
  });
  const r = await resp.json();
  if (!r.ok) throw new Error(`签名失败: ${r.error}`);
  return r.headers;
}

async function main() {
  const { chromium } = await import("playwright");

  // 1. 连接 CDP
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  } catch {
    console.log("CDP Chrome 未运行，启动中...");
    const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const profileDir = path.join(rootDir, ".browser-profile", "chrome-cdp");
    mkdirSync(profileDir, { recursive: true });
    const batContent = `@echo off\ntaskkill /f /im chrome.exe >nul 2>&1\nping -n 4 127.0.0.1 >nul\nstart "" /min "${chromePath}" --remote-debugging-port=${cdpPort} --remote-allow-origins=* --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check --disable-gpu\n`;
    const batPath = path.join(rootDir, "data", ".cdp-launch.bat");
    writeFileSync(batPath, batContent, "utf8");
    const { execSync } = await import("node:child_process");
    execSync(`"${batPath}"`, { stdio: "ignore", timeout: 5000 });
    setTimeout(() => { try { rmSync(batPath, { force: true }); } catch {} }, 10000);
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`); break; } catch {}
    }
  }
  if (!browser) { console.log("CDP 启动失败"); return; }

  // 2. 获取 Cookie
  const ctx = browser.contexts()[0] || await browser.newContext();
  const pages = ctx.pages();
  const page = pages[0] || await ctx.newPage();
  if (!page.url().includes("xiaohongshu.com")) {
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  const cookies = await ctx.cookies("https://www.xiaohongshu.com");
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
  const cookieDict = {};
  cookies.forEach(c => { cookieDict[c.name] = c.value; });

  if (!cookieDict.a1 || !cookieDict.web_session) {
    console.log("❌ 未登录，请在 Chrome 中登录后重试");
    return;
  }

  // 保存 Cookie
  const p = path.join(rootDir, "data", "xhs-cookie.txt");
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, cookieStr, "utf8");
  console.log(`✅ Cookie 已加载 (a1=${!!cookieDict.a1}, web_session=${!!cookieDict.web_session})`);

  // 3. 测试各个端点（混合方案）
  const endpoints = [
    ["POST", "/api/sns/web/v1/feed", { source_note_id: "66d34b3a000000001b00e4b9" }, {}],
    ["GET", "/api/sns/web/v1/user_posted", {}, { user_id: "5e5f7f36000000000100e4b9", num: "30" }],
    ["POST", "/api/sns/web/v1/search/notes", { keyword: "母婴", page_size: 10, sort: "general", note_type: 0 }, {}],
  ];

  for (const [method, uri, payload, params] of endpoints) {
    console.log(`\n🌐 ${method} ${uri}`);
    try {
      // 3a. 用 xhshow 生成签名 headers
      const headers = await getSignedHeaders(uri, method, cookieDict, payload, params);
      console.log(`   签名: XYW_ ${headers["x-s"]?.slice(0, 60)}...`);

      // 3b. 在浏览器中执行请求（带上签名 headers + 真实 Cookie）
      const result = await page.evaluate(async ({ uri, method, params, payload, headers }) => {
        const base = "https://edith.xiaohongshu.com";
        const opts = {
          method,
          headers: {
            ...(JSON.parse(headers)),
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
          },
          credentials: "include",
        };

        let url;
        if (method === "POST") {
          opts.body = JSON.stringify(payload);
          url = base + uri;
        } else {
          const qs = new URLSearchParams(params).toString();
          url = base + uri + (qs ? "?" + qs : "");
        }

        const resp = await fetch(url, opts);
        const text = await resp.text();
        try {
          const json = JSON.parse(text);
          return { status: resp.status, success: json.success, code: json.code, msg: json.msg, data: json.data, raw: text.slice(0, 100) };
        } catch {
          return { status: resp.status, raw: text.slice(0, 100) };
        }
      }, { uri, method, params, payload, headers: JSON.stringify(headers) });

      console.log(`   状态: ${result.status}`);
      console.log(`   code: ${result.code} msg: ${result.msg || ""} success: ${result.success}`);
      if (result.data) {
        const s = JSON.stringify(result.data).slice(0, 150);
        console.log(`   data: ${s}`);
      }
    } catch (e) {
      console.log(`   ❌ 错误: ${e.message}`);
    }
  }

  console.log("\n=== 完成 ===");
}

main().catch(console.error);
