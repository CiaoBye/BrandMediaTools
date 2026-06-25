import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const cookieFile = path.join(rootDir, "data", "xhs-cookie.txt");

if (!existsSync(cookieFile)) {
  console.log("data/xhs-cookie.txt 不存在");
  process.exit(0);
}

const cookie = readFileSync(cookieFile, "utf8").trim();
// 剥离 a1
const parts = cookie.split(";").map(s => s.trim()).filter(Boolean);
const withoutA1 = parts.filter(s => !s.startsWith("a1=")).join("; ");
const onlyWebSession = parts.find(s => s.startsWith("web_session="));

console.log("原始 Cookie:", cookie.slice(0, 100) + "...");
console.log("剥离 a1 后的 Cookie:", withoutA1.slice(0, 100) + "...");
console.log("只有 web_session 的 Cookie:", onlyWebSession);

async function test(cookieStr) {
  try {
    const resp = await fetch("https://www.xiaohongshu.com/explore", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.xiaohongshu.com/",
        Cookie: cookieStr
      },
      redirect: "manual"
    });
    console.log(`\n测试 Cookie (${cookieStr.slice(0, 30)}...):`);
    console.log("  状态码:", resp.status);
    console.log("  Location:", resp.headers.get("location"));
    const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
    console.log("  Set-Cookie 数量:", setCookies.length);
    for (const sc of setCookies) {
      if (sc.includes("a1=")) {
        console.log("  发现 Set-Cookie a1:", sc);
      }
    }
  } catch (e) {
    console.error("  请求失败:", e);
  }
}

await test(withoutA1);
if (onlyWebSession) {
  await test(onlyWebSession);
}
