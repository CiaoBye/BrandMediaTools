import { followAccount } from "./src/crawler/account.mjs";
import { resolveCookie } from "./src/xhsAuth.mjs";
import { Storage } from "./src/storage.mjs";

const rootDir = process.cwd();
const storage = new Storage(rootDir);
const cookie = resolveCookie(rootDir, storage);

console.log("使用 Cookie 进行跟随抓取测试...");
console.log("Cookie 长度:", cookie.length);

const userId = "6464c13e0000000029010651"; // 艾屿月子的 userId
const brand = "艾屿月子";

try {
  const result = await followAccount(
    { userId, brand, knownNoteIds: [] },
    { rootDir, cookie, headless: true }
  );
  console.log("\n跟随抓取成功！");
  console.log("作者昵称:", result.authorName);
  console.log("头像链接:", result.avatarUrl);
  console.log("返回笔记数:", result.notes?.length || 0);
  console.log("全量总发现数:", result.totalFound);
  if (result.notes && result.notes.length > 0) {
    console.log("第一篇笔记标题:", result.notes[0].title);
  }
} catch (e) {
  console.error("\n跟随抓取发生错误:", e);
}
