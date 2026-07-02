import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { envWithSettings } from "./settings.mjs";

const ALGORITHM = "aes-256-gcm";
const _DEFAULT_SECRET = "brand-content-intel-xhs-2025";
function _resolveAppSecret() {
  if (process.env.COOKIE_ENCRYPT_SECRET) return process.env.COOKIE_ENCRYPT_SECRET;
  try {
    const secretPath = path.join(process.cwd(), "data", ".app_secret");
    if (existsSync(secretPath)) {
      const s = readFileSync(secretPath, "utf8").trim();
      if (s && s.length >= 32) return s;
    }
  } catch {}
  return _DEFAULT_SECRET;
}
const APP_SECRET = _resolveAppSecret();

function deriveKey(rootDir, legacy = false) {
  const machineId = (() => {
    try {
      const os = process.env.USERNAME || process.env.COMPUTERNAME || "unknown";
      if (legacy) return createHash("sha256").update(os + APP_SECRET).digest("hex").slice(0, 32);
      // 使用稳定的 scope ID（data/.scope_id）而非绝对路径，支持目录重命名/移动
      const scope = _resolveScopeId(rootDir);
      return createHash("sha256").update(`${os}:${scope}:${APP_SECRET}`).digest();
    } catch { return createHash("sha256").update(APP_SECRET).digest(); }
  })();
  return machineId;
}


/**
 * 生成/读取项目稳定标识符，不依赖绝对路径
 * 写入 data/.scope_id 文件，支持目录改名、移动后依然能解密已有 Cookie
 */
function _resolveScopeId(rootDir) {
  const root = path.resolve(rootDir || process.cwd());
  const scopePath = path.join(root, "data", ".scope_id");
  try {
    if (existsSync(scopePath)) {
      return readFileSync(scopePath, "utf8").trim();
    }
    const id = createHash("sha256").update(APP_SECRET + Date.now().toString()).digest("hex").slice(0, 16);
    mkdirSync(path.dirname(scopePath), { recursive: true });
    writeFileSync(scopePath, id, "utf8");
    return id;
  } catch {
    return root;
  }
}
export function encryptCookie(cookieString, rootDir) {
  if (!cookieString) return "";
  const key = deriveKey(rootDir);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(cookieString, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return iv.toString("hex") + ":" + authTag + ":" + encrypted;
}

export function decryptCookie(encrypted, rootDir) {
  if (!encrypted || !encrypted.includes(":")) return encrypted || "";
  const tryDecrypt = (key) => {
    const parts = encrypted.split(":");
    if (parts.length < 3) return "";
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encryptedText = parts.slice(2).join(":");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  };
  try {
    return tryDecrypt(deriveKey(rootDir));
  } catch {
    try { return tryDecrypt(deriveKey(rootDir, true)); } catch { return ""; }
  }
}

export function readXhsCookie(rootDir, override = "") {
  if (override && String(override).trim()) return String(override).trim();
  const settings = envWithSettings(rootDir);
  if (settings.xhs.cookie) return settings.xhs.cookie;
  const envCookie = process.env.XHS_COOKIE || "";
  if (envCookie.trim()) return envCookie.trim();

  const cookieFile = path.isAbsolute(settings.xhs.cookieFile)
    ? settings.xhs.cookieFile
    : path.join(rootDir, settings.xhs.cookieFile);
  if (existsSync(cookieFile)) {
    return readFileSync(cookieFile, "utf8").trim();
  }
  return "";
}

export function cookieStringToPlaywrightCookies(cookieString) {
  if (!cookieString) return [];
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index < 1) return null;
      return {
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1).trim(),
        domain: ".xiaohongshu.com",
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "Lax"
      };
    })
    .filter(Boolean);
}

export function cleanCookieString(raw) {
  if (!raw) return "";
  let str = raw.trim();
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  if (str.startsWith("[") || str.startsWith("{")) {
    try {
      const parsed = JSON.parse(str);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const parts = items
        .filter((item) => item && typeof item === "object" && item.name && item.value !== undefined)
        .map((item) => `${item.name}=${item.value}`);
      if (parts.length > 0) return parts.join("; ");
    } catch {}
  }
  str = str.replace(/[\r\n]+/g, "; ");
  return str.split(";").map((part) => part.trim()).filter(Boolean).join("; ");
}

