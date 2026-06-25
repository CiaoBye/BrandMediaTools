import { runSchedulerCycle } from "../src/scheduler.mjs";
import { Storage } from "../src/storage.mjs";
import assert from "node:assert";

async function runTest() {
  console.log("开始测试：Cookie 报错自动挂起定时任务...");
  const rootDir = process.cwd();
  const storage = new Storage(rootDir);

  // 1. 插入一个模拟定时任务
  const testTaskId = "test_suspend_task_id_888";
  
  // 确保测试数据干净
  try {
    storage.deleteScheduledTask(testTaskId);
  } catch {}

  const task = storage.createScheduledTask({
    name: "测试自动挂起任务",
    taskType: "follow",
    config: { userId: "test_userId_999", authorUrl: "https://www.xiaohongshu.com/user/profile/test_userId_999" },
    intervalMinutes: 60,
    accountId: null
  });
  
  // 覆盖ID以便容易追踪
  storage.db.prepare("UPDATE scheduled_tasks SET id = ? WHERE id = ?").run(testTaskId, task.id);
  
  // 2. 模拟一个必定会抛出 Cookie 无效异常的 followAccount 方法
  const mockFollowAccount = async () => {
    throw new Error("检测到登录页面重定向，Cookie 无效或已过期（Cookie 为访客会话，非登录态）");
  };

  const mockPersistNoteAssets = async () => [];

  // 3. 执行调度循环
  // 强制把这个定时任务状态设为等待中，以触发执行
  storage.updateScheduledTask(testTaskId, { status: "等待中", nextRunAt: new Date(Date.now() - 10000).toISOString() });
  
  await runSchedulerCycle(rootDir, storage, {
    followAccount: mockFollowAccount,
    persistNoteAssets: mockPersistNoteAssets,
    skipHealthCheck: true // 跳过健康检查以防网络超时
  });

  // 4. 断言验证
  const updatedTask = storage.getScheduledTask(testTaskId);
  console.log("更新后的定时任务状态:", updatedTask.status);
  
  assert.strictEqual(updatedTask.status, "暂停", "包含 Cookie 错误的异常应当使任务状态自动转为「暂停」");

  // 验证通知是否创建成功
  const notifications = storage.listNotifications();
  const foundNotif = notifications.find(n => n.title.includes("测试自动挂起任务") && n.type === "account_expired");
  assert.ok(foundNotif, "数据库中应当插入一则 type='account_expired' 的掉线挂起通知");
  console.log("生成的掉线系统通知标题:", foundNotif.title);

  // 5. 还原与清理
  try {
    storage.deleteScheduledTask(testTaskId);
    storage.deleteNotification(foundNotif.id);
  } catch (err) {
    console.warn("清理测试数据失败:", err.message);
  }

  storage.db.close();
  console.log("Cookie 报错自动挂起定时任务测试成功！");
}

runTest().catch(e => {
  console.error("测试运行失败:", e);
  process.exit(1);
});
