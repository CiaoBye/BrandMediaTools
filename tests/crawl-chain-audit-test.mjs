import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (rel) => readFileSync(path.join(rootDir, rel), "utf8");

const account = file("src/crawler/account.mjs");
const sdk = file("src/xhsSdk.mjs");
const scheduler = file("src/scheduler.mjs");
const noteStore = file("src/storage/note-store.mjs");
const downloader = file("src/downloader.mjs");
const server = file("src/server.mjs");
const serverUtils = file("src/server-utils.mjs");
const mcp = file("src/mcpServer.mjs");
const search = file("src/crawler/search.mjs");
const pkg = JSON.parse(file("package.json"));

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function countMatches(text, regex) {
  return Array.from(text.matchAll(regex)).length;
}

test("01 followAccount 继续使用 successNoteIds，且不残留 successUrls", () => {
  assert.equal(account.includes("successUrls"), false, "不应重新引入 successUrls");
  assert.match(account, /const\s+successNoteIds\s*=\s*new\s+Set\(/, "应声明 successNoteIds");
  assert.match(account, /const\s+noteId\s*=\s*extractXhsId\(url\)/, "成功去重主键应来自 extractXhsId(url)");
  assert.match(account, /successNoteIds\.add\(noteId\)/, "HTTP 成功后应记录 canonical noteId");
});

test("02 account.mjs 只有一个 extractAccountLinks，并保持导出", () => {
  assert.equal(countMatches(account, /export\s+async\s+function\s+extractAccountLinks\b/g), 1);
  assert.match(account, /export\s+async\s+function\s+extractAccountLinks\b/);
  assert.match(account, /export\s+async\s+function\s+followAccount\b/);
});

test("03 extractAccountLinks 保留 DOM 深度扫描入口", () => {
  for (const pattern of ["[data-note-id]", "__vue__", "img[data-src]", "img[data-lazy-src]", "section a[href]", "[class*=card] a[href]"]) {
    assert.ok(account.includes(pattern), `缺少 DOM 深扫选择器：${pattern}`);
  }
});

test("04 extractAccountLinks 保留渐进滚动、空滚动阈值和回顶策略", () => {
  assert.match(account, /emptyScrollCount\s*>=\s*emptyThreshold/, "应达到空滚动阈值后退出");
  assert.match(account, /progressiveDelay/, "应保留渐进延时开关");
  assert.match(account, /Math\.random\(\)\s*\*\s*800/, "应保留随机抖动");
  assert.match(account, /byNoteId\.size\s*>=\s*50/, "应保留每 50 条左右回到顶部策略");
});

test("05 extractAccountNotes 保留 accountParallelTabs 并发采集", () => {
  assert.match(account, /accountParallelTabs\s*\?\?\s*3/, "应读取 accountParallelTabs 默认 3");
  assert.match(account, /Promise\.allSettled\(chunk\.map\(url\s*=>\s*processUrl\(url\)\)\)/, "应按 chunk 并行采集");
});

test("06 followAccount 不应硬置访客态为 false", () => {
  assert.equal(account.includes("cs.isGuest = false"), false, "访客态不能被硬置为 false");
  assert.match(account, /page\.url\(\)\.includes\("\/login"\)\s*\|\|\s*cs\.isGuest/, "应同时检查登录页和 guest 状态");
});

test("07 cookieOverride 场景 cdpPort:0 应真正禁用配置中的 CDP", () => {
  assert.doesNotMatch(sdk, /const\s+useCdp\s*=\s*options\.cdpPort\s*>\s*0\s*\|\|\s*settings\.xhs\.cdpPort\s*>\s*0/, "cdpPort:0 不应继续回落到 settings.xhs.cdpPort");
  assert.match(server, /crawlCdpPort\s*=\s*cookieRaw\s*\?\s*0\s*:/, "账号抓取应显式按 Cookie 禁用 CDP");
});

test("08 存储和跳过逻辑应支持 canonical noteId 去重", () => {
  assert.doesNotMatch(noteStore, /SELECT \* FROM notes WHERE source_url = \?/, "upsert/find 不能只依赖 source_url 精确匹配");
  assert.match(noteStore, /note_id\s*=\s*\?/, "应存在 note_id 查询或 upsert 路径");
  assert.match(serverUtils, /parsedNoteId\s*\?\s*storage\.findNoteByNoteId\(parsedNoteId\)/, "skip 应优先按 canonical noteId 匹配");
});

test("09 定时 follow 应对齐手动抓取的 knownNoteIds 与账号元数据保留", () => {
  assert.match(scheduler, /listNotes\(\{\s*authorId:\s*followed\.user_id\s*\}\)/, "定时 follow 应合并 DB 已有 noteId");
  assert.match(scheduler, /result\.authorName\s*\|\|\s*followed\?\.author_name/, "authorName 为空时应保留旧值");
  assert.match(scheduler, /result\.avatarUrl\s*\|\|\s*followed\?\.avatar_url/, "avatarUrl 为空时应保留旧值");
});

test("10 弃用 API、Range 回退和版本部署信息应保持干净", () => {
  assert.equal(existsSync(path.join(rootDir, "src/xhsApiClient.mjs")), false, "旧 xhsApiClient 不应继续保留");
  assert.equal(existsSync(path.join(rootDir, "src/signserver/server.py")), false, "旧签名服务不应继续保留");
  assert.equal(existsSync(path.join(rootDir, "src/signserver/__pycache__")), false, "__pycache__ 不应留在源码目录");
  assert.doesNotMatch(search, /xhsApiClient\.mjs|searchViaApi|readApiCookie/, "搜索链路不应继续 API-first");
  assert.doesNotMatch(server, /xhsApiClient\.mjs/, "server 不应引用旧 xhsApiClient");
  assert.doesNotMatch(downloader, /if\s*\(useRange\s*&&\s*response\.status\s*!==\s*206\)\s*\{[\s\S]{0,80}continue;/, "Range 不支持时不应只删除 part 后消耗一次重试");
  assert.notEqual(pkg.version, "1.13.5", "package.json 版本不应停留在 v1.13.5");
  assert.doesNotMatch(mcp, /version:\s*"1\.10\.0"/, "MCP serverInfo 不应停留在 v1.10.0");
});

let passed = 0;
const failed = [];
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log("PASS", item.name);
  } catch (error) {
    failed.push({ name: item.name, message: error.message });
    console.log("FAIL", item.name);
    console.log("  " + error.message);
  }
}

console.log(`\n采集链路审计测试：${passed}/${tests.length} 通过`);
if (failed.length) {
  console.log("\n失败项：");
  for (const item of failed) console.log(`- ${item.name}: ${item.message}`);
  process.exitCode = 1;
}
