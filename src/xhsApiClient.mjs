// 小红书 API 签名与 HTTP 请求客户端
// 通过 Python signserver 获取签名 headers，然后直调 edith.xiaohongshu.com API
// 一次粘贴 Cookie → 永久免浏览器

import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

let _pythonPath = "";
let _cookieCache = "";

const SIGN_PORT = 9223;
let _signServer = null;
const API_BASE = "https://edith.xiaohongshu.com";

// ---- Cookie 管理 ----

/** 从 data/xhs-cookie.txt 读取 Cookie（自动缓存） */
export function readApiCookie(rootDir) {
  if (_cookieCache) return _cookieCache;
  const filePath = path.join(rootDir, "data", "xhs-cookie.txt");
  if (existsSync(filePath)) {
    _cookieCache = readFileSync(filePath, "utf8").trim();
    if (_cookieCache) console.log(`[xhsApi] 已加载 Cookie (${_cookieCache.split(";").length} 个字段)`);
  }
  return _cookieCache;
}

export function clearCookieCache() { _cookieCache = ""; }

function extractCookies(cookieStr) {
  if (!cookieStr) return {};
  const c = {};
  cookieStr.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) c[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  if (!c.a1) console.warn("[xhsApi] 无 a1 cookie，签名可能失败");
  return c;
}

// ---- 签名服务管理 ----

function findPython() {
  if (_pythonPath) return _pythonPath;
  try {
    _pythonPath = execSync("where python", { encoding: "utf8" }).split("\n")[0].trim();
  } catch {
    const candidates = [
      "C:\\Users\\Ayuan\\AppData\\Local\\Programs\\Python\\Python313\\python.exe",
      "C:\\Python313\\python.exe", "C:\\Python3\\python.exe",
      "/usr/bin/python3", "/usr/local/bin/python3",
    ];
    _pythonPath = candidates.find((p) => existsSync(p)) || "python";
  }
  return _pythonPath;
}

export async function startSignServer(rootDir) {
  if (_signServer) return;
  const scriptPath = path.join(rootDir, "src", "signserver", "server.py");
  if (!existsSync(scriptPath)) throw new Error(`signserver.py 未找到: ${scriptPath}`);
  const pythonExe = findPython();
  _signServer = spawn(pythonExe, ["-u", scriptPath, String(SIGN_PORT)], {
    cwd: path.join(rootDir, "src"), stdio: ["ignore", "pipe", "pipe"],
  });
  _signServer.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) console.log("[signserver]", msg);
  });
  _signServer.on("exit", (code) => { _signServer = null; if (code) console.warn(`[signserver] exited ${code}`); });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://127.0.0.1:${SIGN_PORT}/status`);
      if (r.ok) { console.log("[signserver] ready"); return; }
    } catch {}
  }
  throw new Error("signserver 启动超时");
}

export function stopSignServer() {
  if (_signServer) { try { _signServer.kill(); } catch {} _signServer = null; }
}

// ---- 签名与请求 ----

async function signHeaders(uri, cookies, method = "get", params = {}, payload = {}, xRap = false) {
  const body = { uri, cookies: extractCookies(cookies), method, params, payload, x_rap: xRap };
  const resp = await fetch(`http://127.0.0.1:${SIGN_PORT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await resp.json();
  if (!result.ok) throw new Error(`签名失败: ${result.error}`);
  return result.headers;
}

export async function apiGet(apiPath, cookieStr, params = {}, xRap = false) {
  const headers = await signHeaders(apiPath, cookieStr, "get", params, {}, xRap);
  const url = `${API_BASE}${apiPath}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, {
    headers: { ...headers, Cookie: cookieStr, "Content-Type": "application/json" },
  });
  return resp.json();
}

