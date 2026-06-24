// 小红书 API 签名与 HTTP 请求客户端
// 通过 Python signserver 获取签名 headers，然后直调 edith.xiaohongshu.com API

import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";

let _pythonPath = "";

const SIGN_PORT = 9223;
let _signServer = null;

// API 基地址
const API_BASE = "https://edith.xiaohongshu.com";

function extractCookies(cookieStr) {
  if (!cookieStr) return {};
  const c = {};
  cookieStr.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) c[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  // xhshow 签名需要 a1
  if (!c.a1) console.warn("[xhsApi] 无 a1 cookie，签名可能失败");
  return c;
}

// 查找 Python 路径
function findPython() {
  if (_pythonPath) return _pythonPath;
  try {
    _pythonPath = execSync("where python", { encoding: "utf8" }).split("\n")[0].trim();
  } catch {
    const candidates = [
      "C:\\Users\\Ayuan\\AppData\\Local\\Programs\\Python\\Python313\\python.exe",
      "C:\\Python313\\python.exe",
      "C:\\Python3\\python.exe",
      "/usr/bin/python3",
      "/usr/local/bin/python3",
    ];
    _pythonPath = candidates.find((p) => existsSync(p)) || "python";
  }
  return _pythonPath;
}

// 启动 Python 签名服务
export async function startSignServer(rootDir) {
  if (_signServer) return;
  const scriptPath = path.join(rootDir, "src", "signserver", "server.py");
  if (!existsSync(scriptPath)) throw new Error(`signserver.py 未找到: ${scriptPath}`);
  const pythonExe = findPython();
  _signServer = spawn(pythonExe, ["-u", scriptPath, String(SIGN_PORT)], {
    cwd: path.join(rootDir, "src"),
    stdio: ["ignore", "pipe", "pipe"],
  });
  _signServer.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) console.log("[signserver]", msg);
  });
  _signServer.on("exit", (code) => { _signServer = null; if (code) console.warn(`[signserver] exited ${code}`); });
  // 等待就绪
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://127.0.0.1:${SIGN_PORT}/status`, { method: "GET" });
      if (r.ok) { console.log("[signserver] ready"); return; }
    } catch {}
  }
  throw new Error("signserver 启动超时");
}

export function stopSignServer() {
  if (_signServer) { try { _signServer.kill(); } catch {} _signServer = null; }
}

// 获取签名 headers（调用 Python 服务）
async function signHeaders(uri, cookies, method = "get", params = {}, payload = {}, xRap = false) {
  const body = { uri, cookies: extractCookies(cookies), method, params, payload, x_rap: xRap };
  const resp = await fetch(`http://127.0.0.1:${SIGN_PORT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await resp.json();
  if (!result.ok) throw new Error(`Sign error: ${result.error}`);
  return result.headers;
}

// ---- API 请求封装 ----

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

// ---- 小红书业务接口 ----

/** 用户笔记列表 */
export async function fetchUserPosted(userId, cursor = "", num = 30, cookieStr = "") {
  return apiGet("/api/sns/web/v1/user_posted", cookieStr, { user_id: userId, cursor, num }, true);
}

/** 笔记详情（feed） */
export async function fetchNoteFeed(sourceNoteId, cookieStr = "", xsecToken = "") {
  const payload = { source_note_id: sourceNoteId };
  if (xsecToken) payload.xsec_token = xsecToken;
  // xsec_token 可能在 url 中需要额外处理
  return apiPost("/api/sns/web/v1/feed", cookieStr, payload, true);
}

/** 搜索 */
export async function searchNotes(keyword, cursor = "", pageSize = 20, sort = "general", noteType = 0, cookieStr = "") {
  return apiPost("/api/sns/web/v1/search/notes", cookieStr, {
    keyword, cursor, page_size: pageSize, sort, note_type: noteType,
  }, true);
}

/** 评论 */
export async function fetchComments(noteId, cursor = "", topCommentId = "", imageFormats = "jpg,webp,avif", cookieStr = "") {
  return apiGet("/api/sns/web/v2/comment/page", cookieStr, {
    note_id: noteId, cursor, top_comment_id: topCommentId, image_formats: imageFormats,
  }, true);
}

/** 用户信息 */
export async function fetchUserInfo(userId, cookieStr = "") {
  return apiPost("/api/sns/web/v1/user/selfinfo", cookieStr, { user_id: userId });
}
