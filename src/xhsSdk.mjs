import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { cookieStringToPlaywrightCookies, readXhsCookie } from "./xhsAuth.mjs";
import { envWithSettings } from "./settings.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 全局日志（所有 crawler 模块共用）
let _logger = null;
export function setCrawlerLogger(l) { _logger = l; }
export function log(level, msg, data) {
  try { if (_logger) _logger[level]("[crawler] " + msg, data); } catch {}
}

export function normalizeUrl(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&")
    .trim();
}

export function extractXhsUrl(input) {
  return extractXhsUrls(input)[0] || "";
}

export function extractXhsUrls(input) {
  const text = normalizeUrl(input);
  const matches = Array.from(text.matchAll(/https?:\/\/(?:(?:www\.)?xiaohongshu\.com|xhslink\.com)\/[^\s，,。]+/gi));
  const urls = [];
  const seen = new Set();
  for (const match of matches) {
    let value = match[0];
    try {
      value = new URL(value).toString();
    } catch {}
    if (!seen.has(value)) {
      seen.add(value);
      urls.push(value);
    }
  }
  return urls;
}

export function extractXhsId(inputUrl) {
  const url = extractXhsUrl(inputUrl) || inputUrl;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const itemIndex = parts.findIndex((part) => part === "item");
    if (itemIndex >= 0 && parts[itemIndex + 1]) return parts[itemIndex + 1];
    const exploreIndex = parts.findIndex((part) => part === "explore");
    if (exploreIndex >= 0 && parts[exploreIndex + 1]) return parts[exploreIndex + 1];
    if (parts[0] === "user" && parts[1] === "profile") {
      return parts[3] || parts[2] || "";
    }
  } catch {}
  return "";
}

function decodeLoose(value) {
  let text = normalizeUrl(value);
  text = text
    .replaceAll("\\u0026", "&")
    .replaceAll("\\u003D", "=")
    .replaceAll("\\u003d", "=");
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function cleanAssetUrl(url) {
  let value = decodeLoose(url)
    .replaceAll("&quot;", "")
    .replaceAll("&quot", "")
    .replaceAll("&#34;", "")
    .replaceAll("\\", "")
    .replace(/[)\]}；;，,。]+$/g, "");
  value = value.split(";background")[0];
  value = value.split(");background")[0];
  value = value.split("%3Bbackground")[0];
  value = value.replace(/[?&]x-oss-process=image\/[^&]*/gi, "").replace(/[?&]imageView2[^&]*/gi, "");
  value = value.replace(/([?&])&+/g, "$1").replace(/[?&]$/, "");
  return value;
}

export function watermarkStatus(url) {
  const lower = url.toLowerCase();
  if (lower.includes("watermark") || lower.includes("wm_") || lower.includes("/wm/") || lower.includes("water_mask") || lower.includes("wm=")) return "疑似带水印";
  if (lower.includes("sns-webpic") || lower.includes("xhscdn") || lower.includes("sns-img") || lower.includes("ci.xiaohongshu.com")) return "原始候选";
  return "未知";
}

export function classifyUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes("livephoto") || lower.includes("live_photo") || lower.includes("/live/")) return "livePhoto";
  if (/\.(mp4|mov|m4v)(\?|$)/.test(lower) || lower.includes(".m3u8") || lower.includes("sns-video") || lower.includes("/video/")) return "video";
  if (/\.(jpg|jpeg|png|webp|avif|heic)(\?|$)/.test(lower) || lower.includes("image") || lower.includes("sns-img") || lower.includes("sns-webpic")) return "image";
  return "unknown";
}

export function isAccountUrl(url) {
  return /xiaohongshu\.com\/user\/profile\//.test(url);
}

export function isXhsNoteUrl(url) {
  return Boolean(normalizeXhsNoteUrl(url));
}

export function normalizeXhsNoteUrl(url) {
  const cleaned = normalizeUrl(url);
  try {
    const parsed = new URL(cleaned, "https://www.xiaohongshu.com");
    if (!/xiaohongshu\.com$/i.test(parsed.hostname)) return "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    let noteId = "";
    if (parts[0] === "explore" && parts[1]) noteId = parts[1];
    if (parts[0] === "discovery" && parts[1] === "item" && parts[2]) noteId = parts[2];
    if (parts[0] === "user" && parts[1] === "profile" && parts[3]) noteId = parts[3];
    if (!noteId || noteId.length < 12) return "";
    const output = new URL(`https://www.xiaohongshu.com/explore/${noteId}`);
    for (const key of ["xsec_token", "xsec_source", "source", "xhsshare"]) {
      const value = parsed.searchParams.get(key);
      if (value) output.searchParams.set(key, value);
    }
    return output.toString();
  } catch {
    return "";
  }
}

export function scoreXhsNoteUrl(url) {
  let score = 0;
  if (url.includes("xsec_token=")) score += 100;
  if (url.includes("xsec_source=")) score += 10;
  if (url.includes("source=")) score += 2;
  if (url.startsWith("https://")) score += 1;
  return score;
}