export async function apiPost(apiPath, cookieStr, payload = {}, xRap = false) {
  const headers = await signHeaders(apiPath, cookieStr, "post", {}, payload, xRap);
  const url = `${API_BASE}${apiPath}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...headers, Cookie: cookieStr, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

// ---- API 端点封装 ----

export async function fetchUserPosted(userId, cursor = "", num = 30, cookieStr) {
  return apiGet("/api/sns/web/v1/user_posted", cookieStr || readApiCookie(process.cwd()), { user_id: userId, cursor, num }, true);
}

export async function fetchNoteFeed(sourceNoteId, cookieStr, xsecToken = "") {
  const payload = { source_note_id: sourceNoteId };
  if (xsecToken) payload.xsec_token = xsecToken;
  return apiPost("/api/sns/web/v1/feed", cookieStr || readApiCookie(process.cwd()), payload, true);
}

export async function searchNotes(keyword, cursor = "", pageSize = 20, sort = "general", noteType = 0, cookieStr) {
  return apiPost("/api/sns/web/v1/search/notes", cookieStr || readApiCookie(process.cwd()), {
    keyword, cursor, page_size: pageSize, sort, note_type: noteType,
  }, true);
}

export async function fetchComments(noteId, cursor = "", topCommentId = "", imageFormats = "jpg,webp,avif", cookieStr) {
  return apiGet("/api/sns/web/v2/comment/page", cookieStr || readApiCookie(process.cwd()), {
    note_id: noteId, cursor, top_comment_id: topCommentId, image_formats: imageFormats,
  }, true);
}

export async function fetchUserInfo(userId, cookieStr) {
  return apiPost("/api/sns/web/v1/user/selfinfo", cookieStr || readApiCookie(process.cwd()), { user_id: userId });
}

// ---- API 响应 → 笔记格式转换 ----

/** 将 edith API 的 feed 响应转成我们的笔记格式 */
function apiNoteToNote(apiData, sourceUrl = "") {
  if (!apiData) return null;
  const items = apiData.items || (apiData.data?.items) || [];
  if (!items.length) return null;
  const item = items[0];
  const noteCard = item.note_card || item;
  const imageList = noteCard.image_list || noteCard.cover?.image_list || [];
  const video = noteCard.video || noteCard.media?.video || null;

  // 图片素材
  const images = imageList.map((img, i) => ({
    kind: "image", sourceUrl: img.info_list?.[0]?.image_scene?.url || img.url_default || "",
    url: img.info_list?.[0]?.image_scene?.url || img.url_default || "",
    width: img.width || null, height: img.height || null,
    watermarkStatus: "未知", source: "api:feed", imageIndex: i + 1,
    fileId: img.trace_id || "", traceId: img.trace_id || "",
  }));

  // 视频素材
  const videos = video ? [{
    kind: "video", sourceUrl: video.media?.stream?.master_url || video.media?.stream?.[0]?.master_url || "",
    url: video.media?.stream?.master_url || video.media?.stream?.[0]?.master_url || "",
    width: video.width || null, height: video.height || null,
    fileSize: video.media?.size || null, bitrate: video.media?.bitrate || null,
    watermarkStatus: video.media?.watermark ? "有水印" : "无水印",
    source: "api:feed", fileId: video.trace_id || "", traceId: video.trace_id || "",
  }] : [];

  // LivePhoto
  const livePhotos = [];
  for (const img of imageList) {
    if (img.livePhoto && img.livePhoto_width && img.livePhoto_height) {
      livePhotos.push({
        kind: "livePhoto", sourceUrl: img.url_default || "",
        width: img.livePhoto_width || null, height: img.livePhoto_height || null,
        source: "api:feed", imageIndex: (img.image_index || 0) + 1,
        fileId: img.trace_id || "", traceId: img.trace_id || "",
      });
    }
  }

  const author = noteCard.user || item.user || {};
  const tagList = noteCard.tag_list || [];

  return {
    sourceUrl: sourceUrl || `https://www.xiaohongshu.com/explore/${noteCard.note_id}`,
    noteId: noteCard.note_id || "",
    title: noteCard.title || noteCard.display_title || "",
    description: noteCard.desc || noteCard.display_desc || "",
    authorName: author.nickname || author.user_name || "",
    authorId: author.user_id || "",
    contentType: video ? "视频笔记" : (livePhotos.length ? "Live图文" : "图文笔记"),
    tags: (noteCard.tag_list || []).map(t => t.name || t.tag_name || "").filter(Boolean),
    publishedAt: noteCard.time || noteCard.create_time || "",
    assets: [...images, ...videos, ...livePhotos],
    metrics: {
      likedCount: noteCard.liked_count || noteCard.interact_info?.liked_count || 0,
      commentCount: noteCard.comment_count || noteCard.interact_info?.comment_count || 0,
      collectedCount: noteCard.collected_count || noteCard.interact_info?.collected_count || 0,
      shareCount: noteCard.shared_count || noteCard.interact_info?.shared_count || 0,
    },
    status: "已入库",
    raw: { source: "api:feed", apiData },
  };
}

