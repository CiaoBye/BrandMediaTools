import { randomUUID } from "node:crypto";
import { now, fromJson } from "./db.mjs";

export function createAccountStore(db) {
  const _ = (sql) => db.prepare(sql);

  return {
    createAccount(input) {
      const id = randomUUID();
      const time = now();
      _(`INSERT INTO accounts (id, platform, brand, account_name, account_url, tone, industry, priority, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.platform || "小红书", input.brand || "未命名品牌", input.accountName || "", input.accountUrl || "", input.tone || "", input.industry || "", input.priority || "中", input.notes || "", time, time);
      return this.getAccount(id);
    },
    listAccounts() { return _("SELECT * FROM accounts ORDER BY updated_at DESC").all(); },
    getAccount(id) { return _("SELECT * FROM accounts WHERE id = ?").get(id); },
    updateAccount(id, input) {
      const existing = _("SELECT * FROM accounts WHERE id = ?").get(id);
      if (!existing) return null;
      const time = now();
      _(`UPDATE accounts SET brand = ?, account_name = ?, account_url = ?, tone = ?, industry = ?, priority = ?, notes = ?, updated_at = ? WHERE id = ?`)
        .run(input.brand ?? existing.brand, input.accountName ?? existing.account_name, input.accountUrl ?? existing.account_url, input.tone ?? existing.tone, input.industry ?? existing.industry, input.priority ?? existing.priority, input.notes ?? existing.notes, time, id);
      return this.getAccount(id);
    },
    deleteAccount(id) {
      const existing = _("SELECT * FROM accounts WHERE id = ?").get(id);
      if (!existing) return false;
      _("UPDATE notes SET account_id = NULL WHERE account_id = ?").run(id);
      _("DELETE FROM accounts WHERE id = ?").run(id);
      return true;
    },
    getRecentBrands(limit = 3) {
      return _("SELECT brand, MAX(collected_at) as last_used FROM notes WHERE brand != '' AND brand IS NOT NULL GROUP BY brand ORDER BY last_used DESC LIMIT ?").all(limit).map((r) => r.brand);
    },

    // Followed Accounts
    listFollowedAccounts() { return _("SELECT * FROM followed_accounts ORDER BY updated_at DESC").all(); },
    getFollowedAccount(id) { return _("SELECT * FROM followed_accounts WHERE id = ?").get(id); },
    getFollowedAccountByUserId(userId) { return _("SELECT * FROM followed_accounts WHERE user_id = ?").get(userId); },
    upsertFollowedAccount(input) {
      const uid = input.user_id || input.userId || "";
      const existing = uid ? _("SELECT * FROM followed_accounts WHERE user_id = ?").get(uid) : null;
      const id = existing?.id || randomUUID();
      const time = now();
      if (existing) {
        const updates = []; const params = [];
        for (const [key, value] of Object.entries({ author_name: input.authorName, author_url: input.authorUrl, brand: input.brand, last_cursor: input.lastCursor, last_check_at: input.lastCheckAt, total_found: input.totalFound, avatar_url: input.avatarUrl })) {
          if (value !== undefined) { updates.push(`${key} = ?`); params.push(value); }
        }
        if (updates.length) { _(`UPDATE followed_accounts SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`).run(...params, time, id); }
      } else {
        _(`INSERT INTO followed_accounts (id, user_id, author_name, author_url, brand, last_cursor, total_found, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, uid, input.authorName || "", input.authorUrl || "", input.brand || "", input.lastCursor || "", input.totalFound || 0, input.avatarUrl || "", time, time);
      }
      return this.getFollowedAccount(id);
    },
    deleteFollowedAccount(id) {
      const existing = _("SELECT * FROM followed_accounts WHERE id = ?").get(id);
      if (!existing) return false;
      _("DELETE FROM follow_checks WHERE account_id = ?").run(id);
      _("DELETE FROM followed_accounts WHERE id = ?").run(id);
      return true;
    },
    createFollowCheck(input) {
      const id = randomUUID();
      _("INSERT INTO follow_checks (id, account_id, check_at, new_notes, total_notes, status) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, input.accountId, input.checkAt || now(), input.newNotes || 0, input.totalNotes || 0, input.status || "成功");
      return id;
    },
    getFollowTimeline(accountId, limit = 30) {
      return _("SELECT * FROM follow_checks WHERE account_id = ? ORDER BY check_at DESC LIMIT ?").all(accountId, limit);
    }
  };
}
