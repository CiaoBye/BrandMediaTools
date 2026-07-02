import assert from "node:assert/strict";
import { runSchedulerCycle } from "../src/scheduler.mjs";
import { isValidCron, nextCronRun } from "../src/cron.mjs";

assert.equal(isValidCron("0 9 * * *"), true);
assert.equal(isValidCron("*/30 * * * *"), true);
assert.equal(isValidCron("0 9 * *"), false);
assert.equal(nextCronRun("0 9 * * *", "2026-07-01T08:59:00+08:00"), "2026-07-01T09:00:00+08:00");
assert.equal(nextCronRun("*/30 * * * *", "2026-07-01T09:01:00+08:00"), "2026-07-01T09:30:00+08:00");

const updates = [];
const logs = [];
const task = {
  id: "task-1",
  name: "失败重试测试",
  task_type: "crawl",
  config: { url: "https://example.com/note" },
  interval_minutes: 60,
  account_id: null
};

const storage = {
  getDueTasks: () => [task],
  createTaskLog: () => "log-1",
  updateScheduledTask: (id, patch) => { updates.push({ id, patch }); },
  finishTaskLog: (id, status, message) => { logs.push({ id, status, message }); },
  listXhsAccounts: () => []
};

const before = Date.now();
const result = await runSchedulerCycle(process.cwd(), storage, {
  skipHealthCheck: true,
  crawlXhs: async () => { throw new Error("模拟采集失败"); }
});

assert.equal(result.processedTasks, 1);
const failureUpdate = updates.find((item) => item.patch.status === "失败");
assert.ok(failureUpdate, "失败后应更新任务状态");
assert.ok(failureUpdate.patch.nextRunAt, "失败后应推进 nextRunAt");
assert.ok(new Date(failureUpdate.patch.nextRunAt).getTime() >= before + 59 * 60 * 1000);
assert.equal(logs.at(-1).status, "失败");
assert.match(logs.at(-1).message, /模拟采集失败/);

const commentUpdates = [];
const commentLogs = [];
const savedComments = [];
const commentTask = {
  id: "task-comments",
  name: "评论刷新测试",
  task_type: "comments_refresh",
  config: { brand: "Bella", limit: 10, cacheMinutes: 360 },
  interval_minutes: 120,
  account_id: null
};
let collectCalls = 0;
const oldTime = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
const freshTime = new Date().toISOString();
const commentStorage = {
  getDueTasks: () => [commentTask],
  createTaskLog: () => "log-comments",
  updateScheduledTask: (id, patch) => { commentUpdates.push({ id, patch }); },
  finishTaskLog: (id, status, message, resultCount) => { commentLogs.push({ id, status, message, resultCount }); },
  listXhsAccounts: () => [],
  listNotes: () => [
    { id: "old-note", sourceUrl: "https://www.xiaohongshu.com/explore/old", brand: "Bella" },
    { id: "fresh-note", sourceUrl: "https://www.xiaohongshu.com/explore/fresh", brand: "Bella" }
  ],
  getCommentCacheInfo: (noteId) => ({ fetchedAt: noteId === "fresh-note" ? freshTime : oldTime, count: 1 }),
  saveComments: (noteId, comments) => { savedComments.push({ noteId, comments }); }
};

await runSchedulerCycle(process.cwd(), commentStorage, {
  skipHealthCheck: true,
  collectComments: async () => {
    collectCalls++;
    return { comments: [{ author: "用户", content: "新评论" }] };
  }
});

assert.equal(collectCalls, 1, "只应刷新过期评论缓存");
assert.equal(savedComments[0].noteId, "old-note");
assert.equal(commentLogs.at(-1).status, "成功");
assert.equal(commentLogs.at(-1).resultCount, 1);

const cronUpdates = [];
await runSchedulerCycle(process.cwd(), {
  getDueTasks: () => [{ ...task, id: "task-cron", task_type: "search", config: { keyword: "Bella" }, cron_expression: "0 9 * * *" }],
  createTaskLog: () => "log-cron",
  updateScheduledTask: (id, patch) => { cronUpdates.push({ id, patch }); },
  finishTaskLog: () => {},
  listXhsAccounts: () => []
}, {
  skipHealthCheck: true,
  searchXhs: async () => ({ count: 1 })
});

assert.ok(cronUpdates.find((item) => item.patch.status === "等待中"));
assert.match(cronUpdates.at(-1).patch.nextRunAt, /T09:00:00\+08:00$/);

console.log("scheduler-regression-test passed");
console.log("scheduler-comments-refresh-test passed");
