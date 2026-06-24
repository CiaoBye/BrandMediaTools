import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export { fromJson, toJson, now };

const now = () => new Date().toISOString();

function toJson(value, fallback = null) {
  if (value === undefined) return fallback === null ? null : JSON.stringify(fallback);
  return JSON.stringify(value);
}

function fromJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function createDb(rootDir) {
  const dataDir = path.join(rootDir, "data");
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "app.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT '小红书', brand TEXT NOT NULL, account_name TEXT, account_url TEXT, tone TEXT, industry TEXT, priority TEXT DEFAULT '中', notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT '小红书', source_url TEXT NOT NULL UNIQUE, note_id TEXT, account_id TEXT, brand TEXT, author_name TEXT, author_id TEXT, title TEXT, description TEXT, published_at TEXT, collected_at TEXT NOT NULL, content_type TEXT, marketing_goal TEXT, selling_points TEXT, visual_style TEXT, tags TEXT, metrics TEXT, raw TEXT, status TEXT NOT NULL DEFAULT '已入库', review_reason TEXT, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, kind TEXT NOT NULL, source_url TEXT, local_path TEXT, file_name TEXT, file_size INTEGER, width INTEGER, height INTEGER, resolution TEXT, mime_type TEXT, status TEXT NOT NULL, watermark_status TEXT, error TEXT, image_index INTEGER, paired_image_index INTEGER, live_photo INTEGER NOT NULL DEFAULT 0, file_id TEXT, trace_id TEXT, raw TEXT, created_at TEXT NOT NULL, FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS analysis (id TEXT PRIMARY KEY, note_id TEXT NOT NULL UNIQUE, model TEXT, topic_logic TEXT, opening_hook TEXT, video_structure TEXT, selling_point_expression TEXT, visual_style TEXT, conversion_script TEXT, takeaways TEXT, how_we_can_use TEXT, script_directions TEXT, raw TEXT, created_at TEXT NOT NULL, FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, parent_id TEXT, author_name TEXT, author_id TEXT, content TEXT, likes INTEGER DEFAULT 0, time TEXT, raw TEXT, created_at TEXT NOT NULL, FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS crawl_jobs (id TEXT PRIMARY KEY, input_url TEXT NOT NULL, status TEXT NOT NULL, message TEXT, result_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS monitor_sources (id TEXT PRIMARY KEY, provider TEXT NOT NULL, name TEXT NOT NULL, config TEXT, enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS xhs_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, cookie_encrypted TEXT, status TEXT NOT NULL DEFAULT '未知', last_check_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scheduled_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, task_type TEXT NOT NULL, config TEXT, cron_expression TEXT, interval_minutes INTEGER DEFAULT 0, account_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, next_run_at TEXT, status TEXT DEFAULT '等待中', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_logs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL, message TEXT, result_count INTEGER DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, message TEXT, level TEXT NOT NULL DEFAULT 'warning', read INTEGER NOT NULL DEFAULT 0, related_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS followed_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, author_name TEXT, author_url TEXT, brand TEXT, last_cursor TEXT, last_check_at TEXT, total_found INTEGER DEFAULT 0, avatar_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS follow_checks (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, check_at TEXT NOT NULL, new_notes INTEGER DEFAULT 0, total_notes INTEGER DEFAULT 0, status TEXT DEFAULT '成功', FOREIGN KEY(account_id) REFERENCES followed_accounts(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  ensureColumn(db, "assets", "image_index", "INTEGER");
  ensureColumn(db, "assets", "paired_image_index", "INTEGER");
  ensureColumn(db, "assets", "live_photo", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "assets", "file_id", "TEXT");
  ensureColumn(db, "assets", "trace_id", "TEXT");
  ensureColumn(db, "assets", "raw", "TEXT");
  ensureColumn(db, "notes", "updated_at", "TEXT");
  ensureColumn(db, "notes", "library_type", "TEXT");
  ensureColumn(db, "notes", "script_direction", "TEXT");
  ensureColumn(db, "followed_accounts", "avatar_url", "TEXT");
  migrateLegacyBeijingTimestamps(db);
}

function migrateLegacyBeijingTimestamps(db) {
  const key = "v1.10-timezone-migrated";
  if (db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)) return;
  db.exec("BEGIN");
  try {
    db.exec(`
      UPDATE scheduled_tasks
      SET last_run_at = CASE WHEN last_run_at IS NULL OR last_run_at = '' THEN last_run_at ELSE strftime('%Y-%m-%dT%H:%M:%fZ', last_run_at, '-8 hours') END,
          next_run_at = CASE WHEN next_run_at IS NULL OR next_run_at = '' THEN next_run_at ELSE strftime('%Y-%m-%dT%H:%M:%fZ', next_run_at, '-8 hours') END;
      UPDATE followed_accounts
      SET last_check_at = CASE WHEN last_check_at IS NULL OR last_check_at = '' THEN last_check_at ELSE strftime('%Y-%m-%dT%H:%M:%fZ', last_check_at, '-8 hours') END;
    `);
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(key, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}
