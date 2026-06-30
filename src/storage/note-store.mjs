import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import { now, fromJson, toJson } from "./db.mjs";
import { envWithSettings } from "../settings.mjs";
import { extractXhsId } from "../xhsSdk.mjs";

export function createNoteStore(db, rootDir) {
  // Migration: add ip_location, last_update_time, cover_url columns
  try { db.exec("ALTER TABLE notes ADD COLUMN ip_location TEXT"); } catch {}
  try { db.exec("ALTER TABLE notes ADD COLUMN last_update_time TEXT"); } catch {}
  try { db.exec("ALTER TABLE notes ADD COLUMN cover_url TEXT"); } catch {}

  const _ = (sql) => db.prepare(sql);

  function hydrateNoteWith(row, assets, analysis) {
    if (!row) return null;
    return {
      id: row.id, platform: row.platform, sourceUrl: row.source_url, noteId: row.note_id,
      accountId: row.account_id, brand: row.brand, authorName: row.author_name, authorId: row.author_id,
      title: row.title, description: row.description, publishedAt: row.published_at, collectedAt: row.collected_at,
      contentType: row.content_type, marketingGoal: row.marketing_goal, sellingPoints: fromJson(row.selling_points, []),
      visualStyle: row.visual_style, tags: fromJson(row.tags, []), metrics: fromJson(row.metrics, {}),
      raw: fromJson(row.raw, {}), status: row.status, reviewReason: row.review_reason,
      libraryType: row.library_type, scriptDirection: row.script_direction,
      ipLocation: row.ip_location || null, lastUpdateTime: row.last_update_time || null, coverUrl: row.cover_url || null,
      assets: assets, analysis: analysis
    };
  }

  function hydrateNote(row) {
    if (!row) return null;
    return hydrateNoteWith(row, listAssetsByNote(row.id), getAnalysis(row.id));
  }

  function batchHydrateNotes(rows) {
    if (!rows.length) return [];
    const SQLITE_CHUNK = 500;
    const allAssets = [];
    const allAnalysis = [];
    for (let i = 0; i < rows.length; i += SQLITE_CHUNK) {
      const chunk = rows.slice(i, i + SQLITE_CHUNK);
      const noteIds = chunk.map(r => r.id);
      const placeholders = noteIds.map(() => "?").join(",");
      const chunkAssets = _("SELECT * FROM assets WHERE note_id IN (" + placeholders + ") ORDER BY created_at ASC").all(...noteIds);
      for (const a of chunkAssets) allAssets.push(a);
      const chunkAnalysis = _("SELECT * FROM analysis WHERE note_id IN (" + placeholders + ")").all(...noteIds);
      for (const a of chunkAnalysis) allAnalysis.push(a);
    }
    const assetsByNote = new Map();
    for (const a of allAssets) {
      if (!assetsByNote.has(a.note_id)) assetsByNote.set(a.note_id, []);
      assetsByNote.get(a.note_id).push({
        id: a.id, noteId: a.note_id, kind: a.kind, sourceUrl: a.source_url, localPath: a.local_path,
        fileName: a.file_name, fileSize: a.file_size, width: a.width, height: a.height, resolution: a.resolution,
        mimeType: a.mime_type, status: a.status, watermarkStatus: a.watermark_status, error: a.error,
        imageIndex: a.image_index, pairedImageIndex: a.paired_image_index, livePhoto: Boolean(a.live_photo),
        fileId: a.file_id, traceId: a.trace_id, raw: fromJson(a.raw, {}), createdAt: a.created_at
      });
    }
    const analysisByNote = new Map();
    for (const a of allAnalysis) {
      analysisByNote.set(a.note_id, {
        id: a.id, noteId: a.note_id, model: a.model, topicLogic: a.topic_logic, openingHook: a.opening_hook,
        videoStructure: a.video_structure, sellingPointExpression: a.selling_point_expression,
        visualStyle: a.visual_style, conversionScript: a.conversion_script, takeaways: a.takeaways,
        howWeCanUse: a.how_we_can_use, scriptDirections: fromJson(a.script_directions, []),
        raw: fromJson(a.raw, {}), createdAt: a.created_at
      });
    }
    return rows.map(r => hydrateNoteWith(r, assetsByNote.get(r.id) || [], analysisByNote.get(r.id) || null));
  }

  function listAssetsByNote(noteId) {
    return _("SELECT * FROM assets WHERE note_id = ? ORDER BY created_at ASC").all(noteId).map((r) => ({
      id: r.id, noteId: r.note_id, kind: r.kind, sourceUrl: r.source_url, localPath: r.local_path,
      fileName: r.file_name, fileSize: r.file_size, width: r.width, height: r.height, resolution: r.resolution,
      mimeType: r.mime_type, status: r.status, watermarkStatus: r.watermark_status, error: r.error,
      imageIndex: r.image_index, pairedImageIndex: r.paired_image_index, livePhoto: Boolean(r.live_photo),
      fileId: r.file_id, traceId: r.trace_id, raw: fromJson(r.raw, {}), createdAt: r.created_at
    }));
  }

  function getAnalysis(noteId) {
    const row = _("SELECT * FROM analysis WHERE note_id = ?").get(noteId);
    if (!row) return null;
    return { id: row.id, noteId: row.note_id, model: row.model, topicLogic: row.topic_logic, openingHook: row.opening_hook, videoStructure: row.video_structure, sellingPointExpression: row.selling_point_expression, visualStyle: row.visual_style, conversionScript: row.conversion_script, takeaways: row.takeaways, howWeCanUse: row.how_we_can_use, scriptDirections: fromJson(row.script_directions, []), raw: fromJson(row.raw, {}), createdAt: row.created_at };
  }

  const store = {
    listAssetsByNote,
    getAnalysis,
    getAsset(id) {
      const r = _("SELECT * FROM assets WHERE id = ?").get(id);
      if (!r) return null;
      return {
        id: r.id, noteId: r.note_id, kind: r.kind, sourceUrl: r.source_url, localPath: r.local_path,
        fileName: r.file_name, fileSize: r.file_size, width: r.width, height: r.height, resolution: r.resolution,
        mimeType: r.mime_type, status: r.status, watermarkStatus: r.watermark_status, error: r.error,
        imageIndex: r.image_index, pairedImageIndex: r.paired_image_index, livePhoto: Boolean(r.live_photo),
        fileId: r.file_id, traceId: r.trace_id, raw: fromJson(r.raw, {}), createdAt: r.created_at
      };
    },
    findNoteBySourceUrl(sourceUrl) {
      const noteId = extractXhsId(sourceUrl || "");
      const row = noteId
        ? _("SELECT * FROM notes WHERE (note_id = ? OR source_url = ?)").get(noteId, sourceUrl)
        : _("SELECT * FROM notes WHERE (source_url = ?)").get(sourceUrl);
      return row ? hydrateNote(row) : null;
    },
    findNoteByNoteId(noteId) {
      if (!noteId) return null;
      const row = _("SELECT * FROM notes WHERE note_id = ?").get(noteId);
      return row ? hydrateNote(row) : null;
    },

    upsertNote(note) {
      const canonicalNoteId = note.noteId || extractXhsId(note.sourceUrl || "");
      const existing = canonicalNoteId
        ? _("SELECT * FROM notes WHERE (note_id = ? OR source_url = ?)").get(canonicalNoteId, note.sourceUrl)
        : _("SELECT * FROM notes WHERE (source_url = ?)").get(note.sourceUrl);
      const id = existing?.id || randomUUID();
      const time = now();
      if (existing) {
        _(`UPDATE notes SET note_id = ?, account_id = ?, brand = ?, author_name = ?, author_id = ?, title = ?, description = ?, published_at = ?, content_type = ?, marketing_goal = ?, selling_points = ?, visual_style = ?, tags = ?, metrics = ?, raw = ?, status = ?, review_reason = ?, library_type = ?, ip_location = ?, last_update_time = ?, cover_url = ? WHERE id = ?`)
          .run(canonicalNoteId || existing.note_id || "", note.accountId || existing.account_id || null, note.brand || existing.brand || "", note.authorName || existing.author_name || "", note.authorId || existing.author_id || "", note.title || existing.title || "", note.description || existing.description || "", note.publishedAt || existing.published_at || "", note.contentType || existing.content_type || "", note.marketingGoal || existing.marketing_goal || "", toJson(note.sellingPoints, fromJson(existing.selling_points, [])), note.visualStyle || existing.visual_style || "", toJson(note.tags, fromJson(existing.tags, [])), toJson(note.metrics, fromJson(existing.metrics, {})), toJson(note.raw, fromJson(existing.raw, {})), note.status || existing.status || "已入库", note.reviewReason || existing.review_reason || "", note.libraryType || existing.library_type || null, note.ipLocation || existing.ip_location || null, note.lastUpdateTime || existing.last_update_time || null, note.coverUrl || existing.cover_url || null, id);
      } else {
        _(`INSERT INTO notes (id, platform, source_url, note_id, account_id, brand, author_name, author_id, title, description, published_at, collected_at, content_type, marketing_goal, selling_points, visual_style, tags, metrics, raw, status, review_reason, library_type, ip_location, last_update_time, cover_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, note.platform || "小红书", note.sourceUrl, canonicalNoteId || "", note.accountId || null, note.brand || "", note.authorName || "", note.authorId || "", note.title || "", note.description || "", note.publishedAt || "", time, note.contentType || "", note.marketingGoal || "", toJson(note.sellingPoints, []), note.visualStyle || "", toJson(note.tags, []), toJson(note.metrics, {}), toJson(note.raw, {}), note.status || "已入库", note.reviewReason || "", note.libraryType || null, note.ipLocation || null, note.lastUpdateTime || null, note.coverUrl || null);
      }
      return store.getNote(id);
    },

    getNote(id) { return hydrateNote(_("SELECT * FROM notes WHERE id = ?").get(id)); },

    listNotes(filters = {}) {
      const conditions = [];
      const params = [];
      const simpleFields = { brand: "brand", accountId: "account_id", contentType: "content_type", marketingGoal: "marketing_goal", libraryType: "library_type", authorId: "author_id" };
      for (const [key, col] of Object.entries(simpleFields)) {
        if (filters[key]) { conditions.push(`${col} = ?`); params.push(filters[key]); }
      }
      // q 和 assetKind 需要内存过滤，暂不能 SQL 化
      const needsPostFilter = !!(filters.q || filters.assetKind);
      let sql = "SELECT * FROM notes";
      if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
      sql += " ORDER BY collected_at DESC";
      const rows = _(sql).all(...params);
      if (!needsPostFilter) return batchHydrateNotes(rows);
      return batchHydrateNotes(rows).filter((note) => {
        const q = (filters.q || "").trim().toLowerCase();
        if (q && ![note.title, note.description, note.brand, note.authorName, note.visualStyle, note.marketingGoal, ...(note.tags || [])].join(" ").toLowerCase().includes(q)) return false;
        if (filters.assetKind && !(note.assets || []).some((a) => a.kind === filters.assetKind)) return false;
        return true;
      });
    },

    addAssets(noteId, assets) {
      const list = Array.isArray(assets) ? assets : [];
      if (!list.length) return listAssetsByNote(noteId);
      try {
        db.exec("BEGIN");
        _("DELETE FROM assets WHERE note_id = ?").run(noteId);
        const time = now();
        const seen = new Set();
        const stmt = _(`INSERT INTO assets (id, note_id, kind, source_url, local_path, file_name, file_size, width, height, resolution, mime_type, status, watermark_status, error, image_index, paired_image_index, live_photo, file_id, trace_id, raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const asset of list) {
          const key = `${asset.kind || "unknown"}::${asset.sourceUrl || asset.localPath || asset.fileName || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          stmt.run(randomUUID(), noteId, asset.kind || "unknown", asset.sourceUrl || "", asset.localPath || "", asset.fileName || "", asset.fileSize || 0, asset.width || null, asset.height || null, asset.resolution || "", asset.mimeType || "", asset.status || "待复核", asset.watermarkStatus || "未知", asset.error || "", asset.imageIndex || null, asset.pairedImageIndex || null, asset.livePhoto ? 1 : 0, asset.fileId || "", asset.traceId || "", toJson({ source: asset.source || "", imageIndex: asset.imageIndex || null, pairedImageIndex: asset.pairedImageIndex || null, livePhoto: Boolean(asset.livePhoto), fileId: asset.fileId || "", traceId: asset.traceId || "", original: asset }, {}), time);
        }
        db.exec("COMMIT");
      } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
      return listAssetsByNote(noteId);
    },

    deleteNote(id) {
      const existing = _("SELECT * FROM notes WHERE id = ?").get(id);
      if (!existing) return false;
      deleteNoteFiles(id, existing);
      db.exec("BEGIN");
      try {
        _("DELETE FROM assets WHERE note_id = ?").run(id);
        _("DELETE FROM analysis WHERE note_id = ?").run(id);
        _("DELETE FROM crawl_jobs WHERE input_url = ?").run(existing.source_url);
        _("DELETE FROM notes WHERE id = ?").run(id);
        db.exec("COMMIT");
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
      return true;
    },

    batchDeleteNotes(ids) {
      if (!ids || !ids.length) return 0;
      db.exec("BEGIN");
      try {
        let count = 0;
        for (const id of ids) {
          const existing = _("SELECT * FROM notes WHERE id = ?").get(id);
          if (!existing) continue;
          deleteNoteFiles(id, existing);
          _("DELETE FROM assets WHERE note_id = ?").run(id);
          _("DELETE FROM analysis WHERE note_id = ?").run(id);
          _("DELETE FROM notes WHERE id = ?").run(id);
          count++;
        }
        db.exec("COMMIT");
        return count;
      } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
    },

    saveAnalysis(noteId, analysis) {
      _("DELETE FROM analysis WHERE note_id = ?").run(noteId);
      _(`INSERT INTO analysis (id, note_id, model, topic_logic, opening_hook, video_structure, selling_point_expression, visual_style, conversion_script, takeaways, how_we_can_use, script_directions, raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), noteId, analysis.model || "", analysis.topicLogic || "", analysis.openingHook || "", analysis.videoStructure || "", analysis.sellingPointExpression || "", analysis.visualStyle || "", analysis.conversionScript || "", analysis.takeaways || "", analysis.howWeCanUse || "", toJson(analysis.scriptDirections, []), toJson(analysis.raw, analysis), now());
      return getAnalysis(noteId);
    },

    saveComments(noteId, comments) {
      _("DELETE FROM comments WHERE note_id = ?").run(noteId);
      const time = now();
      const stmt = _("INSERT INTO comments (id, note_id, parent_id, author_name, author_id, content, likes, time, raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const c of comments) {
        const replies = c.replies || [];
        stmt.run(randomUUID(), noteId, null, c.author || c.authorName || "", c.authorId || "", c.content || "", Number(c.likes || 0), c.time || "", toJson(c, {}), time);
        for (const r of replies) { stmt.run(randomUUID(), noteId, c.id || null, r.author || r.authorName || "", r.authorId || "", r.content || "", Number(r.likes || 0), r.time || "", toJson(r, {}), time); }
      }
      return store.getComments(noteId);
    },

    getComments(noteId) {
      const rows = _("SELECT * FROM comments WHERE note_id = ? ORDER BY created_at ASC").all(noteId);
      const top = []; const replyMap = {};
      for (const row of rows) {
        const c = { id: row.id, noteId: row.note_id, parentId: row.parent_id, authorName: row.author_name, authorId: row.author_id, content: row.content, likes: row.likes, time: row.time, raw: fromJson(row.raw, {}), createdAt: row.created_at };
        if (row.parent_id) { if (!replyMap[row.parent_id]) replyMap[row.parent_id] = []; replyMap[row.parent_id].push(c); }
        else { top.push(c); }
      }
      return top.map((c) => ({ ...c, replies: replyMap[c.id] || [] }));
    },

    createJob(inputUrl) {
      const id = randomUUID();
      const time = now();
      _("INSERT INTO crawl_jobs (id, input_url, status, message, result_count, created_at, updated_at) VALUES (?, ?, '运行中', '', 0, ?, ?)").run(id, inputUrl, time, time);
      return id;
    },
    updateJob(id, patch) {
      const existing = _("SELECT * FROM crawl_jobs WHERE id = ?").get(id);
      if (!existing) return null;
      _("UPDATE crawl_jobs SET status = ?, message = ?, result_count = ?, updated_at = ? WHERE id = ?").run(patch.status || existing.status, patch.message ?? existing.message, patch.resultCount ?? existing.result_count, now(), id);
      return _("SELECT * FROM crawl_jobs WHERE id = ?").get(id);
    },
    listJobs() { return _("SELECT * FROM crawl_jobs ORDER BY created_at DESC LIMIT 50").all(); },

    exportNotes(ids, format = "json") {
      const rows = ids && ids.length ? _(`SELECT * FROM notes WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) : _("SELECT * FROM notes ORDER BY collected_at DESC").all();
      const notes = batchHydrateNotes(rows);
      if (format === "csv") {
        const headers = ["id", "sourceUrl", "noteId", "brand", "authorName", "authorId", "title", "contentType", "libraryType", "status", "publishedAt", "collectedAt", "tags", "likes", "comments", "collects", "shares", "aiTopicLogic", "aiOpeningHook", "aiTakeaways", "imageUrls"];
        const lines = [headers.join(",")];
        for (const n of notes) {
          const m = n.metrics || {};
          const a = n.analysis || {};
          const assets = n.assets || [];
          const imgUrls = assets.filter(a => a.kind === "image" && a.sourceUrl).slice(0, 3).map(a => a.sourceUrl).join("; ");
          const csvEsc = (v) => {
            const s = String(v ?? "");
            const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
            return `"${safe.replace(/"/g, '""')}"`;
          };
          lines.push([n.id, n.sourceUrl, n.noteId || "", n.brand, n.authorName, n.authorId || "", csvEsc(n.title), n.contentType || "", n.libraryType || "", n.status, n.publishedAt || "", n.collectedAt, csvEsc((n.tags || []).join("; ")), m.likedCount || m.likeCount || m.likes || 0, m.commentCount || m.comments || 0, m.collectedCount || m.collectCount || m.collects || 0, m.shareCount || m.shares || 0, csvEsc(a.topicLogic || ""), csvEsc(a.openingHook || ""), csvEsc(a.takeaways || ""), csvEsc(imgUrls)].join(","));
        }
        return lines.join("\n");
      }
      return JSON.stringify(notes, null, 2);
    },

    // Batch operations
    batchUpdateTags(ids, tags) {
      if (!ids || !ids.length) return 0;
      const tagsJson = JSON.stringify(tags);
      const updatedAt = now();
      const CHUNK = 500;
      let count = 0;
      db.exec("BEGIN");
      try {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const phs = chunk.map(() => "?").join(",");
          const result = _(`UPDATE notes SET tags = ?, updated_at = ? WHERE id IN (${phs})`).run(tagsJson, updatedAt, ...chunk);
          count += result.changes;
        }
        db.exec("COMMIT");
        return count;
      } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
    },
    batchUpdateBrand(ids, brand) {
      if (!ids || !ids.length) return 0;
      const updatedAt = now();
      const CHUNK = 500;
      let count = 0;
      db.exec("BEGIN");
      try {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const phs = chunk.map(() => "?").join(",");
          const result = _(`UPDATE notes SET brand = ?, updated_at = ? WHERE id IN (${phs})`).run(brand, updatedAt, ...chunk);
          count += result.changes;
        }
        db.exec("COMMIT");
        return count;
      } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
    },
    setNoteLibraryType(id, libType) {
      const e = _("SELECT * FROM notes WHERE id = ?").get(id);
      if (!e) return null;
      _("UPDATE notes SET library_type = ?, updated_at = ? WHERE id = ?").run(libType || null, now(), id);
      return store.getNote(id);
    },
    batchSetLibraryType(ids, libType) {
      if (!ids || !ids.length) return 0;
      const updatedAt = now();
      const CHUNK = 500;
      let count = 0;
      db.exec("BEGIN");
      try {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const phs = chunk.map(() => "?").join(",");
          const result = _(`UPDATE notes SET library_type = ?, updated_at = ? WHERE id IN (${phs})`).run(libType || null, updatedAt, ...chunk);
          count += result.changes;
        }
        db.exec("COMMIT");
        return count;
      } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
    }
  };

  return store;

  function deleteNoteFiles(id, note) {
    const settings = envWithSettings(rootDir);
    const rawFolder = settings.download?.folderName || "library";
    const libraryRoot = path.resolve(path.isAbsolute(rawFolder) ? rawFolder : path.join(rootDir, "data", rawFolder));
    const insideLibrary = (target) => {
      const resolved = path.resolve(target);
      const relative = path.relative(libraryRoot, resolved);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    };
    const dirs = new Set();
    const assets = db.prepare("SELECT * FROM assets WHERE note_id = ?").all(id);
    for (const asset of assets) {
      if (!asset.local_path) continue;
      const fullPath = path.resolve(path.isAbsolute(asset.local_path) ? asset.local_path : path.join(rootDir, asset.local_path));
      if (!insideLibrary(fullPath)) continue;
      dirs.add(path.dirname(fullPath));
      try { rmSync(fullPath, { force: true }); } catch {}
    }
    for (const dir of dirs) {
      const metadataPath = path.join(dir, "metadata.json");
      if (existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
          if (metadata.note?.sourceUrl === note?.source_url || metadata.id === id || metadata.note?.noteId === note?.note_id) {
            rmSync(metadataPath, { force: true });
          }
        } catch {}
      }
      try { rmdirSync(dir); } catch {}
    }
  }
}
