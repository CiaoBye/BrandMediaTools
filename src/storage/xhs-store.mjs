import { randomUUID } from "node:crypto";
import { now, fromJson } from "./db.mjs";
import { nextCronRun } from "../cron.mjs";

export function createXhsStore(db) {
  const _ = (sql) => db.prepare(sql);
  return {
    listXhsAccounts() {
      return _("SELECT id, name, status, last_check_at, last_used_at, created_at, updated_at FROM xhs_accounts ORDER BY updated_at DESC").all();
    },
    getXhsAccount(id) {
      return _("SELECT * FROM xhs_accounts WHERE id = ?").get(id);
    },
    upsertXhsAccount(input) {
      const existing = _("SELECT * FROM xhs_accounts WHERE name = ?").get(input.name || input.accountName);
      const id = existing?.id || randomUUID();
      const time = now();
      const name = input.name || input.accountName || "未命名";
      if (existing) {
        const updates = [];
        const params = [];
        for (const [key, value] of Object.entries({
          name,
          cookie_encrypted: input.cookieEncrypted,
          status: input.status || existing.status,
          last_check_at: input.lastCheckAt || existing.last_check_at,
          last_used_at: input.lastUsedAt || existing.last_used_at
        })) {
          if (value !== undefined) {
            updates.push(`${key} = ?`);
            params.push(value);
          }
        }
        if (updates.length) {
          _(`UPDATE xhs_accounts SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`).run(...params, time, id);
        }
      } else {
        _("INSERT INTO xhs_accounts (id, name, cookie_encrypted, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(id, name, input.cookieEncrypted || "", input.status || "未知", time, time);
      }
      return this.getXhsAccount(id);
    },
    deleteXhsAccount(id) {
      const e = _("SELECT * FROM xhs_accounts WHERE id = ?").get(id);
      if (!e) return false;
      _("DELETE FROM xhs_accounts WHERE id = ?").run(id);
      return true;
    },

    // Notifications
    createNotification(notif) {
      const id = randomUUID();
      _("INSERT INTO notifications (id, type, title, message, level, read, related_id, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
        .run(id, notif.type || "info", notif.title || "", notif.message || "", notif.level || "warning", notif.relatedId || null, now());
      return this.getNotification(id);
    },
    getNotification(id) {
      return _("SELECT * FROM notifications WHERE id = ?").get(id);
    },
    listNotifications(limit = 50) {
      return _("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?").all(limit);
    },
    getUnreadNotificationCount() {
      return _("SELECT COUNT(*) as count FROM notifications WHERE read = 0").get().count;
    },
    markNotificationRead(id) {
      _("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
      return this.getNotification(id);
    },
    markAllNotificationsRead() {
      _("UPDATE notifications SET read = 1 WHERE read = 0").run();
    },
    deleteNotification(id) {
      const e = _("SELECT * FROM notifications WHERE id = ?").get(id);
      if (!e) return false;
      _("DELETE FROM notifications WHERE id = ?").run(id);
      return true;
    },
    clearAllNotifications() {
      _("DELETE FROM notifications").run();
    },

    // Scheduled Tasks
    createScheduledTask(input) {
      const id = randomUUID();
      const time = now();
      const cronExpression = String(input.cronExpression || "").trim();
      const nextRunAt = input.nextRunAt || (cronExpression ? nextCronRun(cronExpression, time) : time);
      _("INSERT INTO scheduled_tasks (id, name, task_type, config, cron_expression, interval_minutes, account_id, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.name || "未命名任务", input.taskType || "crawl", JSON.stringify(input.config || {}), cronExpression, input.intervalMinutes || 0, input.accountId || null, input.enabled !== false ? 1 : 0, nextRunAt, time, time);
      return this.getScheduledTask(id);
    },
    getScheduledTask(id) {
      const r = _("SELECT * FROM scheduled_tasks WHERE id = ?").get(id);
      return r ? { ...r, config: fromJson(r.config, {}), enabled: Boolean(r.enabled) } : null;
    },
    listScheduledTasks() {
      return _("SELECT * FROM scheduled_tasks ORDER BY created_at DESC").all().map((r) => ({ ...r, config: fromJson(r.config, {}), enabled: Boolean(r.enabled) }));
    },
    updateScheduledTask(id, patch) {
      const existing = _("SELECT * FROM scheduled_tasks WHERE id = ?").get(id);
      if (!existing) return null;
      const time = now();
      const updates = [];
      const params = [];
      for (const [key, value] of Object.entries(patch)) {
        const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
        if (["name", "task_type", "config", "cron_expression", "interval_minutes", "account_id", "enabled", "last_run_at", "next_run_at", "status"].includes(col)) {
          updates.push(`${col} = ?`);
          params.push(key === "enabled" ? (value ? 1 : 0) : key === "config" ? JSON.stringify(value) : value);
        }
      }
      if (updates.length) {
        _(`UPDATE scheduled_tasks SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`).run(...params, time, id);
      }
      return this.getScheduledTask(id);
    },
    deleteScheduledTask(id) {
      const e = _("SELECT * FROM scheduled_tasks WHERE id = ?").get(id);
      if (!e) return false;
      _("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
      _("DELETE FROM task_logs WHERE task_id = ?").run(id);
      return true;
    },
    getDueTasks() {
      return _("SELECT * FROM scheduled_tasks WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)")
        .all(now()).map((r) => ({ ...r, config: fromJson(r.config, {}), enabled: Boolean(r.enabled) }));
    },
    createTaskLog(taskId, status, message = "") {
      const id = randomUUID();
      _("INSERT INTO task_logs (id, task_id, status, message, started_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, taskId, status, message, now());
      return id;
    },
    finishTaskLog(id, status, message = "", resultCount = 0) {
      _("UPDATE task_logs SET status = ?, message = ?, result_count = ?, finished_at = ? WHERE id = ?").run(status, message, resultCount, now(), id);
    },
    listTaskLogs(limit = 30) {
      return _("SELECT * FROM task_logs ORDER BY started_at DESC LIMIT ?").all(limit);
    },

    // Monitor Sources
    listMonitorSources() {
      return _("SELECT * FROM monitor_sources ORDER BY created_at DESC").all().map((r) => ({
        id: r.id,
        provider: r.provider,
        name: r.name,
        config: fromJson(r.config, {}),
        enabled: Boolean(r.enabled),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
    }
  };
}
