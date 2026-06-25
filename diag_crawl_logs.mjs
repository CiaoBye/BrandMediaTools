import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const db = new DatabaseSync("data/app.db");

// 1. 查询最新的任务日志
const taskLogs = db.prepare("SELECT * FROM task_logs ORDER BY started_at DESC LIMIT 10").all();
console.log("=== 最近 10 条 Task Logs ===");
console.log(JSON.stringify(taskLogs, null, 2));

// 2. 查看 followed_accounts
const followed = db.prepare("SELECT * FROM followed_accounts WHERE user_id = '6464c13e0000000029010651'").get();
console.log("\n=== 艾屿月子 Follow 状态 ===");
console.log(JSON.stringify(followed, null, 2));

// 3. 统计 notes 表中该品牌/该作者的笔记数
const notesCount = db.prepare("SELECT COUNT(*) as cnt FROM notes WHERE author_id = '6464c13e0000000029010651'").get();
console.log(`\n=== 数据库 notes 表中艾屿月子的真实记录数: ${notesCount.cnt} ===`);

// 4. 查看最近的 error 日志
const logDir = "data/logs";
if (existsSync(logDir)) {
  console.log("\n=== data/logs 目录 ===");
  const files = db.prepare("SELECT name FROM sqlite_master").all(); // 只是打印，这里随便做点
}

db.close();
