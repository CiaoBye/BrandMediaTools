import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

const rootDir = process.cwd();
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = 9222;
const signPort = 9223;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 1. 先测试 sign server
console.log("[1] 检测 sign server...");
try {
  const r = await fetch(`http://127.0.0.1:${signPort}/status`);
  const s = await r.json();
  console.log("  sign server:", JSON.stringify(s));
} catch {
  console.log("  sign server 未运行，跳过");
}

// 2. 检测 Cookie
console.log("\n[2] 检测 Cookie...");
const cookieFile = path.join(rootDir, "data", "xhs-cookie.txt");
if (existsSync(cookieFile)) {
  const cookie = readFileSync(cookieFile, "utf8").trim();
  const hasA1 = cookie.includes("a1=");
  const hasWebSession = cookie.includes("web_session=");
  const fields = cookie.split(";").length;
  console.log(`  文件存在: ${cookie.length} chars, ${fields} 字段, a1=${hasA1}, web_session=${hasWebSession}`);
  if (!hasA1 || !hasWebSession || cookie.includes("fake")) {
    console.log("  Cookie 无效，需要重新提取");
  } else {
    console.log("  Cookie 看起来有效");
  }
} else {
  console.log("  无 Cookie 文件");
}

// 3. 尝试生成签名测试
console.log("\n[3] 测试签名生成...");
try {
  const resp = await fetch(`http://127.0.0.1:${signPort}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uri: "/api/sns/web/v1/user/selfinfo",
      cookies: { a1: "19ab1e5ce48c3b3c5c50e2c040a801cfcca0a4ac50000571046" },
      method: "post",
      payload: { user_id: "" },
      sign_format: "xyw",
    }),
  });
  const result = await resp.json();
  if (result.ok) {
    const xs = result.headers["x-s"] || "";
    console.log(`  签名成功, x-s=${xs.slice(0, 60)}...`);
    console.log(`  格式: ${xs.startsWith("XYW_") ? "XYW_ ✅" : xs.startsWith("XYS_") ? "XYS_" : "未知"}`);
  } else {
    console.log("  签名失败:", result.error);
  }
} catch (e) {
  console.log("  签名服务异常:", e.message);
}

// 4. 如果需要，启动 CDP Chrome 让用户登录
console.log("\n[4] CDP Chrome 状态...");
try {
  const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  const v = await r.json();
  console.log(`  CDP 已连接: ${v.Browser?.slice(0, 40)}`);
} catch {
  console.log("  无 CDP 连接，启动 Chrome...");
  const profileDir = path.join(rootDir, ".browser-profile", "chrome-cdp");
  mkdirSync(profileDir, { recursive: true });
  const batContent = `@echo off
taskkill /f /im chrome.exe >nul 2>&1
ping -n 4 127.0.0.1 >nul
start "" /min "${chromePath}" --remote-debugging-port=${cdpPort} --remote-allow-origins=* --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check --disable-gpu
`;
  const batPath = path.join(rootDir, "data", ".cdp-launch.bat");
  writeFileSync(batPath, batContent, "utf8");
  try { execSync(`"${batPath}"`, { stdio: "ignore", timeout: 5000 }); } catch {}
  setTimeout(() => { try { rmSync(batPath, { force: true }); } catch {} }, 10000);
  console.log("  请在打开的 Chrome 窗口中登录 xiaohongshu.com");
}

console.log("\n=== 测试完成 ===");
console.log("如需提取 Cookie: 在 Chrome 中登录后运行: node scratch/extract_cookies.mjs");