export function randomDelay(min = 800, max = 2500) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}

export function mergeXhsLinks(inputUrls = [], extractedLinks = []) {
  const byNoteId = new Map();
  const looseLinks = [];
  for (const url of [...inputUrls.filter((item) => isXhsNoteUrl(item)), ...extractedLinks]) {
    const noteId = extractXhsId(url);
    if (!noteId) {
      if (!looseLinks.includes(url)) looseLinks.push(url);
      continue;
    }
    const existing = byNoteId.get(noteId);
    if (!existing || scoreXhsNoteUrl(url) > scoreXhsNoteUrl(existing)) {
      byNoteId.set(noteId, url);
    }
  }
  return [...byNoteId.values(), ...looseLinks];
}

export function scoreVideo(asset, preference = "resolution") {
  const url = asset.url.toLowerCase();
  const protocol = url.startsWith("https://") ? 1000 : 0;
  const primaryHost = url.includes("sns-video") ? 500 : 0;
  const wmPenalty = url.includes("watermark") || url.includes("wm_") || url.includes("/wm/") ? -100000 : 0;
  // Codec-aware weights: prefer modern codecs for better quality-per-bit
  const codecStr = (asset.codec || "").toLowerCase() + " " + url;
  let codecBonus = 0;
  if (/av1/i.test(codecStr)) codecBonus = 8000;
  else if (/h265|hevc|hev1/i.test(codecStr)) codecBonus = 5000;
  if (preference === "bitrate") {
    const bitrate = asset.bitrate || Number(url.match(/bitrate[=_/](\d+)/i)?.[1] || 0);
    return bitrate + protocol + primaryHost + wmPenalty + codecBonus;
  }
  if (preference === "size") {
    const fileSize = asset.fileSize || 0;
    return (fileSize > 0 ? -fileSize : 0) + protocol + wmPenalty + codecBonus;
  }
  const area = (asset.width || 0) * (asset.height || 0);
  const quality = /1080|1920|2160|4k|uhd/.test(url) ? 10000000 : 0;
  const bitrate = Math.min(asset.bitrate || 0, 9999);
  return area + quality + bitrate + protocol + primaryHost + wmPenalty + codecBonus;
}

