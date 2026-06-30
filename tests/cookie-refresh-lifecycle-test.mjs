import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (rel) => readFileSync(path.join(rootDir, rel), "utf8");

const authCrawler = file("src/crawler/auth.mjs");
const server = file("src/server.mjs");
const scheduler = file("src/scheduler.mjs");
const publicApp = file("public/app.js");
const publicIndex = file("public/index.html");

assert.match(
  authCrawler,
  /const\s+deadline\s*=\s*Date\.now\(\)\s*\+\s*waitMs;\s*while\s*\(Date\.now\(\)\s*<\s*deadline\)/,
  "saveXhsCookieFromBrowser 应在打开页面后计算 deadline，并在循环中使用"
);

assert.match(
  authCrawler,
  /const\s+userId\s*=\s*\/\^guest\/i\.test\(String\(rawUserId\s*\|\|\s*""\)\)\s*\?\s*""\s*:\s*rawUserId/,
  "浏览器页面登录态判断不应把 guest_user_id 当作真实用户"
);

assert.match(
  authCrawler,
  /const\s+savedCookie\s*=\s*valid\.cookieUpdated\s*\|\|\s*cookieStr/,
  "浏览器保存 Cookie 时应持久化 checkCookieValid 返回的更新 Cookie"
);

assert.match(
  authCrawler,
  /launchPersistentContext\(profileDir,\s*launchOptions\)/,
  "专用浏览器绑定应使用项目专属持久 profile，而不是临时浏览器上下文"
);

assert.match(
  authCrawler,
  /\.browser-profile",\s*"chrome-cdp"/,
  "交互绑定和后台刷新应复用同一个项目专属浏览器 profile"
);

assert.match(
  server,
  /encryptCookie\(check\.cookieUpdated\s*\|\|\s*washed,\s*rootDir\)/,
  "手动账号 Cookie 入库应使用更新后的 Cookie"
);

assert.match(
  server,
  /writeFileSync\(path\.join\(rootDir,\s*"data",\s*"xhs-cookie\.txt"\),\s*check\.cookieUpdated\s*\|\|\s*cookie,\s*"utf8"\)/,
  "手动全局 Cookie 保存应使用更新后的 Cookie"
);

assert.match(
  scheduler,
  /check\.valid\s*&&\s*check\.cookieUpdated\s*&&\s*check\.cookieUpdated\s*!==\s*cookie[\s\S]*cookieEncrypted:\s*encryptCookie\(check\.cookieUpdated,\s*rootDir\)/,
  "调度健康检查应把更新后的 Cookie 写回加密账号库"
);

assert.doesNotMatch(
  scheduler,
  /!check\.valid\s*&&\s*settings\.xhs\.autoRefreshCookie\s*!==\s*false\s*&&\s*Number\(settings\.xhs\.cdpPort/,
  "后台健康刷新不应再强依赖用户配置 cdpPort"
);

assert.match(
  scheduler,
  /refreshAuthForTask[\s\S]*saveXhsCookieFromBrowser[\s\S]*interactive:\s*false/,
  "定时任务 Cookie 报错时应先尝试非交互刷新授权态"
);

assert.equal(existsSync(path.join(rootDir, "src/xhsLogin.mjs")), false, "旧二维码登录模块应删除");
assert.doesNotMatch(server, /xhsLogin\.mjs|\/api\/auth\/qr|startQrLogin|checkQrLoginStatus|collectQrCookies|cancelQrLogin/, "服务端不应保留二维码登录路由");
assert.doesNotMatch(publicApp + publicIndex, /qrOverlay|auth\/qr|startQrLogin|QRCode|二维码登录/, "前端不应保留二维码登录入口和轮询逻辑");

console.log("cookie-refresh-lifecycle-test passed");
