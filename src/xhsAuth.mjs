import { existsSync, readFileSync } from "node:fs";
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
      const scope = path.resolve(rootDir || process.cwd());
      return createHash("sha256").update(`${os}:${scope}:${APP_SECRET}`).digest();
    } catch { return createHash("sha256").update(APP_SECRET).digest(); }
  })();
  return machineId;
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

/** 检查 Cookie 是否有效：HTTP 请求 explore 页，判断是否被重定向到登录页 */
export async function checkCookieValid(rootDir, cookieRaw) {
  const cleaned = cleanCookieString(cookieRaw);
  if (!cleaned || !cleaned.includes("web_session")) {
    return { valid: false, reason: "缺少必要 Cookie 字段（web_session）" };
  }
  try {
    const resp = await fetch("https://www.xiaohongshu.com/explore", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Ch-Ua": '"Not(A:Brand";v="99", "Google Chrome";v="134", "Chromium";v="134"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        Referer: "https://www.xiaohongshu.com/",
        Cookie: cleaned
      },
      redirect: "manual"
    });
    if (resp.status === 302 || resp.status === 301) {
      const location = resp.headers.get("location") || "";
      if (location.includes("/login")) return { valid: false, reason: "Cookie 已过期，被重定向到登录页" };
    }
    const html = await resp.text();
    if (html.includes("手机号登录") || html.includes("登录小红书") || html.includes("你访问的页面不见了")) {
      return { valid: false, reason: "Cookie 无效（页面返回登录态）" };
    }
    // 尝试从 __INITIAL_STATE__ 提取用户昵称
    const { parseInitState } = await import("./xhsSdk.mjs");
    const state = parseInitState(html);
    const ui = state?.user?.userInfo;
    const val = ui?._value || ui?._rawValue || ui;
    const nickname = val?.nickname || state?.user?.userInfo?.nickname || "";
    const userId = val?.userId || val?.user_id || "";
    const loggedIn = state?.user?.loggedIn;
    if (val?.guest === true || loggedIn === false || (!nickname && !userId)) {
      return { valid: false, reason: "Cookie 为访客会话或登录态已失效" };
    }

    // 自动合并 Set-Cookie 中可能下发的新 a1 等字段以补全 Cookie (自愈)
    let updatedCookie = cleaned;
    const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : (resp.headers.get("set-cookie") ? [resp.headers.get("set-cookie")] : []);
    if (setCookies.length > 0) {
      const newCookieParts = [...cleaned.split(";").map(s => s.trim()).filter(Boolean)];
      let updated = false;
      for (const sc of setCookies) {
        if (sc.includes("a1=")) {
          const match = sc.match(/a1=([^;]+)/);
          if (match) {
            const newA1 = match[1];
            const a1Index = newCookieParts.findIndex(p => p.startsWith("a1="));
            if (a1Index >= 0) {
              const val = newCookieParts[a1Index].split("=")[1];
              if (val !== newA1) {
                newCookieParts[a1Index] = `a1=${newA1}`;
                updated = true;
              }
            } else {
              newCookieParts.push(`a1=${newA1}`);
              updated = true;
            }
          }
        }
      }
      if (updated) {
        updatedCookie = newCookieParts.join("; ");
      }
    }

    return { 
      valid: true, 
      nickname, 
      cookieUpdated: updatedCookie,
      cookieCount: updatedCookie.split(";").filter((s) => s.includes("=")).length 
    };
  } catch (e) {
    return { valid: false, reason: `检测失败：${e.message}` };
  }
}

/** 从所有可用源解析最佳 Cookie（文件 > 设置 > 环境变量 > DB），storage 可选 */
export function resolveCookie(rootDir, storage) {
  if (storage) {
    try {
      const accounts = storage.listXhsAccounts();
      const valid = accounts.find((a) => a.status === "有效");
      if (valid?.cookie_encrypted) {
        const decrypted = decryptCookie(valid.cookie_encrypted, rootDir);
        if (decrypted && decrypted.length > 50) return decrypted;
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
