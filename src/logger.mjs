import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { beijingNow } from "./time.mjs";

const MAX_LOG_SIZE = 5 * 1024 * 1024;
const MAX_LOG_LINES = 5000;
const PAGE_SIZE = 200;

export class Logger {
  constructor(rootDir) {
    this.logDir = path.join(rootDir, "data", "logs");
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
    this.currentFile = path.join(this.logDir, "app.log");
    this._ensureFile();
  }

  _ensureFile() {
    if (!existsSync(this.currentFile)) {
      writeFileSync(this.currentFile, "", "utf8");
    } else if (statSync(this.currentFile).size > MAX_LOG_SIZE) {
      this._rotate();
    }
  }

  _rotate() {
    const lines = readFileSync(this.currentFile, "utf8").split("\n").filter(Boolean);
    const kept = lines.slice(-MAX_LOG_LINES);
    const ts = beijingNow().replace(/[:.]/g, "-").slice(0, 19);
    const archive = path.join(this.logDir, `app-${ts}.log`);
    writeFileSync(archive, kept.join("\n") + "\n", "utf8");
    writeFileSync(this.currentFile, "", "utf8");
  }

  _write(level, message, data) {
    try {
      this._ensureFile();
      const time = beijingNow();
      const extra = data ? " " + JSON.stringify(data, null, 0) : "";
      const line = `[${time}] [${level}] ${message}${extra}\n`;
      appendFileSync(this.currentFile, line, "utf8");
    } catch { /* silently fail */ }
  }

  info(message, data) { this._write("INFO", message, data); }
  warn(message, data) { this._write("WARN", message, data); }
  error(message, data) { this._write("ERROR", message, data); }

  getLogs(offset = 0, limit = PAGE_SIZE) {
    try {
      if (!existsSync(this.currentFile)) return { lines: [], total: 0, offset, limit };
      const text = readFileSync(this.currentFile, "utf8");
      const all = text.split("\n").filter(Boolean);
      const total = all.length;
      const start = Math.max(0, total - offset - limit);
      const end = Math.max(0, total - offset);
      const lines = all.slice(start, end).reverse();
      return { lines, total, offset, limit };
    } catch { return { lines: [], total: 0, offset, limit }; }
  }

  search(keyword) {
    try {
      if (!existsSync(this.currentFile)) return [];
      const text = readFileSync(this.currentFile, "utf8");
      return text.split("\n").filter((l) => l && l.toLowerCase().includes(keyword.toLowerCase())).slice(-200).reverse();
    } catch { return []; }
  }

  clear() {
    try {
      writeFileSync(this.currentFile, "", "utf8");
      this.info("日志已清空");
    } catch { /* silently fail */ }
  }
}

let _instance = null;
export function getLogger(rootDir) {
  if (!_instance) _instance = new Logger(rootDir);
  return _instance;
}
