import { Storage } from "../src/storage.mjs";
import assert from "node:assert";

async function runTest() {
  console.log("开始物理游标过滤测试...");
  const rootDir = process.cwd();
  const storage = new Storage(rootDir);
  
  // 1. 先确保我们的测试数据是干净的
  const testUserId = "test_user_filter_999";
  
  // 清理
  try {
    const followed = storage.getFollowedAccountByUserId(testUserId);
    if (followed) {
      storage.deleteFollowedAccount(followed.id);
    }
  } catch {}
  
  // 2. 插入测试被跟随账号
  // 我们模拟 last_cursor 中包含一个物理上在 notes 表存在的 ID 和一个不存在的 ID
  const testNoteIdExist = "test_note_exist_888";
  const testNoteIdNonExist = "test_note_non_exist_999";
  const lastCursor = JSON.stringify([testNoteIdExist, testNoteIdNonExist]);
  
  storage.upsertFollowedAccount({
    userId: testUserId,
    authorName: "测试账号过滤",
    avatarUrl: "",
    authorUrl: `https://www.xiaohongshu.com/user/profile/${testUserId}`,
    brand: "测试品牌",
    lastCursor,
    lastCheckAt: new Date().toISOString(),
    totalFound: 2
  });
  
  // 3. 在 notes 表中插入物理存在的笔记
  // 注意，findNoteBySourceUrl 使用的是 sourceUrl = `https://www.xiaohongshu.com/explore/${nid}`
  const sourceUrl = `https://www.xiaohongshu.com/explore/${testNoteIdExist}`;
  try {
    const existingNote = storage.findNoteBySourceUrl(sourceUrl);
    if (!existingNote) {
      storage.upsertNote({
        sourceUrl,
        platform: "小红书",
        title: "测试存在的笔记",
        authorId: testUserId,
        authorName: "测试账号",
        collectedAt: new Date().toISOString(),
        status: "已完成",
        assets: []
      });
    }
  } catch (e) {
    console.error("插入测试笔记失败:", e);
  }
  
  // 4. 模拟 server.mjs / scheduler.mjs 中的过滤逻辑
  const followed = storage.getFollowedAccountByUserId(testUserId);
  assert.ok(followed, "应该成功获取被跟随账号");
  
  let knownNoteIds = [];
  try {
    const parsedIds = JSON.parse(followed.last_cursor || "[]");
    if (Array.isArray(parsedIds)) {
      knownNoteIds = parsedIds.filter(nid => {
        return !!storage.findNoteBySourceUrl(`https://www.xiaohongshu.com/explore/${nid}`);
      });
    }
  } catch (e) {
    console.error("解析游标失败:", e);
  }
  
  console.log("过滤后的 knownNoteIds:", knownNoteIds);
  
  // 5. 校验结果
  assert.strictEqual(knownNoteIds.length, 1, "应该只有一个元素保留");
  assert.strictEqual(knownNoteIds[0], testNoteIdExist, "保留的元素应该是物理存在的笔记");
  
  // 6. 清理
  try {
    const note = storage.findNoteBySourceUrl(sourceUrl);
    if (note) {
      storage.deleteNote(note.id);
    }
    const acc = storage.getFollowedAccountByUserId(testUserId);
    if (acc) {
      storage.deleteFollowedAccount(acc.id);
    }
  } catch (e) {
    console.warn("清理测试数据失败:", e.message);
  }
  
  storage.db.close();
  console.log("物理游标过滤测试成功！");
}

runTest().catch(e => {
  console.error("测试失败:", e);
  process.exit(1);
});
