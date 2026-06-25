import { DatabaseSync } from "node:sqlite";
import { decryptCookie } from "../src/xhsAuth.mjs";

const db = new DatabaseSync("data/app.db");
const rootDir = process.cwd();

try {
  const xhsAccounts = db.prepare("SELECT * FROM xhs_accounts").all();
  console.log("=== xhs_accounts 表中所有账号 ===");
  for (const acc of xhsAccounts) {
    let decrypted = "";
    if (acc.cookie_encrypted) {
      try {
        decrypted = decryptCookie(acc.cookie_encrypted, rootDir);
      } catch (err) {
        decrypted = `[解密失败: ${err.message}]`;
      }
    }
    console.log({
      id: acc.id,
      nickname: acc.nickname,
      status: acc.status,
      last_active_at: acc.last_active_at,
      cookie_preview: decrypted ? decrypted.substring(0, 50) + "..." : "空"
    });
  }
} catch (e) {
  console.error("查询失败:", e.message);
} finally {
  db.close();
}
