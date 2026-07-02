import { strict as assert } from "node:assert";

/**
 * 测试 followAccount 的 seenNoteIds 回退逻辑。
 *
 * 核心场景：
 * HTTP 路径 3 条成功、2 条失败后降级 Playwright，
 * 应该只让失败 2 条进入 Playwright 路径，已成功的 3 条不重复采集。
 *
 * 由于真实 followAccount 依赖 Playwright 浏览器，
 * 本测试通过分析 followAccount 函数中的 seenNoteIds 回退逻辑来验证。
 */

// 模拟 followAccount 的回退逻辑
function simulateFallbackLogic(noteUrls, knownNoteIdSet, fetchSuccessMap, repairNoteIdSet = new Set()) {
  const seenNoteIds = new Set();
  const successNoteIds = new Set();
  const allNotes = [];
  let successCount = 0;
  let attemptedNewCount = 0;

  for (const url of noteUrls) {
    const parts = url.split("/").pop() || "";
    const qIdx = parts.indexOf("?");
    const noteId = qIdx >= 0 ? parts.substring(0, qIdx) : parts;
    if (!noteId || seenNoteIds.has(noteId)) continue;
    if (knownNoteIdSet.has(noteId) && !repairNoteIdSet.has(noteId)) { seenNoteIds.add(noteId); continue; }
    seenNoteIds.add(noteId);
    attemptedNewCount++;

    const isSuccess = fetchSuccessMap(url);
    if (isSuccess) {
      allNotes.push({ url, noteId, source: "http" });
      successCount++;
      successNoteIds.add(noteId);
    }
  }

  const shouldFallback =
    (knownNoteIdSet.size === 0 && successCount === 0) ||
    (attemptedNewCount > 0 && successCount === 0);

  let fallbackProcessed = 0;
  const pwNotes = [];

  if (!shouldFallback && attemptedNewCount > 0) {
    const failedNoteIds = [...seenNoteIds].filter(function(id) { return !knownNoteIdSet.has(id) && !successNoteIds.has(id); });
    for (const failedId of failedNoteIds) {
      seenNoteIds.delete(failedId);
    }
    fallbackProcessed = failedNoteIds.length;
    for (const url of noteUrls) {
      const parts = url.split("/").pop() || "";
      const qIdx = parts.indexOf("?");
      const noteId = qIdx >= 0 ? parts.substring(0, qIdx) : parts;
      if (!noteId || seenNoteIds.has(noteId)) continue;
      if (knownNoteIdSet.has(noteId) && !repairNoteIdSet.has(noteId)) continue;
      seenNoteIds.add(noteId);
      pwNotes.push({ url, noteId, source: "playwright" });
    }
  } else if (shouldFallback) {
    for (const url of noteUrls) {
      const parts = url.split("/").pop() || "";
      const qIdx = parts.indexOf("?");
      const noteId = qIdx >= 0 ? parts.substring(0, qIdx) : parts;
      if (noteId && (!knownNoteIdSet.has(noteId) || repairNoteIdSet.has(noteId)) && !successNoteIds.has(noteId)) {
        seenNoteIds.delete(noteId);
      }
    }
    for (const url of noteUrls) {
      const parts = url.split("/").pop() || "";
      const qIdx = parts.indexOf("?");
      const noteId = qIdx >= 0 ? parts.substring(0, qIdx) : parts;
      if (!noteId || seenNoteIds.has(noteId)) continue;
      if (knownNoteIdSet.has(noteId) && !repairNoteIdSet.has(noteId)) continue;
      seenNoteIds.add(noteId);
      pwNotes.push({ url, noteId, source: "playwright" });
    }
    fallbackProcessed = pwNotes.length;
  }

  return { allNotes, pwNotes, successNoteIds, shouldFallback, fallbackProcessed };
}

// 测试数据
const noteUrls = [
  "https://www.xiaohongshu.com/explore/note001?xsec_token=abc",
  "https://www.xiaohongshu.com/explore/note002?xsec_token=def",
  "https://www.xiaohongshu.com/explore/note003?xsec_token=ghi",
  "https://www.xiaohongshu.com/explore/note004?xsec_token=jkl",
  "https://www.xiaohongshu.com/explore/note005?xsec_token=mno"
];

