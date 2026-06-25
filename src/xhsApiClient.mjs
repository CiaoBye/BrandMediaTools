import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { HttpsProxyAgent } from "https-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import { decryptCookie } from "./xhsAuth.mjs";
import { envWithSettings } from "./settings.mjs";
import { getLogger } from "./logger.mjs";

let _pythonPath = "";
let _cookieCache = "";
let _rateLimitLast = 0;

function log(level, msg, data) {
  try { const l = getLogger(); if (l) l[level]("[xhshow] " + msg, data); } catch {}
  if (level === "warn" || level === "error") console.warn("[xhsApi]", msg);
}

const SIGN_PORT = 9223;
let _signServer = null;
const API_BASE = "https://edith.xiaohongshu.com";

// ---- Cookie 管理 ----

export function readApiCookie(rootDir) {
  if (_cookieCache) return _cookieCache;
  try {
    const dbPath = path.join(rootDir || process.cwd(), "data", "app.db");
    if (existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath);
      const rows = db.prepare("SELECT cookie_encrypted, last_check_at FROM xhs_accounts WHERE status = '有效' ORDER BY last_check_at DESC").all();
      db.close();
      for (const row of rows) {
        if (row && row.cookie_encrypted) {
          const decrypted = decryptCookie(row.cookie_encrypted, rootDir || process.cwd());
          if (decrypted && decrypted.length > 50 && decrypted.includes("a1=")) {
            _cookieCache = decrypted;
            return _cookieCache;
          }
        }
      }
    }
  } catch {}
  const filePath = path.join(rootDir || process.cwd(), "data", "xhs-cookie.txt");
  if (existsSync(filePath)) {
    _cookieCache = readFileSync(filePath, "utf8").trim();
    if (_cookieCache) log("info", `已加载 Cookie (${_cookieCache.split(";").length} 个字段)`);
  }
  return _cookieCache;
}

export function clearCookieCache() { _cookieCache = ""; }

export function setApiCookie(cookie) {
  _cookieCache = cookie ? cookie.trim() : "";
}

function extractCookies(cookieStr) {
  if (!cookieStr) return {};
  const c = {};
  cookieStr.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) c[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  if (!c.a1) log("warn", "Cookie 中无 a1 字段");
  return c;
}

// ---- 速率限制 ----

async function rateLimit() {
  const minGap = 3000; // 每条请求至少间隔 3 秒
  const now = Date.now();
  const wait = minGap - (now - _rateLimitLast);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _rateLimitLast = Date.now();
}

// ---- 代理 ----

function createProxyAgent(urlStr) {
  const rootDir = process.cwd();
  const settings = envWithSettings(rootDir);
  const proxyUrl = settings.xhs?.proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  if (!proxyUrl) return null;
  const isHttps = urlStr.startsWith("https");
  try {
    return isHttps ? new HttpsProxyAgent(proxyUrl) : new HttpProxyAgent(proxyUrl);
  } catch {
    log("warn", `代理创建失败: ${proxyUrl}`);
    return null;
  }
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
    if (msg) log("info", msg);
  });
  _signServer.on("exit", (code) => { _signServer = null; if (code) log("warn", `signserver exited ${code}`); });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://127.0.0.1:${SIGN_PORT}/status`);
      if (r.ok) { log("info", "signserver ready"); return; }
    } catch {}
  }
  throw new Error("signserver 启动超时");
}

export function stopSignServer() {
  if (_signServer) { try { _signServer.kill(); } catch {} _signServer = null; }
}

// ---- 签名与请求（含重试 + 代理） ----

