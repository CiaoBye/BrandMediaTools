import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

export const aiPresets = [
  { label: "OpenAI",           baseUrl: "https://api.openai.com/v1",                          models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.2", "o3-pro", "o4-mini"] },
  { label: "DeepSeek",         baseUrl: "https://api.deepseek.com/v1",                        models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"] },
  { label: "GLM (智谱)",       baseUrl: "https://open.bigmodel.cn/api/paas/v4",               models: ["glm-5", "glm-5-turbo", "glm-4.7", "glm-4.6", "glm-4.7-flash", "glm-4.5-air"] },
  { label: "Moonshot (Kimi)",  baseUrl: "https://api.moonshot.cn/v1",                         models: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking", "kimi-k2-thinking-turbo"] },
  { label: "Qwen (通义千问)",   baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",   models: ["qwen3.7-max", "qwen3.6-plus", "qwen3.5-plus", "qwen3.5-flash", "qwen-turbo", "qwen-long"] },
  { label: "MiniMax",          baseUrl: "https://api.minimax.chat/v1",                        models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed"] },
  { label: "Stepfun (阶跃)",   baseUrl: "https://api.stepfun.com/v1",                         models: ["step-3.7-flash", "step-3.5-flash", "step-2", "step-1-8k", "step-1-32k", "step-1-128k"] },
  { label: "Hunyuan (腾讯混元)", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",         models: ["hunyuan-turbos-latest", "hunyuan-t1-latest", "hunyuan-lite", "hunyuan-standard", "hunyuan-pro"] },
  { label: "Baichuan (百川)",   baseUrl: "https://api.baichuan-ai.com/v1",                    models: ["Baichuan4-Turbo", "Baichuan4-Air", "Baichuan2-Turbo", "Baichuan2-Turbo-192k"] },
  { label: "Yi (零一万物)",     baseUrl: "https://api.lingyiwanwu.com/v1",                     models: ["yi-lightning", "yi-large", "yi-medium", "yi-large-turbo", "yi-vision-v2"] },
  { label: "OpenCode Zen",      baseUrl: "https://opencode.ai/zen/v1",                          models: ["deepseek-v4-flash-free", "big-pickle", "mimo-v2.5-free", "nemotron-3-ultra-free"] },
  { label: "OpenCode Go",       baseUrl: "https://opencode.ai/zen/go/v1",                       models: ["deepseek-v4-flash", "deepseek-v4-pro", "glm-5.1", "glm-5", "kimi-k2.6", "kimi-k2.5", "mimo-v2.5", "mimo-v2.5-pro", "minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"] },
  { label: "自定义",            baseUrl: "",                                                    models: [] },
];

export const defaultSettings = {
  xhs: {
    headless: true,
    maxAccountNotes: 100,
    accountScrollPages: 8,
    accountScrollDelayMs: 1200,
    cookie: "",
    cookieFile: "data/xhs-cookie.txt",
    proxy: "",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    browserExecutable: "",
    cdpPort: 0,
    useCdp: false,
    mappingData: {}
  },
  download: {
    folderName: "library",
    folderMode: true,
    authorArchive: true,
    imageDownload: true,
    videoDownload: true,
    liveDownload: true,
    folderNameFormat: "{date}-{type}-{titleShort}",
    nameFormat: "{index}-{kind}",
    imageFormat: "AUTO",
    imageQuality: 100,
    skipExistingFiles: true,
    maxRetry: 2,
    chunkSize: 1048576,
    intervalMs: 500,
    timeoutMs: 30000,
    videoPreference: "resolution",
    videoMinHeight: 0,
    writeMtime: false
  },
  ai: {
    provider: "OpenAI",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4-mini"
  },
  notification: {
    webhookUrl: "",
    webhookPlatform: "feishu"
  }
};

export function parseBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function mergeDeep(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = mergeDeep(base[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function resolveAiConfig(settings) {
  const ai = settings.ai || {};
  const preset = aiPresets.find((p) => p.label === ai.provider) || aiPresets[0];
  return {
    apiKey: ai.apiKey || "",
    baseUrl: ai.baseUrl || preset.baseUrl || "",
    model: ai.model || (preset.models[0] || "")
  };
}

const _settingsCache = { rootDir: null, data: null, mtimeMs: 0 };

export function clearSettingsCache() { _settingsCache.rootDir = null; _settingsCache.data = null; _settingsCache.mtimeMs = 0; }

export function loadSettings(rootDir) {
  const settingsPath = path.join(rootDir, "data", "settings.json");
  const currentMtime = existsSync(settingsPath) ? statSync(settingsPath).mtimeMs : 0;
  if (_settingsCache.rootDir === rootDir && _settingsCache.data && _settingsCache.mtimeMs === currentMtime) return _settingsCache.data;
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (!existsSync(settingsPath)) {
    const data = { ...defaultSettings, xhs: { ...defaultSettings.xhs }, download: { ...defaultSettings.download }, ai: { ...defaultSettings.ai } };
    writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf8");
    _settingsCache.rootDir = rootDir;
    _settingsCache.data = data;
    _settingsCache.mtimeMs = Date.now();
    return data;
  }
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    const merged = mergeDeep(defaultSettings, parsed);
    _settingsCache.rootDir = rootDir;
    _settingsCache.data = merged;
    _settingsCache.mtimeMs = currentMtime;
    return merged;
  } catch {
    _settingsCache.rootDir = rootDir;
    _settingsCache.data = defaultSettings;
    _settingsCache.mtimeMs = currentMtime;
    return defaultSettings;
  }
}

export function envWithSettings(rootDir) {
  const settings = loadSettings(rootDir);
  return {
    ...settings,
    xhs: {
      ...settings.xhs,
      headless: parseBool(process.env.XHS_HEADLESS, settings.xhs.headless),
      maxAccountNotes: Number(process.env.XHS_MAX_ACCOUNT_NOTES || settings.xhs.maxAccountNotes || 12),
      cookie: process.env.XHS_COOKIE || settings.xhs.cookie || "",
      cookieFile: process.env.XHS_COOKIE_FILE || settings.xhs.cookieFile || "data/xhs-cookie.txt",
      proxy: process.env.XHS_PROXY || settings.xhs.proxy || "",
      browserExecutable: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || settings.xhs.browserExecutable || ""
    },
    download: {
      ...settings.download,
      videoPreference: process.env.XHS_VIDEO_PREFERENCE || settings.download.videoPreference || "resolution"
    }
  };
}

export function getAuthorAlias(rootDir, authorId) {
  if (!authorId) return "";
  const settings = loadSettings(rootDir);
  const mapping = settings.xhs?.mappingData || {};
  return mapping[authorId] || "";
}
