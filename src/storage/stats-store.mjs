import { fromJson } from "./db.mjs";

export function createStatsStore(db, getNote, listAssetsByNote) {
  const _ = (sql) => db.prepare(sql);

  function dateFilter(range) {
    const d = new Date();
    if (range === "7") d.setDate(d.getDate() - 7);
    else if (range === "30") d.setDate(d.getDate() - 30);
    else if (range === "90") d.setDate(d.getDate() - 90);
    return `collected_at >= '${d.toISOString()}'`;
  }

  function assetIntegrityOverview(whereSql) {
    const rows = _(`SELECT raw, status FROM notes ${whereSql}`).all();
    const result = { needsRepair: 0 };
    for (const row of rows) {
      const raw = fromJson(row.raw, {});
      const integrity = raw.assetIntegrity || null;
      if (!integrity) continue;
      const expected = integrity.expected || {};
      const saved = integrity.saved || {};
      const missing = integrity.missing || {};
      const expectedTotal = Number(expected.total || 0);
      const savedTotal = Number(saved.total || 0);
      const missingTotal = Number(missing.total || 0);
      if (integrity.complete === false && expectedTotal > 0 && (missingTotal > 0 || savedTotal < expectedTotal)) result.needsRepair++;
    }
    return result;
  }

  return {
    getStats(range) {
      const wd = range ? `WHERE ${dateFilter(range)}` : "";
      const assetIntegrity = assetIntegrityOverview(wd);
      const overview = {
        totalNotes: _(`SELECT COUNT(*) as c FROM notes ${wd}`).get().c,
        totalAssets: _("SELECT COUNT(*) as c FROM assets").get().c,
        totalAccounts: _("SELECT COUNT(*) as c FROM accounts").get().c,
        totalXhsAccounts: _("SELECT COUNT(*) as c FROM xhs_accounts").get().c,
        totalJobs: _("SELECT COUNT(*) as c FROM crawl_jobs").get().c,
        totalAnalysis: _("SELECT COUNT(*) as c FROM analysis").get().c,
        assetPartialNotes: assetIntegrity.needsRepair,
      };
      const byType = _(`SELECT content_type, COUNT(*) as count FROM notes WHERE content_type != '' ${range ? "AND " + dateFilter(range) : ""} GROUP BY content_type ORDER BY count DESC`).all();
      const byBrand = _(`SELECT brand, COUNT(*) as count FROM notes WHERE brand != '' ${range ? "AND " + dateFilter(range) : ""} GROUP BY brand ORDER BY count DESC LIMIT 10`).all();
      const byStatus = _(`SELECT status, COUNT(*) as count FROM notes ${wd} GROUP BY status ORDER BY count DESC`).all();
      const byAssetKind = _("SELECT kind, COUNT(*) as count FROM assets GROUP BY kind ORDER BY count DESC").all();
      const recentNotes = _(`SELECT collected_at FROM notes ${wd} ORDER BY collected_at DESC`).all();
      const dayCounts = {};
      for (const note of recentNotes) { const day = (note.collected_at || "").slice(0, 10); if (day) dayCounts[day] = (dayCounts[day] || 0) + 1; }
      const trend = Object.entries(dayCounts).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([date, count]) => ({ date, count }));
      return { overview, byType, byBrand, byStatus, trend, byAssetKind };
    },

    getInteractionStats(range) {
      const wd = range ? `WHERE ${dateFilter(range)}` : "";
      const rows = _(`SELECT collected_at, metrics FROM notes ${wd} ORDER BY collected_at ASC`).all();
      const buckets = {};
      for (const row of rows) {
        const day = (row.collected_at || "").slice(0, 10);
        if (!day) continue;
        if (!buckets[day]) buckets[day] = { likes: 0, comments: 0, collects: 0, shares: 0, count: 0 };
        const m = fromJson(row.metrics, {});
        buckets[day].likes += Number(m.likedCount || m.likeCount || m.likes || 0);
        buckets[day].comments += Number(m.commentCount || m.comments || 0);
        buckets[day].collects += Number(m.collectedCount || m.collectCount || m.collects || 0);
        buckets[day].shares += Number(m.shareCount || m.shares || 0);
        buckets[day].count++;
      }
      return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([date, v]) => ({ date, ...v }));
    },

    getTopNotes(limit = 20, range) {
      const wd = range ? `WHERE ${dateFilter(range)}` : "";
      // 用 json_extract 从 metrics 字段提取互动数据，SQL 直接排序（避免全量查询+内存排序）
      const rows = _(`SELECT *,
        CAST(COALESCE(json_extract(metrics, '$.likedCount'), json_extract(metrics, '$.likes'), 0) AS INTEGER)
        + CAST(COALESCE(json_extract(metrics, '$.commentCount'), json_extract(metrics, '$.comments'), 0) AS INTEGER)
        + CAST(COALESCE(json_extract(metrics, '$.collectedCount'), json_extract(metrics, '$.collects'), 0) AS INTEGER)
        + CAST(COALESCE(json_extract(metrics, '$.shareCount'), json_extract(metrics, '$.shares'), 0) AS INTEGER) AS total_interactions
        FROM notes ${wd} ORDER BY total_interactions DESC LIMIT ?`).all(limit);
      return rows.map((row) => {
        const note = getNote(row.id);
        return { ...note, totalInteractions: row.total_interactions };
      });
    },

    getTagCloud(limit = 30) {
      const rows = _("SELECT tags FROM notes WHERE tags IS NOT NULL AND tags != ''").all();
      const freq = {};
      for (const row of rows) {
        const tags = fromJson(row.tags, []);
        for (const tag of tags) { if (tag) freq[tag] = (freq[tag] || 0) + 1; }
      }
      return Object.entries(freq).sort(([, a], [, b]) => b - a).slice(0, limit).map(([tag, count]) => ({ tag, count }));
    }
  };
}