function videoIdentity(url) {
  try {
    const parsed = new URL(cleanAssetUrl(url));
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = pathParts.at(-1) || parsed.pathname;
    const fileId = lastPart.replace(/\.(mp4|mov|m4v)$/i, "");
    const ids = [
      parsed.searchParams.get("filename"),
      parsed.searchParams.get("sign"),
      fileId
    ].filter(Boolean);
    return ids.join("|").replace(/^http:\/\//, "https://");
  } catch {
    return cleanAssetUrl(url).replace(/^http:\/\//, "https://").split("?")[0];
  }
}

export function dedupeVideos(videos, preference = "resolution") {
  const byId = new Map();
  for (const video of videos) {
    const id = videoIdentity(video.url);
    const existing = byId.get(id);
    if (!existing || scoreVideo(video, preference) > scoreVideo(existing, preference)) {
      byId.set(id, video);
    }
  }
  return Array.from(byId.values()).sort((a, b) => scoreVideo(b, preference) - scoreVideo(a, preference));
}

export function bestImageUrl(image) {
  if (!image || typeof image !== "object") return "";
  const candidates = [];
  if (image.urlDefault) candidates.push({ url: image.urlDefault, w: image.width || 0, h: image.height || 0 });
  if (image.urlPre) candidates.push({ url: image.urlPre, w: image.width || 0, h: image.height || 0 });
  if (image.url_pre) candidates.push({ url: image.url_pre, w: image.width || 0, h: image.height || 0 });
  if (image.url) candidates.push({ url: image.url, w: image.width || 0, h: image.height || 0 });
  const infoList = Array.isArray(image.infoList) ? image.infoList : Array.isArray(image.info_list) ? image.info_list : [];
  // Filter out thumbnail scenes (WB_PRV = preview, CRD_PRV = card preview)
  const thumbScenes = new Set(["WB_PRV", "CRD_PRV"]);
  const preferScenes = new Set(["WB_DFT", "WB_SEL"]);
  for (const item of infoList) {
    if (!item?.url) continue;
    const scene = item.imageScene || item.image_scene || "";
    if (thumbScenes.has(scene)) continue; // skip thumbnails
    const sceneBonus = preferScenes.has(scene) ? 1 : 0;
    candidates.push({ url: item.url, w: item.width || 0, h: item.height || 0, sceneBonus });
  }
  if (!candidates.length) return "";
  candidates.sort((a, b) => {
    // Preferred scenes first
    const sA = a.sceneBonus || 0;
    const sB = b.sceneBonus || 0;
    if (sA !== sB) return sB - sA;
    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    if (areaA !== areaB) return areaB - areaA;
    const wmA = watermarkStatus(a.url) === "原始候选" ? 1 : 0;
    const wmB = watermarkStatus(b.url) === "原始候选" ? 1 : 0;
    return wmB - wmA;
  });
  return candidates[0].url;
}

export function bestStreamUrl(stream) {
  if (!stream || typeof stream !== "object") return "";
  const codecOrder = ["h264", "h265", "h266", "av1"];
  for (const codec of codecOrder) {
    const variants = Array.isArray(stream[codec]) ? stream[codec] : [];
    for (const variant of variants) {
      if (variant?.masterUrl) return variant.masterUrl;
      if (Array.isArray(variant?.backupUrls) && variant.backupUrls[0]) return variant.backupUrls[0];
    }
  }
  return "";
}

/**
 * Return ordered list of image URL candidates (instead of single best).
 * Each candidate includes original URL and CDN token direct link.
 * @param {object} image - Image object from __INITIAL_STATE__
 * @returns {Array<{url:string, cdnUrl:string, width:number, height:number, source:string, priority:number, watermarkStatus:string}>}
 */
export function bestImageUrls(image) {
  if (!image || typeof image !== "object") return [];
  const candidates = [];

  if (image.urlDefault) candidates.push({ url: image.urlDefault, w: image.width || 0, h: image.height || 0, priority: 0, source: "urlDefault" });

  const infoList = Array.isArray(image.infoList) ? image.infoList : Array.isArray(image.info_list) ? image.info_list : [];
  const thumbScenes = new Set(["WB_PRV", "CRD_PRV"]);
  const preferScenes = new Set(["WB_DFT", "WB_SEL"]);

  for (const item of infoList) {
    if (!item?.url) continue;
    const scene = item.imageScene || item.image_scene || "";
    if (thumbScenes.has(scene)) continue;
    const scenePriority = preferScenes.has(scene) ? -1 : 1;
    candidates.push({ url: item.url, w: item.width || 0, h: item.height || 0, priority: scenePriority, source: "infoList:" + (scene || "unknown") });
  }

  if (image.urlPre) candidates.push({ url: image.urlPre, w: image.width || 0, h: image.height || 0, priority: 2, source: "urlPre" });
  if (image.url_pre) candidates.push({ url: image.url_pre, w: image.width || 0, h: image.height || 0, priority: 2, source: "url_pre" });
  if (image.url) candidates.push({ url: image.url, w: image.width || 0, h: image.height || 0, priority: 3, source: "url" });

  if (!candidates.length) return [];

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    if (areaA !== areaB) return areaB - areaA;
    const wmA = watermarkStatus(a.url) === "原始候选" ? 0 : 1;
    const wmB = watermarkStatus(b.url) === "原始候选" ? 0 : 1;
    return wmA - wmB;
  });

  return candidates.map(c => {
    const token = extractImageToken(c.url);
    const cdnUrl = token ? buildCdnImageUrl(token) : "";
    return {
      url: c.url,
      cdnUrl,
      width: c.w,
      height: c.h,
      source: c.source,
      priority: c.priority,
      watermarkStatus: watermarkStatus(c.url)
    };
  }).filter(c => c.url);
}

/**
 * Return full codec x resolution video stream matrix.
 * Extracts all available encoding variants with fallback URLs.
 * @param {object} stream - Video stream object
 * @returns {Array<{codec:string, masterUrl:string, backupUrls:string[], url:string, width:number, height:number, resolution:string, bitrate:number, fileSize:number, fileId:string, traceId:string, watermarkStatus:string}>}
 */
export function bestVideoStreams(stream) {
  if (!stream || typeof stream !== "object") return [];
  const variants = [];
  const codecOrder = ["h264", "h265", "h266", "av1"];

  for (const codec of codecOrder) {
    const codecVariants = Array.isArray(stream[codec]) ? stream[codec] : [];
    for (const variant of codecVariants) {
      if (!variant) continue;
      const masterUrl = cleanAssetUrl(variant.masterUrl || variant.master_url || "");
      const backupUrls = Array.isArray(variant.backupUrls) ? variant.backupUrls.map(v => cleanAssetUrl(v)).filter(Boolean) :
                         Array.isArray(variant.backup_urls) ? variant.backup_urls.map(v => cleanAssetUrl(v)).filter(Boolean) : [];
      if (!masterUrl && !backupUrls.length) continue;
      const w = variant.width || variant.resolution?.width || null;
      const h = variant.height || variant.resolution?.height || null;
      variants.push({
        codec,
        masterUrl,
        backupUrls,
        url: masterUrl || backupUrls[0] || "",
        width: w,
        height: h,
        resolution: w && h ? w + "x" + h : "",
        bitrate: variant.bitrate || variant.videoBitrate || variant.bitRate || variant.bit_rate || null,
        fileSize: variant.fileSize || variant.size || variant.file_size || null,
        fileId: variant.fileId || "",
        traceId: variant.traceId || "",
        watermarkStatus: watermarkStatus(masterUrl || backupUrls[0] || ""),
      });
    }
  }
  return variants;
}