function parseInitStateForAuth(html) {
  const idx = String(html || "").indexOf("__INITIAL_STATE__");
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
  jsonStr = jsonStr.replace(/\bundefined\b/g, "null").replace(/\bNaN\b/g, "null");
  // Handle Unicode escape sequences (same as SDK parseInitState)
  jsonStr = jsonStr.replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003C/gi, "<")
    .replace(/\\u003E/gi, ">")
    .replace(/\\u003D/gi, "=");
  try { return JSON.parse(jsonStr); } catch {}
  // Secondary cleanup pass on failure: trailing commas, hex escapes
  try {
    const cleaned = jsonStr
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/(["\x27])\s*:\s*,/g, "$1:null,")
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return JSON.parse(cleaned);
  } catch { return null; }
}

function unwrapReactive(value) {
  if (!value || typeof value !== "object") return value || {};
  return value._value || value._rawValue || value;
}

export function inspectCookieStateFromHtml(html) {
  const state = parseInitStateForAuth(html);
  const text = String(html || "");
  if (!state) {
    return {
      hasState: false,
      isLoginPage: /手机号登录|验证码登录|登录小红书|请输入手机号/.test(text),
      isGuest: null,
      isLoggedIn: null,
      userId: "",
      nickname: ""
    };
  }
  const user = state.user || {};
  const userInfo = unwrapReactive(user.userInfo);
  const userPageData = unwrapReactive(user.userPageData);
  const loggedIn = unwrapReactive(user.loggedIn);
  const auth = unwrapReactive(user.auth);
  const basic = userPageData.basicInfo || {};
  // SSR guest flag is unreliable - XHS often pre-renders guest:true even for valid sessions
  const rawUserId = userInfo.userId || userInfo.id || basic.userId || basic.redId || "";
  const userId = /^guest/i.test(String(rawUserId || "")) ? "" : rawUserId;
  const nickname = userInfo.nickname || basic.nickname || "";
  const isGuest = !userId || !nickname;
  const isLoggedIn = Boolean(userId) && Boolean(nickname);
  return { hasState: true, isLoginPage: false, isGuest, isLoggedIn, userId, nickname };
}

/** 检查 Cookie 是否有效：轻量级检测，只检查 HTTP 状态和重定向 */
export async function checkCookieValid(rootDir, cookieRaw) {
  const cleaned = cleanCookieString(cookieRaw);
  if (!cleaned || !cleaned.includes("web_session")) {
    return { valid: false, reason: "缺少必要 Cookie 字段（web_session）" };
  }
  try {
    const resp = await fetch("https://www.xiaohongshu.com/explore", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Cookie: cleaned,
      },
      redirect: "manual",
    });
    if (resp.status === 302 || resp.status === 301) {
      const location = resp.headers.get("location") || "";
      if (location.includes("/login")) return { valid: false, reason: "Cookie 已过期，被重定向到登录页" };
    }
    if (resp.status === 200) {
      const html = await resp.text();
      const authState = inspectCookieStateFromHtml(html);
      if (authState.isLoginPage) {
        return { valid: false, reason: "Cookie 已过期，页面要求重新登录" };
      }
      if (authState.hasState && authState.isGuest === true) {
        return { valid: false, reason: "Cookie 为访客会话，非登录态" };
      }
      if (authState.hasState && authState.isLoggedIn === false) {
        return { valid: false, reason: "Cookie 未通过登录态校验" };
      }
      // 抽取 Set-Cookie 中 a1 更新
      let updatedCookie = cleaned;
      const setCookies = [];
      resp.headers.forEach((val, key) => {
        if (key.toLowerCase() === "set-cookie") setCookies.push(val);
      });
      if (setCookies.length > 0) {
        const parts = cleaned.split(";").map(s => s.trim()).filter(Boolean);
        let changed = false;
        for (const sc of setCookies) {
          const m = sc.match(/a1=([^;]+)/);
          if (m) {
            const idx = parts.findIndex(p => p.startsWith("a1="));
            if (idx >= 0 && parts[idx].split("=")[1] !== m[1]) {
              parts[idx] = `a1=${m[1]}`;
              changed = true;
            }
          }
        }
        if (changed) updatedCookie = parts.join("; ");
      }
      return {
        valid: true,
        cookieUpdated: updatedCookie,
        cookieCount: cleaned.split(";").length,
        nickname: authState.nickname || "",
        userId: authState.userId || ""
      };
    }
    return { valid: false, reason: `意外状态码 ${resp.status}` };
  } catch (e) {
    console.warn("[checkCookieValid] 检测异常:", e.message);
    return { valid: false, reason: `检测失败：${e.message}` };
  }
}

/** 从所有可用源解析最佳 Cookie（DB 最近有效 > 文件） */
export function resolveCookie(rootDir, storage) {
  if (storage) {
    try {
      const accounts = storage.listXhsAccounts();
      const valid = accounts
        .filter((a) => a.status === "有效")
        .sort((a, b) => new Date(b.last_check_at || 0) - new Date(a.last_check_at || 0));
      for (const account of valid) {
        if (account.cookie_encrypted) {
          const decrypted = decryptCookie(account.cookie_encrypted, rootDir);
          if (decrypted && decrypted.length > 50 && decrypted.includes("a1=")) return decrypted;
        }
      }
    } catch {}
  }
  const fileCookie = readXhsCookie(rootDir);
  if (fileCookie && fileCookie.includes("a1=") && fileCookie.length > 50) return fileCookie;
  return fileCookie || "";
}

export function xhsRequestHeaders(rootDir, referer = "https://www.xiaohongshu.com/") {
  const headers = {
    Referer: referer,
    Origin: "https://www.xiaohongshu.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  };
  const cookie = readXhsCookie(rootDir);
  if (cookie) headers.Cookie = cookie;
  return headers;
}