async function signHeaders(uri, cookies, method = "get", params = {}, payload = {}, xRap = false, signFormat = "xyw") {
  const body = { uri, cookies: extractCookies(cookies), method, params, payload, x_rap: xRap, sign_format: signFormat };
  const resp = await fetch(`http://127.0.0.1:${SIGN_PORT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await resp.json();
  if (!result.ok) throw new Error(`签名失败: ${result.error}`);
  return result.headers;
}

async function proxiedFetch(url, options = {}, retries = 3) {
  const agent = createProxyAgent(url);
  if (agent) options.dispatcher = agent;

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await rateLimit();
      const resp = await fetch(url, options);
      // 461 = 风控拦截，不重试
      if (resp.status === 461) {
        const body = await resp.text().catch(() => "");
        log("error", `风控拦截 461: ${url.slice(0, 60)} — ${body.slice(0, 100)}`);
        return { status: 461, ok: false, data: null, body };
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        log("warn", `请求失败 (${attempt}/${retries}): ${err.message?.slice(0, 60)}, ${delay}ms 后重试`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export async function apiGet(apiPath, cookieStr, params = {}, xRap = false, signFormat = "xyw") {
  const headers = await signHeaders(apiPath, cookieStr, "get", params, {}, xRap, signFormat);
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${apiPath}${qs ? "?" + qs : ""}`;
  const resp = await proxiedFetch(url, {
    headers: { ...headers, Cookie: cookieStr, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36", "Content-Type": "application/json" },
  });
  if (resp.status === 461) return { success: false, code: 461, msg: "风控拦截" };
  return resp.json();
}

export async function apiPost(apiPath, cookieStr, payload = {}, xRap = false, signFormat = "xyw") {
  const headers = await signHeaders(apiPath, cookieStr, "post", {}, payload, xRap, signFormat);
  const url = `${API_BASE}${apiPath}`;
  const resp = await proxiedFetch(url, {
    method: "POST",
    headers: { ...headers, Cookie: cookieStr, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (resp.status === 461) return { success: false, code: 461, msg: "风控拦截" };
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

function apiNoteToNote(apiData, sourceUrl = "") {
  if (!apiData) return null;
  const items = apiData.items || (apiData.data?.items) || [];
  if (!items.length) return null;
  const item = items[0];
  const noteCard = item.note_card || item;
  const imageList = noteCard.image_list || noteCard.cover?.image_list || [];
  const video = noteCard.video || noteCard.media?.video || null;

  const images = imageList.map((img, i) => ({
    kind: "image", sourceUrl: img.info_list?.[0]?.image_scene?.url || img.url_default || "",
    url: img.info_list?.[0]?.image_scene?.url || img.url_default || "",
    width: img.width || null, height: img.height || null,
    watermarkStatus: "未知", source: "api:feed", imageIndex: i + 1,
    fileId: img.trace_id || "", traceId: img.trace_id || "",
  }));

  const videos = video ? [{
    kind: "video", sourceUrl: video.media?.stream?.master_url || video.media?.stream?.[0]?.master_url || "",
    url: video.media?.stream?.master_url || video.media?.stream?.[0]?.master_url || "",
    width: video.width || null, height: video.height || null,
    fileSize: video.media?.size || null, bitrate: video.media?.bitrate || null,
    watermarkStatus: video.media?.watermark ? "有水印" : "无水印",
    source: "api:feed", fileId: video.trace_id || "", traceId: video.trace_id || "",
  }] : [];

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

  return {
    sourceUrl: sourceUrl || `https://www.xiaohongshu.com/explore/${noteCard.note_id}`,
    noteId: noteCard.note_id || "",
    title: noteCard.title || noteCard.display_title || "",
    description: noteCard.desc || noteCard.display_desc || "",
    authorName: author.nickname || author.user_name || "",
    authorId: author.user_id || "",
    authorAvatar: author.avatar || author.avatarUrl || author.image || "",
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

// ---- 业务集成函数 ----

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
    log("warn", `crawlNoteViaApi 失败: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

export async function fetchUserNotesViaApi(userId, cursor = "", rootDir = "") {
  const cookie = readApiCookie(rootDir || process.cwd());
  if (!cookie) return null;
  try {
    const result = await fetchUserPosted(userId, cursor, 50, cookie);
    if (!result.success) {
      log("warn", `用户笔记列表失败: ${result.msg || result.code}`);
      return null;
    }
    const items = result.data?.items || [];
    if (!items.length) {
      log("info", `用户笔记列表: 无更多笔记`);
      return { notes: [], cursor: "" };
    }
    const notes = apiItemsToNotes(result).notes;
    log("info", `用户笔记列表: ${items.length} 条`);
    return { notes, cursor: result.data.cursor || "" };
  } catch (e) {
    log("warn", `用户笔记列表失败: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

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
    log("warn", `searchViaApi 失败: ${e.message?.slice(0, 80)}`);
    return null;
  }
}