export function normalizeStructuredAssets(noteData) {
  const assets = [];
  const imageList = Array.isArray(noteData?.imageList) ? noteData.imageList : [];
  for (let index = 0; index < imageList.length; index += 1) {
    const image = imageList[index];
    const imageUrl = cleanAssetUrl(bestImageUrl(image));
    const base = {
      width: image.width || null,
      height: image.height || null,
      imageIndex: index + 1,
      livePhoto: Boolean(image.livePhoto),
      fileId: image.fileId || "",
      traceId: image.traceId || ""
    };
    if (imageUrl) {
      assets.push({ ...base, kind: "image", url: imageUrl, source: "initial-state:imageList" });
    }
    if (image.livePhoto) {
      const streamUrl = cleanAssetUrl(bestStreamUrl(image.stream));
      if (streamUrl) {
        assets.push({ ...base, kind: "livePhoto", url: streamUrl, source: "initial-state:imageList.stream", pairedImageIndex: index + 1 });
      }
    }
  }
  return assets;
}

export function isLoginPage(extracted) {
  const text = `${extracted.title || ""}\n${extracted.bodyText || ""}`;
  return /手机号登录|验证码登录|登录小红书|其他登录方式|请输入手机号/.test(text);
}

export function isBlockedPage(extracted) {
  const text = `${extracted.title || ""}\n${extracted.bodyText || ""}\n${extracted.canonicalUrl || ""}`;
  return /安全限制|IP存在风险|error_code=300012|请切换可靠网络环境|website-login\/error/.test(text);
}

export function isCaptchaPage(extracted) {
  const text = `${extracted.title || ""}\n${extracted.bodyText || ""}\n${extracted.canonicalUrl || ""}`;
  return /website-login\/captcha|滑动太频繁|请稍后再试|verifyType=|当前网络环境|操作过于频繁|验证码/.test(text);
}

export function isUnavailablePage(extracted) {
  const text = `${extracted.title || ""}\n${extracted.bodyText || ""}`;
  return /当前笔记暂时无法浏览|笔记不存在|内容无法查看|该内容暂时无法查看/.test(text);
}

export function isUiAsset(url) {
  const lower = String(url || "").toLowerCase();
  let parsed = null;
  try { parsed = new URL(url); } catch { return true; }
  const path = parsed.pathname.replaceAll("/", "");
  return (
    !path || path.length < 12 ||
    lower.includes("fe-static.xhscdn.com") || lower.includes("fe-platform.xhscdn.com") ||
    lower.includes("fe-video-qc.xhscdn.com/fe-platform") || lower.includes("dc.xhscdn.com/") ||
    lower.includes("fe-picasso") || lower.includes("picasso-static.xiaohongshu.com") ||
    lower.includes("picasso-private-1251524319.cos.ap-shanghai.myqcloud.com") ||
    lower.includes("sns-avatar") || lower.startsWith("data:image/svg")
  );
}

export function uniqueByUrl(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const url = cleanAssetUrl(item.url || item.sourceUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ ...item, url });
  }
  return result;
}

export function findInstalledBrowser() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  return candidates.find((file) => existsSync(file)) || "";
}

export async function getPlaywright() {
  const localRequire = createRequire(import.meta.url || __filename || process.cwd() + '/');
  try { return localRequire("playwright"); } catch (error) {
    const runtimeNodeModules = path.resolve(path.dirname(process.execPath), "..", "node_modules");
    const pnpmDir = path.join(runtimeNodeModules, ".pnpm");
    const pnpmPlaywrightPackage = existsSync(pnpmDir) ? readdirSync(pnpmDir).find((name) => /^playwright@/.test(name)) : "";
    const candidatePackageJsons = [
      pnpmPlaywrightPackage ? path.join(pnpmDir, pnpmPlaywrightPackage, "node_modules", "package.json") : "",
      path.join(runtimeNodeModules, "package.json")
    ].filter(Boolean);
    const runtimeErrors = [];
    for (const candidate of candidatePackageJsons) {
      try {
        const runtimeRequire = createRequire(candidate);
        return runtimeRequire("playwright");
      } catch (runtimeError) { runtimeErrors.push(`${candidate}: ${runtimeError.message}`); }
    }
    try { return await import("playwright"); } catch (importError) {
      throw new Error(`未找到 Playwright。请先运行 npm install，或使用 Codex 内置 Node 运行时启动工具。项目内错误：${error.message}；运行时错误：${runtimeErrors.join("；")}；ESM错误：${importError.message}`);
    }
  }
}

