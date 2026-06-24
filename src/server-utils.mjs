import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseBool, envWithSettings } from "./settings.mjs";
import { extractXhsUrls } from "./xhsSdk.mjs";
import { crawlXhs } from "./xhsCrawler.mjs";
import { persistNoteAssets } from "./downloader.mjs";

export function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

export async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      const error = new Error("请求体超过 2MB 限制");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

export function serveFile(res, filePath) {
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }
  const stat = statSync(filePath);
  const fileSize = stat.size;
  const mimeType = contentType(filePath);
  const range = res.req?.headers?.range || "";

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const requestedEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const end = Math.min(requestedEnd, fileSize - 1);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= fileSize) {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      res.end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": mimeType,
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      "Content-Length": fileSize,
    });
    createReadStream(filePath).pipe(res);
  }
}

export async function crawlAndStore(body, { rootDir, storage, apiMode = false } = {}) {
  const inputText = body.url || body.shareText || "";
  const parsedUrls = extractXhsUrls(inputText);
  if (!parsedUrls.length) {
    const error = new Error("请粘贴小红书笔记链接、账号链接，或包含小红书链接的分享文本");
    error.statusCode = 400;
    throw error;
  }

  const download = parseBool(body.download, true);
  const skip = parseBool(body.skip, false);
  const savedNotes = [];
  const skipped = [];
  const jobs = [];

  for (const parsedUrl of parsedUrls) {
    const existing = storage.findNoteBySourceUrl(parsedUrl);
    if (existing && skip) {
      skipped.push(existing);
      continue;
    }

    const jobId = storage.createJob(parsedUrl);
    jobs.push(jobId);
    try {
      const settings = envWithSettings(rootDir);
      const cdpPort = settings.xhs.cdpPort || 0;
      const notes = await crawlXhs(
        {
          url: parsedUrl,
          originalInput: inputText,
          accountId: body.accountId || null,
          brand: body.brand || "",
          tags: body.tags || [],
          index: body.index || [],
          cookie: body.cookie || ""
        },
        { rootDir, maxNotes: body.maxNotes, cookie: body.cookie || "", proxy: body.proxy || "", cdpPort }
      );

      for (const note of notes) {
        const savedNote = storage.upsertNote(note);
        if (download) {
          const assets = await persistNoteAssets(rootDir, { ...note, id: savedNote.id, collectedAt: savedNote.collectedAt });
          storage.addAssets(savedNote.id, assets);
        } else {
          storage.addAssets(savedNote.id, note.assets || []);
        }
        savedNotes.push(storage.getNote(savedNote.id));
      }
      storage.updateJob(jobId, { status: "成功", message: "采集完成", resultCount: notes.length });
    } catch (error) {
      storage.updateJob(jobId, { status: "失败", message: error.message, resultCount: 0 });
      if (apiMode) throw error;
      savedNotes.push(storage.upsertNote({
        sourceUrl: parsedUrl, brand: body.brand || "", tags: body.tags || [],
        status: "失败", reviewReason: error.message, assets: []
      }));
    }
  }

  return { jobs, inputUrls: parsedUrls, notes: savedNotes, skipped };
}

// ---- Simple in-memory cache ----
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

export function setCached(key, data) {
  cache.set(key, { data, time: Date.now() });
}

export function clearCache() {
  cache.clear();
}

export function clearCacheByPrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export async function diagnose(rootDir, storage) {
  const result = { timestamp: new Date().toISOString(), channels: {}, captchaDetected: false, suggestions: [] };

  // 1. Cookie
  const { readXhsCookie, checkCookieValid, decryptCookie } = await import("./xhsAuth.mjs");
  const cookieRaw = readXhsCookie(rootDir);
  if (!cookieRaw) {
    result.channels.cookie = { status: "not_found", detail: "未找到 Cookie 文件", suggestion: "请通过「账号管理」扫码登录或粘贴 Cookie" };
    result.suggestions.push("未找到小红书 Cookie，请先绑定账号。");
  } else {
    const check = await checkCookieValid(rootDir, cookieRaw);
    const fields = cookieRaw.split(";").filter(s => s.includes("=")).length;
    result.channels.cookie = {
      status: check.valid ? "ok" : "invalid",
      detail: check.valid ? `有效，${fields} 个字段${check.nickname ? "，用户：" + check.nickname : ""}` : `无效：${check.reason}`,
      suggestion: check.valid ? "" : "Cookie 已过期，请重新扫码登录",
      nickname: check.nickname || "",
      fields
    };
    if (!check.valid) result.suggestions.push(`Cookie 无效（${check.reason}），请重新扫码登录。`);
  }

  // 2. HTTP 快速路径检测
  try {
    const resp = await fetch("https://www.xiaohongshu.com/explore", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Cookie: cookieRaw || "",
        Accept: "text/html",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const location = resp.headers.get("location") || "";
    const isCaptcha = (resp.status === 301 || resp.status === 302) && location.includes("captcha");
    const isLogin = (resp.status === 301 || resp.status === 302) && location.includes("login");
    const isBlocked = resp.status === 200 && (await resp.text()).includes("安全限制");

    result.channels.http_fast_path = {
      status: isCaptcha ? "blocked" : isLogin ? "login_required" : isBlocked ? "blocked" : resp.status === 200 ? "ok" : "unknown",
      detail: isCaptcha ? "被风控拦截（重定向到验证码页）" : isLogin ? "被重定向到登录页" : isBlocked ? "返回安全限制页面" : resp.status === 200 ? "正常" : `HTTP ${resp.status}`,
      suggestion: isCaptcha ? "更换 IP 或使用有头浏览器模式" : isLogin ? "Cookie 需要登录态" : isBlocked ? "IP 被限制，请切换网络" : ""
    };
    if (isCaptcha || isBlocked) {
      result.captchaDetected = true;
      result.suggestions.push("当前网络环境被小红书风控拦截。请停止自动采集，稍后重试；如页面要求真人验证，请在正常登录的浏览器中自行完成后再继续。");
    }
  } catch (e) {
    result.channels.http_fast_path = { status: "error", detail: e.message, suggestion: "网络不可达，请检查网络连接" };
  }

  // 3. Playwright
  try {
    const { getPlaywright } = await import("./xhsSdk.mjs");
    const pw = await getPlaywright();
    const { chromium } = pw;
    const exePath = chromium.executablePath();
    const hasBundled = existsSync(exePath);
    let browserName = hasBundled ? "bundled" : "";
    if (!hasBundled) {
      const s = envWithSettings(rootDir);
      browserName = s.xhs.browserExecutable || "自动查找";
    }
    result.channels.playwright = {
      status: "ok",
      detail: `Playwright ${hasBundled ? "自带 Chromium" : "使用系统浏览器：" + browserName}`,
      suggestion: ""
    };
  } catch (e) {
    result.channels.playwright = { status: "error", detail: e.message, suggestion: "请运行 npm install 安装 Playwright" };
  }

  // 4. 汇总统计
  const okCount = Object.values(result.channels).filter(c => c.status === "ok").length;
  const totalCount = Object.keys(result.channels).length;
  result.summary = `${okCount}/${totalCount} 通道可用`;

  // 5. 统一建议
  if (result.channels.cookie?.status === "ok" && result.channels.http_fast_path?.status === "ok") {
    result.suggestions.push("HTTP 快速路径正常，采集速度最快。");
  }

  return result;
}
