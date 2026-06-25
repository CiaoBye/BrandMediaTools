import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const cdpPort = 9222;
const rootDir = process.cwd();

async function main() {
  // 1. 连接 CDP
  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  } catch {
    console.log("无法连接 CDP Chrome。请先通过测试脚本启动 Chrome。");
    console.log("node scratch/test_xhshow_pipeline.mjs");
    return;
  }

  // 2. 获取 cookies（先导航到小红书域确保 Cookie 可读）
  let ctx = browser.contexts()[0];
  if (!ctx) ctx = await browser.newContext();
  const pages = ctx.pages();
  const page = pages[0] || await ctx.newPage();
  if (!page.url().includes("xiaohongshu.com")) {
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  const cookies = await ctx.cookies("https://www.xiaohongshu.com");
  const cookieStr = cookies
    .filter(c => /xiaohongshu\.com$/.test(c.domain.replace(/^\./, "")))
    .map(c => `${c.name}=${c.value}`)
    .join("; ");

  console.log(`提取到 ${cookies.length} 个 Cookie`);
  console.log(`a1: ${cookieStr.includes("a1=")}, web_session: ${cookieStr.includes("web_session=")}`);

  if (cookieStr.includes("a1=") && cookieStr.includes("web_session=")) {
    // 保存
    const p = path.join(rootDir, "data", "xhs-cookie.txt");
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, cookieStr, "utf8");
    console.log(`\nCookie 已保存到 ${p} (${cookieStr.length} chars)`);

    // 3. 立即测试 API 调用
    console.log("\n测试 API 调用...");
    const signPort = 9223;
    try {
      const signResp = await fetch(`http://127.0.0.1:${signPort}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uri: "/api/sns/web/v1/user/selfinfo",
          cookies: Object.fromEntries(cookieStr.split(";").map(p => { const i = p.indexOf("="); return [p.slice(0,i).trim(), p.slice(i+1).trim()]; })),
          method: "post",
          payload: { user_id: "" },
          sign_format: "xyw",
        }),
      });
      const signResult = await signResp.json();
      if (!signResult.ok) {
        console.log(`签名失败: ${signResult.error}`);
        return;
      }
      console.log("签名成功，发起 API 请求...");

      const apiResp = await fetch("https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo", {
        method: "POST",
        headers: {
          ...signResult.headers,
          Cookie: cookieStr,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: "" }),
      });

      const status = apiResp.status;
      const text = await apiResp.text();
      try {
        const json = JSON.parse(text);
        console.log(`API 响应: ${status} success=${json.success} msg=${json.msg || ""} code=${json.code || ""}`);
        if (json.success) {
          const u = json.data?.user || json.data || {};
          console.log(`用户: ${u.nickname || u.user_name || ""} (${u.user_id || ""})`);
        }
      } catch {
        console.log(`API 响应: ${status} (非 JSON) ${text.slice(0, 100)}`);
      }
    } catch (e) {
      console.log(`API 请求异常: ${e.message}`);
    }
  } else {
    console.log("Cookie 缺少必要字段，请先在 Chrome 中登录小红书");
  }

  await browser.close();
}

main().catch(console.error);