/** 统一浏览器启动：检测可执行文件 → 优先使用系统 Chrome → 反检测参数 → launch */
// 反自动化检测脚本 — 注入到每个页面，隐藏 Playwright/Chromium 自动化痕迹
const STEALTH_SCRIPT = `
// 1. 隐藏 webdriver 属性（Playwright 默认不设，但某些检测仍可探知）
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// 2. 伪造 chrome.runtime（检测脚本常检查此对象）
if (!window.chrome) { window.chrome = {}; }
if (!window.chrome.runtime) {
  const connections = new Map();
  window.chrome.runtime = {
    id: undefined, lastError: undefined,
    connect: () => ({ onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, postMessage: () => {} }),
    sendMessage: () => Promise.resolve(),
    onMessage: { addListener: () => {} },
    onConnect: { addListener: () => {} },
    onConnectExternal: { addListener: () => {} }
  };
}

// 3. 补全 navigator.plugins（无头浏览器返回空数组）
Object.defineProperty(navigator, 'plugins', {
  get: () => [1, 2, 3, 4, 5].map(i => ({ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }))
});
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
Object.defineProperty(navigator, 'mimeTypes', { get: () => [1, 2, 3, 4].map(i => ({ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' })) });

// 4. 修正 permissions API（无头浏览器可能暴露）
if (navigator.permissions && navigator.permissions.query) {
  const origQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (desc) => {
    if (desc.name === 'notifications' || desc.name === 'clipboard-read' || desc.name === 'clipboard-write') {
      return Promise.resolve({ state: 'prompt', onchange: null });
    }
    return origQuery(desc);
  };
}

// 5. 固定 hardwareConcurrency（防指纹检测差异）
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

// 6. 覆盖 WebGL 指纹
const getExt = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(type, attrs) {
  const ctx = getExt.call(this, type, attrs);
  if (ctx && type === 'webgl' || type === 'webgl2') {
    const origGetParam = ctx.getParameter;
    ctx.getParameter = function(p) {
      if (p === 37445) return 'Google Inc.';
      if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics (0x0000A781) Direct3D11 vs_5_0 ps_5_0)';
      if (p === 3415) return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
      return origGetParam.call(this, p);
    };
    const origGetExt = ctx.getExtension;
    ctx.getExtension = function(name) {
      const ext = origGetExt.call(this, name);
      if (name === 'WEBGL_debug_renderer_info') return null;
      return ext;
    };
  }
  return ctx;
};

// 7. 覆盖 navigator.connection（某些检测检查网络信息）
if (navigator.connection) {
  Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
  Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
  Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
}
`;

// ===== 全局持久浏览器（单实例，编译码+抓取共用） =====
let _globalContext = null;
let _globalBrowser = null;
let _globalPlaywright = null;

export async function initGlobalBrowser(rootDir) {
  if (_globalContext) return;
  const { chromium, firefox } = await getPlaywright();
  _globalPlaywright = chromium;
  const profileDir = path.join(rootDir || process.cwd(), ".browser-profile", "tool-profile");
  mkdirSync(profileDir, { recursive: true });
  _globalContext = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: [
      "--disable-quic", "--no-first-run", "--no-default-browser-check",
      "--disable-component-update", "--disable-sync",
      "--disable-background-networking",
      "--disable-features=ChromeWhatsNewUI",
      "--disable-blink-features=AutomationControlled",
    ],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    locale: "zh-CN", timezoneId: "Asia/Shanghai",
    permissions: ["geolocation"], deviceScaleFactor: 1,
  });
  _globalBrowser = _globalContext;
  await _globalContext.addInitScript({ content: STEALTH_SCRIPT });
  console.log("[browser] 持久浏览器已启动，profile:", profileDir);
}

export function getGlobalContext() { return _globalContext; }

export async function cleanupGlobalBrowser() {
  if (_globalContext) {
    try { await _globalContext.close(); } catch {}
    _globalContext = null;
    _globalBrowser = null;
    console.log("[browser] 持久浏览器已关闭");
  }
}

async function tryConnectCdp(chromium, cdpPort) {
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const contexts = browser.contexts();
    return { browser, context: contexts[0] || await browser.newContext(), isCdp: true };
  } catch { return null; }
}

