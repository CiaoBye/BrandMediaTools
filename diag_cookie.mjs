import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { checkCookieValid } from "./src/xhsAuth.mjs";

const rootDir = process.cwd();
const cookieFile = path.join(rootDir, "data", "xhs-cookie.txt");

if (!existsSync(cookieFile)) {
  console.log("data/xhs-cookie.txt 不存在");
  process.exit(0);
}

const cookie = readFileSync(cookieFile, "utf8").trim();
console.log(`读取到 Cookie, 长度: ${cookie.length}`);
console.log(`包含 a1: ${cookie.includes("a1=")}`);
console.log(`包含 web_session: ${cookie.includes("web_session")}`);
console.log(`包含 web_session=: ${cookie.includes("web_session=")}`);

console.log("\n开始执行 checkCookieValid...");
const check = await checkCookieValid(rootDir, cookie);
console.log("检测结果:", JSON.stringify(check, null, 2));

// 模拟发送请求，捕获更多详细信息
try {
  console.log("\n模拟发送探针请求...");
  const resp = await fetch("https://www.xiaohongshu.com/explore", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Ch-Ua": '"Not(A:Brand";v="99", "Google Chrome";v="134", "Chromium";v="134"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      Referer: "https://www.xiaohongshu.com/",
      Cookie: cookie
    },
    redirect: "manual"
  });
  
  console.log("响应状态码:", resp.status);
  console.log("响应 Headers:", JSON.stringify(Object.fromEntries(resp.headers.entries()), null, 2));
  
  const html = await resp.text();
  console.log("HTML 长度:", html.length);
  console.log("是否包含登录标志:");
  console.log("  - 手机号登录:", html.includes("手机号登录"));
  console.log("  - 登录小红书:", html.includes("登录小红书"));
  console.log("  - 你访问的页面不见了:", html.includes("你访问的页面不见了"));
  console.log("  - guest:", html.includes("guest"));
  console.log("  - __INITIAL_STATE__:", html.includes("__INITIAL_STATE__"));
  
  // 提取并解析 __INITIAL_STATE__ 打印
  const idx = html.indexOf("__INITIAL_STATE__");
  console.log("idx of __INITIAL_STATE__:", idx);
  if (idx >= 0) {
    const scriptStart = html.slice(0, idx).lastIndexOf("<script");
    console.log("scriptStart:", scriptStart);
    const fromScript = html.slice(scriptStart);
    const scriptEnd = fromScript.indexOf("</script>");
    console.log("scriptEnd:", scriptEnd);
    const eqPos = fromScript.indexOf("=");
    const braceStart = fromScript.indexOf("{", eqPos);
    const braceEnd = fromScript.lastIndexOf("}");
    console.log("braceStart:", braceStart, "braceEnd:", braceEnd);
    
    // 我们尝试仅在 </script> 之前寻找 braceEnd 看看
    const inScriptOnly = fromScript.slice(0, scriptEnd);
    const braceEndInScript = inScriptOnly.lastIndexOf("}");
    console.log("braceEndInScript (inside script):", braceEndInScript);

    let jsonStr = fromScript.slice(braceStart, braceEnd + 1);
    jsonStr = jsonStr.replace(/\bundefined\b/g, "null").replace(/\bNaN\b/g, "null");
    try {
      JSON.parse(jsonStr);
      console.log("原 parseInitState 成功解析");
    } catch (err) {
      console.log("原 parseInitState 解析失败:", err.message);
    }

    let jsonStrFixed = fromScript.slice(braceStart, braceEndInScript + 1);
    jsonStrFixed = jsonStrFixed.replace(/\bundefined\b/g, "null").replace(/\bNaN\b/g, "null");
    try {
      const fixedState = JSON.parse(jsonStrFixed);
      console.log("修复版 parseInitState 成功解析! keys:", Object.keys(fixedState));
      console.log("fixedState.user:", JSON.stringify(fixedState?.user || null, null, 2));
    } catch (err) {
      console.log("修复版 parseInitState 解析失败:", err.message);
      // 打印前 200 个和后 200 个字符
      console.log("jsonStrFixed slice:", jsonStrFixed.slice(0, 200), "...", jsonStrFixed.slice(-200));
    }
  }
  
  // 打印前 500 个字符
  console.log("HTML 前 500 字符:", html.slice(0, 500));
} catch (e) {
  console.error("请求失败:", e);
}
