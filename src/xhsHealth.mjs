export function getLevelMeta(level) {
  if (level === -102) return { level, label: "L-102 严重限流", color: "severe", emoji: "⛔", description: "严重限流，不可逆" };
  if (level <= -5) return { level, label: `L${level} 中度限流`, color: "darkRed", emoji: "🔴", description: "中度限流" };
  if (level === -1) return { level, label: "L-1 轻度限流", color: "red", emoji: "🔴", description: "轻度限流" };
  if (level === 1) return { level, label: "L1 新帖审核", color: "yellow", emoji: "⚪", description: "新帖，审核中" };
  if (level >= 4) return { level, label: "L4 正常", color: "green", emoji: "🟢", description: "正常分发" };
  if (level >= 2) return { level, label: `L${level} 基本正常`, color: "lightGreen", emoji: "🟡", description: "基本正常" };
  return { level, label: `L${level} 未知`, color: "gray", emoji: "❓", description: "未知状态" };
}

const SENSITIVE_WORDS = ["自动化", "自动发布", "AI生成", "内容工厂", "批量", "全自动", "自动工作流", "AI自动"];

export function detectSensitiveWords(title) {
  return SENSITIVE_WORDS.filter((w) => title.includes(w));
}

export function checkTagCount(note) {
  const candidates = ["tag_list", "tags", "topic_list", "topics", "hash_tag_list"];
  for (const key of candidates) {
    if (Array.isArray(note[key])) return { count: note[key].length, warning: note[key].length > 5 };
  }
  return { count: 0, warning: false };
}

export function diagnoseNote(note) {
  const noteId = String(note.note_id ?? note.noteId ?? note.id ?? "");
  const title = String(note.display_title ?? note.title ?? note.note_title ?? "");
  // 优先从 raw 字段读取分发等级（采集时可能存入），其次尝试顶层字段
  const rawObj = note.raw && typeof note.raw === "object" ? note.raw : {};
  const levelVal = Number(rawObj.level_ ?? rawObj.level ?? rawObj.distribution_level ?? note.level_ ?? note.level ?? note.distribution_level ?? NaN);
  // 无法获取 level 时标记为 L0 待采集（非限流，仅表示未采集到分发数据）
  const level = Number.isFinite(levelVal) ? levelVal : 0;
  const levelMeta = level === 0 ? { level: 0, label: "L0 待采集", color: "gray", emoji: "❓", description: "未采集到分发等级数据" } : getLevelMeta(level);
  const sensitiveHits = detectSensitiveWords(title);
  const { count: tagCount, warning: tagWarning } = checkTagCount(note);
  return { noteId, title, level, levelMeta, sensitiveHits, tagCount, tagWarning };
}

export function buildHealthReport(rawNotes) {
  const notes = rawNotes.map(diagnoseNote);
  const distribution = {};
  for (const n of notes) {
    const key = n.levelMeta.emoji + " " + n.levelMeta.label;
    distribution[key] = (distribution[key] ?? 0) + 1;
  }
  // level < 0 才是限流，level === 0 是待采集
  const limitedNotes = notes.filter((n) => n.level < 0);
  const sensitiveNotes = notes.filter((n) => n.sensitiveHits.length > 0 || n.tagWarning);
  return { totalNotes: notes.length, notes, distribution, limitedNotes, sensitiveNotes };
}