export async function launchCdpChrome(cdpPort, rootDir) {
  const s = rootDir ? envWithSettings(rootDir) : { xhs: {} };
  const chromePath = s.xhs.browserExecutable || findInstalledBrowser() || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const { chromium } = await getPlaywright();

  // 0. 先检测端口是否已被占用（可能已有 Chrome 在运行）
  for (let i = 0; i < 5; i++) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      const contexts = browser.contexts();
      console.log(`[CDP] 已有 Chrome 连接至 :${cdpPort}`);
      return { browser, context: contexts[0] || await browser.newContext(), isCdp: true, launchedByTool: false };
    } catch { await sleep(500); }
  }

  // 1. 写临时 bat 脚本启动 Chrome（bat 是 Windows 上最可靠的传参方式）
  const profileDir = path.join(rootDir || process.cwd(), ".browser-profile", "chrome-cdp");
  mkdirSync(profileDir, { recursive: true });
  const batPath = path.join(rootDir || process.cwd(), "data", ".cdp-launch.bat");
  const batContent = `@echo off
start "" "${chromePath}" --remote-debugging-port=${cdpPort} --remote-allow-origins=* --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check --disable-gpu
`;
  writeFileSync(batPath, batContent, "utf8");

  try { execSync(`"${batPath}"`, { stdio: "ignore", timeout: 5000 }); } catch {}
  setTimeout(() => { try { rmSync(batPath, { force: true }); } catch {} }, 10000);

  // 2. 等待端口就绪（最多 30 秒）
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      const contexts = browser.contexts();
      console.log(`[CDP] Chrome 已就绪 (${i + 1}s)`);
      return { browser, context: contexts[0] || await browser.newContext(), isCdp: true, launchedByTool: true };
    } catch { /* 等待中 */ }
  }
  throw new Error(`浏览器自动启动失败（30s 超时）。请关闭您的 Chrome 后手动运行以下命令，然后重试提取：\n  "${chromePath}" --remote-debugging-port=${cdpPort} --remote-allow-origins=* --user-data-dir="${profileDir}"`);
}

export async function createBrowser(rootDir, options = {}) {
  const { chromium } = await getPlaywright();
  const settings = envWithSettings(rootDir);
  const headless = options.headless ?? settings.xhs.headless;
  const cdpPort = Object.prototype.hasOwnProperty.call(options, "cdpPort")
    ? Number(options.cdpPort || 0)
    : Number(settings.xhs.cdpPort || 0);
  const useCdp = cdpPort > 0;

  let browser, context, isCdp = false;
  let cdpConnected = false;

  if (useCdp && cdpPort > 0) {
    const cdpResult = await tryConnectCdp(chromium, cdpPort);
    if (cdpResult) {
      browser = cdpResult.browser; context = cdpResult.context; isCdp = true;
      cdpConnected = true;
    } else {
      console.log(`[CDP] 未能连接至调试端口 ${cdpPort}。为避免强推您正在使用的 Chrome，将自动降级为常规 Playwright 模式启动。`);
    }
  }

  if (!cdpConnected) {
    // 常规模式：启动 Playwright 浏览器
    const launchOpts = {
      headless,
      args: [
        "--disable-quic", "--no-first-run", "--no-default-browser-check",
        "--disable-component-update", "--disable-sync",
        "--disable-background-networking",
        "--disable-features=ChromeWhatsNewUI",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1440,960"
      ]
    };
    if (settings.xhs.browserExecutable) launchOpts.executablePath = settings.xhs.browserExecutable;
    browser = await chromium.launch(launchOpts);

    const viewports = [
      { width: 1440, height: 900 }, { width: 1536, height: 864 },
      { width: 1366, height: 768 }, { width: 1920, height: 1080 },
      { width: 1280, height: 800 }
    ];
    context = await browser.newContext({
      viewport: viewports[Math.floor(Math.random() * viewports.length)],
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      locale: "zh-CN", timezoneId: "Asia/Shanghai",
      permissions: ["geolocation"], deviceScaleFactor: 1,
      colorScheme: "light"
    });
    await context.addInitScript({ content: STEALTH_SCRIPT });
  }

  return { browser, context, isCdp };
}

export function cleanupCdpChrome() {}

export async function openXhsContext(rootDir, cookieOverride = "", optionOverrides = {}) {
  // 优先使用全局持久浏览器
  const globalCtx = getGlobalContext();
  if (globalCtx && !String(cookieOverride || "").trim() && optionOverrides.useGlobal !== false) {
    // 包装一个 dummy close（不关闭全局上下文）
    const proxy = Object.create(globalCtx);
    proxy.close = async () => {};
    return proxy;
  }
  // 无全局浏览器时回退旧逻辑
  const { browser, context, isCdp } = await createBrowser(rootDir, optionOverrides);
  if (!isCdp) {
    const cookie = readXhsCookie(rootDir, cookieOverride);
    if (cookie) await context.addCookies(cookieStringToPlaywrightCookies(cookie));
  }
  const origClose = context.close.bind(context);
  context.close = async () => {
    await origClose();
    if (!isCdp) { try { await browser.close(); } catch {} }
  };
  return context;
}

export function attachResponseCollector(page, bodies) {
  page.on("response", async (response) => {
    const responseUrl = response.url();
    if (!/(xiaohongshu|xhscdn|sns-img|sns-video|sns-webpic)/i.test(responseUrl)) return;
    const contentType = response.headers()["content-type"] || "";
    if (!/(json|text|javascript)/i.test(contentType) && !/api\/sns|web\/v\d/i.test(responseUrl)) return;
    try {
      const text = await response.text();
      if (text && text.length < 4_000_000) bodies.push({ url: responseUrl, contentType, text });
    } catch {}
  });
}