// 测试 1: HTTP 成功 3 条（001/002/003），失败 2 条（004/005）
{
  const fetchSuccessMap = (url) => {
    const id = url.split("/").pop()?.split("?")[0] || url;
    return ["note001", "note002", "note003"].includes(id);
  };

  const result = simulateFallbackLogic(noteUrls, new Set(), fetchSuccessMap);

  assert.equal(result.allNotes.length, 3, "HTTP 路径应有 3 条成功");
  assert.equal(result.allNotes.filter(n => n.source === "http").length, 3, "3 条都来自 HTTP");
  assert.equal(result.successNoteIds.size, 3, "successNoteIds 应有 3 条");
  assert.equal(result.shouldFallback, false, "不需要降级");

  // 验证降级路径只处理失败的 2 条
  assert.equal(result.fallbackProcessed, 2, "降级路径只处理未成功的 2 条");
  assert.equal(result.pwNotes.length, 2, "Playwright 路径应只有 2 条");

  const pwIds = result.pwNotes.map(n => n.noteId).sort();
  assert.deepEqual(pwIds, ["note004", "note005"], "Playwright 应只处理失败的 2 条");

  console.log("✅ 测试 1 通过: 3 条 HTTP 成功 + 2 条降级，无重复");
}

// 测试 2: 全部 HTTP 成功 — 无需降级
{
  const fetchSuccessMap = () => true;
  const result = simulateFallbackLogic(noteUrls, new Set(), fetchSuccessMap);

  assert.equal(result.allNotes.length, 5, "全部 HTTP 成功");
  assert.equal(result.fallbackProcessed, 0, "无需 Playwright 降级");

  console.log("✅ 测试 2 通过: 全部 HTTP 成功无需降级");
}

// 测试 3: 全部 HTTP 失败 — 降级处理所有
{
  const fetchSuccessMap = () => false;
  const result = simulateFallbackLogic(noteUrls, new Set(), fetchSuccessMap);

  assert.equal(result.allNotes.length, 0, "HTTP 路径无成功");
  assert.equal(result.shouldFallback, true, "应触发降级");
  assert.equal(result.fallbackProcessed, 5, "降级处理所有 5 条");

  console.log("✅ 测试 3 通过: 全部失败则降级处理所有");
}

// 测试 4: 非首次跟随 — knownNoteIds 去重
{
  const knownNoteIdSet = new Set(["note001", "note002"]);
  const fetchSuccessMap = (url) => {
    const id = url.split("/").pop()?.split("?")[0] || url;
    return id === "note003";
  };

  const result = simulateFallbackLogic(noteUrls, knownNoteIdSet, fetchSuccessMap);

  // note001, note002 是 knownNoteIds，不应处理
  // note003 HTTP 成功
  // note004, note005 HTTP 失败 → 降级处理
  assert.equal(result.allNotes.length, 1, "只有 note003 是新的已采集");
  assert.equal(result.fallbackProcessed, 2, "降级处理 2 条（004/005）");
  assert.equal(result.pwNotes.length, 2, "Playwright 2 条");

  console.log("✅ 测试 4 通过: 非首次跟随 + knownNoteIds 去重");
}

// 测试 5: 非首次跟随 — 已知但待修复的 noteId 仍应重新处理
{
  const knownNoteIdSet = new Set(["note001", "note002"]);
  const repairNoteIdSet = new Set(["note001"]);
  const fetchSuccessMap = (url) => {
    const id = url.split("/").pop()?.split("?")[0] || url;
    return id === "note001" || id === "note003";
  };

  const result = simulateFallbackLogic(noteUrls, knownNoteIdSet, fetchSuccessMap, repairNoteIdSet);

  assert.deepEqual(result.allNotes.map((note) => note.noteId), ["note001", "note003"], "待修复的已知笔记应重新进入 HTTP 采集");
  assert.equal(result.fallbackProcessed, 2, "未成功的新笔记仍应进入降级处理");

  console.log("✅ 测试 5 通过: 已知但待修复的笔记会重新采集");
}

console.log("\n=== follow-account-dedup-test passed ===");