/** 将 edith API 的 user_posted 响应转成笔记列表 */
function apiItemsToNotes(apiData, authorName = "") {
  if (!apiData?.data?.items) return { notes: [], cursor: apiData.data?.cursor || "" };
  const items = apiData.data.items;
  const notes = items.map((item) => {
    const note = apiNoteToNote({ items: [item] });
    if (note && authorName) note.authorName = authorName;
    return note;
  }).filter(Boolean);
  return { notes, cursor: apiData.data.cursor || "" };
}

// ---- 业务集成函数（供 xhsCrawler 调用） ----

/**
 * 通过 xhshow API 采集笔记详情
 * 返回格式与 fetchNoteViaHttp 兼容（notes 数组）
 */
export async function crawlNoteViaApi(sourceNoteId, sourceUrl = "", rootDir = "") {
  const cookie = readApiCookie(rootDir || process.cwd());
  if (!cookie) return null;
  const xsecToken = sourceUrl?.match(/xsec_token=([^&]+)/)?.[1] || "";
  try {
    const result = await fetchNoteFeed(sourceNoteId, cookie, xsecToken);
    if (!result.success) return null;
    const note = apiNoteToNote(result, sourceUrl);
    return note ? [note] : null;
  } catch (e) {
    console.warn("[crawlNoteViaApi] 失败:", e.message);
    return null;
  }
}

/**
 * 通过 xhshow API 获取用户笔记列表
 * 返回格式与 followAccount 兼容
 */
export async function fetchUserNotesViaApi(userId, cursor = "", rootDir = "") {
  const cookie = readApiCookie(rootDir || process.cwd());
  if (!cookie) return null;
  try {
    const result = await fetchUserPosted(userId, cursor, 50, cookie);
    if (!result.success) {
      console.warn(`[fetchUserNotesViaApi] API 返回失败:`, result.msg || result.code);
      return null;
    }
    const items = result.data?.items || [];
    if (!items.length) {
      console.log(`[fetchUserNotesViaApi] 无更多笔记 (cursor=${cursor})`);
      return { notes: [], cursor: "" };
    }
    const notes = apiItemsToNotes(result).notes;
    console.log(`[fetchUserNotesViaApi] 获取 ${items.length} 条 (cursor=${cursor || "初始"} → ${result.data?.cursor?.slice(0, 20) || "无"})`);
    return { notes, cursor: result.data.cursor || "" };
  } catch (e) {
    console.warn("[fetchUserNotesViaApi] 失败:", e.message);
    return null;
  }
}

/**
 * 通过 xhshow API 搜索
 */
export async function searchViaApi(keyword, cursor = "", rootDir = "") {
  const cookie = readApiCookie(rootDir || process.cwd());
  if (!cookie) return null;
  try {
    const result = await searchNotes(keyword, cursor, 20, "general", 0, cookie);
    if (!result.success) return null;
    const items = result.data?.items || [];
    if (!items.length) return { items: [], cursor: "" };
    return { items, cursor: result.data.cursor || "" };
  } catch (e) {
    console.warn("[searchViaApi] 失败:", e.message);
    return null;
  }
}
