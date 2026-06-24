import assert from "node:assert/strict";
import { runSchedulerCycle } from "../src/scheduler.mjs";

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

console.log("scheduler-regression-test passed");