export function collectAssetsFromBodies(bodies) {
  const assets = [];
  for (const body of bodies) {
    const normalized = decodeLoose(body.text);
    const directUrls = Array.from(normalized.matchAll(/https?:\/\/[^"'<>\s\\]+/g)).map((match) => ({ url: match[0], source: `network:${body.url}` }));
    assets.push(...directUrls);
    try {
      const parsed = JSON.parse(body.text);
      walkJson(parsed, assets, `json:${body.url}`);
    } catch {}
  }
  return assets.map((a) => ({ ...a, url: cleanAssetUrl(a.url) }))
    .map((a) => ({ kind: classifyUrl(a.url), url: a.url, source: a.source }))
    .filter((a) => a.kind !== "unknown");
}

function walkJson(value, output, source) {
  if (Array.isArray(value)) { for (const item of value) walkJson(item, output, source); return; }
  if (value && typeof value === "object") { for (const item of Object.values(value)) walkJson(item, output, source); return; }
  if (typeof value === "string") {
    const normalized = decodeLoose(value);
    const urls = Array.from(normalized.matchAll(/https?:\/\/[^"'<>\s\\]+/g)).map((m) => ({ url: m[0], source }));
    output.push(...urls);
  }
}

export function parseInitState(html) {
  const idx = html.indexOf("__INITIAL_STATE__");
  if (idx < 0) return null;
  const scriptStart = html.slice(0, idx).lastIndexOf("<script");
  if (scriptStart < 0) return null;
  const fromScript = html.slice(scriptStart);
  const scriptEnd = fromScript.indexOf("</script>");
  if (scriptEnd < 0) return null;
  const inScript = fromScript.slice(0, scriptEnd);
  const eqPos = inScript.indexOf("=");
  const braceStart = inScript.indexOf("{", eqPos);
  const braceEnd = inScript.lastIndexOf("}");
  if (braceStart < 0 || braceEnd < 0) return null;
  let jsonStr = inScript.slice(braceStart, braceEnd + 1);
  // Standard cleanup: undefined→null, NaN→null
  jsonStr = jsonStr.replace(/\bundefined\b/g, "null").replace(/\bNaN\b/g, "null");
  // Unicode escape handling: convert \uXXXX sequences that may break JSON.parse
  jsonStr = jsonStr.replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003C/gi, "<")
    .replace(/\\u003E/gi, ">")
    .replace(/\\u003D/gi, "=");
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Second cleanup pass: strip remaining problematic patterns
    try {
      const cleaned = jsonStr
        .replace(/,\s*([}\]])/g, "$1")        // trailing commas
        .replace(/(['"])\s*:\s*,/g, "$1:null,") // empty values
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

export function normalizeIndexes(index) {
  if (!Array.isArray(index) || !index.length) return null;
  const values = index.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
  return values.length ? new Set(values) : null;
}

export function filterByIndexes(items, indexes) {
  if (!indexes) return items;
  return items.filter((_, position) => indexes.has(position + 1));
}

/**
 * Extract note data from parsed __INITIAL_STATE__.
 * Traverses multiple known paths (PC noteDetailMap, mobile noteData, simplified).
 * Unwraps Vue 3 reactive wrappers (_value/_rawValue).
 * @param {object} state - Parsed __INITIAL_STATE__
 * @param {string} [noteId] - Target note ID (optional, takes first if omitted)
 * @returns {object|null} Unwrapped note data or null
 */
export function extractNoteFromState(state, noteId) {
  if (!state || typeof state !== "object") return null;

  function unwrapVue(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (obj._rawValue !== undefined) return unwrapVue(obj._rawValue);
    if (obj._value !== undefined) return unwrapVue(obj._value);
    return obj;
  }

  // PC path: state.note.noteDetailMap[noteId].note
  const noteDetailMap = unwrapVue(state?.note?.noteDetailMap);
  if (noteDetailMap && typeof noteDetailMap === "object") {
    let entry = null;
    if (noteId && noteDetailMap[noteId]) {
      entry = unwrapVue(noteDetailMap[noteId]);
    } else {
      // Take first entry
      const keys = Object.keys(noteDetailMap).filter(k => k !== "__proto__");
      if (keys.length) entry = unwrapVue(noteDetailMap[keys[0]]);
    }
    if (entry) {
      const noteData = unwrapVue(entry.note || entry);
      if (noteData && (noteData.title || noteData.noteId || noteData.desc || noteData.imageList)) {
        return noteData;
      }
    }
  }

  // Mobile path: state.noteData.data.noteData
  const mobileNote = unwrapVue(state?.noteData?.data?.noteData);
  if (mobileNote && (mobileNote.title || mobileNote.noteId)) return mobileNote;

  // Simplified paths
  const simpleNote = unwrapVue(state?.note?.note);
  if (simpleNote && (simpleNote.title || simpleNote.noteId)) return simpleNote;

  const noteDetail = unwrapVue(state?.noteDetail);
  if (noteDetail && (noteDetail.title || noteDetail.noteId)) return noteDetail;

  return null;
}

/**
 * Extract CDN file token from an XHS image URL.
 * @param {string} url - XHS image URL
 * @returns {string} File token or empty string
 */
export function extractImageToken(url) {
  if (!url || typeof url !== "string") return "";
  // Match /spectrum/ path and extract what follows
  const spectrumMatch = url.match(/\/spectrum\/([^?&#]+)/);
  if (spectrumMatch) return spectrumMatch[1].replace(/\.[a-z]+$/i, "");
  // Match ci.xiaohongshu.com path
  const ciMatch = url.match(/ci\.xiaohongshu\.com\/([^?&#]+)/);
  if (ciMatch) return ciMatch[1].replace(/\.[a-z]+$/i, "");
  // Generic: extract path after last / before query
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts.at(-1) || "";
    return last.replace(/\.[a-z]+$/i, "");
  } catch {
    return "";
  }
}

/**
 * Build a clean CDN image URL from a token.
 * @param {string} token - CDN file token
 * @param {string} [format="png"] - Output format
 * @returns {string} Full CDN URL
 */
export function buildCdnImageUrl(token, format) {
  if (!token) return "";
  const fmt = format || "png";
  return `https://ci.xiaohongshu.com/${token}?imageView2/2/w/format/${fmt}`;
}

/**
 * Extract cover image from noteData.
 * Checks video.image, video.firstFrame, and cover fields.
 * @param {object} noteData
 * @returns {{url:string, width:number, height:number, source:string}|null}
 */
export function extractCoverImage(noteData) {
  if (!noteData || typeof noteData !== "object") return null;

  // video.image (poster frame)
  const videoImage = noteData.video?.image || noteData.video?.firstFrame;
  if (videoImage) {
    const url = cleanAssetUrl(bestImageUrl(videoImage));
    if (url) return { url, width: videoImage.width || 0, height: videoImage.height || 0, source: "video.image" };
  }

  // cover field
  const cover = noteData.cover;
  if (cover) {
    if (typeof cover === "string") {
      const url = cleanAssetUrl(cover);
      if (url) return { url, width: 0, height: 0, source: "cover" };
    } else if (typeof cover === "object") {
      const url = cleanAssetUrl(bestImageUrl(cover));
      if (url) return { url, width: cover.width || 0, height: cover.height || 0, source: "cover" };
    }
  }

  return null;
}

/**
 * Multi-hop short link resolver for xhslink.com URLs.
 * Uses HEAD with redirect:manual, follows up to 5 hops.
 * Falls back to GET on HEAD failure.
 * @param {string} url - Short link URL
 * @returns {Promise<{finalUrl:string, noteId:string, xsecToken:string, hops:number, source:string}|null>}
 */
export async function resolveShortLink(url) {
  if (!url || typeof url !== "string") return null;
  if (!/xhslink\.com/i.test(url)) return null;

  const maxHops = 5;
  let current = url;
  let hops = 0;
  let method = "HEAD";

  for (let i = 0; i < maxHops; i++) {
    try {
      const response = await fetch(current, {
        method,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml"
        }
      });
      hops++;
      const location = response.headers.get("location");
      if (location) {
        current = location.startsWith("http") ? location : new URL(location, current).toString();
      } else {
        break;
      }
    } catch {
      if (method === "HEAD") {
        // Fallback to GET on HEAD failure
        method = "GET";
        continue;
      }
      break;
    }
  }

  const noteId = extractXhsId(current);
  let xsecToken = "";
  try {
    const parsed = new URL(current);
    xsecToken = parsed.searchParams.get("xsec_token") || "";
  } catch {}

  return {
    finalUrl: current,
    noteId: noteId || "",
    xsecToken,
    hops,
    source: "shortlink-resolve"
  };
}

/**
 * Extract Open Graph meta tags and <title> from HTML.
 * @param {string} html - Raw HTML string
 * @returns {{ogImage:string, ogVideo:string, ogTitle:string, ogDescription:string, ogUrl:string, title:string}}
 */
export function extractOgMeta(html) {
  if (!html || typeof html !== "string") return { ogImage: "", ogVideo: "", ogTitle: "", ogDescription: "", ogUrl: "", title: "" };

  function getContent(property) {
    // Match both property="og:xxx" and name="og:xxx"
    const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, "i");
    const match = html.match(regex);
    if (match) return match[1];
    // Also try reversed attribute order: content before property
    const regex2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, "i");
    const match2 = html.match(regex2);
    return match2 ? match2[1] : "";
  }

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);

  return {
    ogImage: getContent("og:image"),
    ogVideo: getContent("og:video"),
    ogTitle: getContent("og:title"),
    ogDescription: getContent("og:description"),
    ogUrl: getContent("og:url"),
    title: titleMatch ? titleMatch[1].trim() : ""
  };
}

export { sleep };
