import { createWriteStream, copyFileSync, existsSync, mkdirSync, renameSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xhsRequestHeaders } from "./xhsAuth.mjs";
import { envWithSettings, getAuthorAlias } from "./settings.mjs";
import { fmtDate } from "./time.mjs";

const IMAGE_EXT_MAP = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", heic: "heic", avif: "avif" };

async function convertImage(sourcePath, targetFormat, quality) {
  if (targetFormat === "AUTO") return;
  const ext = path.extname(sourcePath).replace(".", "").toLowerCase();
  const targetExt = IMAGE_EXT_MAP[targetFormat.toLowerCase()];
  if (!targetExt || ext === targetExt) return;
  const targetPath = sourcePath.replace(/\.[^.]+$/, `.${targetExt}`);
  try {
    const sharp = (await import("sharp")).default;
    const info = await sharp(sourcePath).metadata();
    const opts = { quality: quality || 85 };
    if (targetExt === "jpg" || targetExt === "jpeg") {
      await sharp(sourcePath).jpeg(opts).toFile(targetPath);
    } else if (targetExt === "png") {
      await sharp(sourcePath).png({ compressionLevel: Math.max(0, Math.min(9, Math.round((100 - (quality || 85)) / 100 * 9))) }).toFile(targetPath);
    } else if (targetExt === "webp") {
      await sharp(sourcePath).webp(opts).toFile(targetPath);
    } else {
      return;
    }
    unlinkSync(sourcePath);
  } catch {
    // sharp not available or conversion failed — keep original
  }
}

function safeName(value) {
  return String(value || "未命名")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "未命名";
}

function shortTitle(title, maxLen = 20) {
  if (!title) return "未命名";
  const clean = title.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  const truncated = clean.slice(0, maxLen).replace(/[，。！？,.!?\s]+$/, "");
  return (truncated || clean.slice(0, maxLen)).trim();
}

function contentTypeShort(type) {
  if (type === "视频笔记") return "视频";
  if (type === "图文笔记" || type === "Live图文") return "图文";
  return type || "笔记";
}

function collapseSeparators(str) {
  return str
    .replace(/[-_]{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^_+|_+$/g, "")
    .trim();
}

function compactDate(value) {
  if (!value) return "";
  return fmtDate(value).replaceAll("-", "");
}

function metricValue(metrics, keys) {
  for (const key of keys) {
    const value = metrics?.[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function extensionFrom(contentType, url, kind) {
  const lower = url.toLowerCase();
  const match = lower.match(/\.([a-z0-9]{2,5})(?:\?|$)/);
  if (match) return match[1] === "jpeg" ? "jpg" : match[1];
  if (lower.includes("webp")) return "webp";
  if (lower.includes("png")) return "png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("heic")) return "heic";
  if (contentType?.includes("mp4")) return "mp4";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  return kind === "video" || kind === "livePhoto" ? "mp4" : "jpg";
}

function relativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

function formatFileBase(template, values) {
  return String(template || "{index}-{kind}")
    .replaceAll("{index}", values.index)
    .replaceAll("{kind}", values.kind)
    .replaceAll("{noteId}", values.noteId || "")
    .replaceAll("{title}", safeName(values.title || ""))
    .replaceAll("{titleShort}", safeName(values.titleShort || shortTitle(values.title, 20)))
    .replaceAll("{type}", values.type || "")
    .replaceAll("{author}", safeName(values.author || ""))
    .replaceAll("{brand}", safeName(values.brand || ""))
    .replaceAll("{publishedAt}", values.publishedAt || "")
    .replaceAll("{date}", values.date || "")
    .replaceAll("{tags}", safeName(values.tags || ""))
    .replaceAll("{likes}", values.likes || "")
    .replaceAll("{comments}", values.comments || "")
    .replaceAll("{collects}", values.collects || "")
    .replaceAll("{shares}", values.shares || "");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pipeWebStreamToFile(readable, filePath, flags = "w") {
  if (!readable) throw new Error("响应缺少可读取内容");
  const writer = createWriteStream(filePath, { flags });
  const reader = readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise((resolve, reject) => {
        writer.write(Buffer.from(value), (error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    await new Promise((resolve) => writer.end(resolve));
    reader.releaseLock();
  }
}

async function downloadFile(rootDir, sourceUrl, targetPath, note, settings) {
  const tmpPath = `${targetPath}.part`;
  const maxRetry = Number(settings.download.maxRetry ?? 2);
  const timeoutMs = Number(settings.download.timeoutMs ?? 30000);
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    const partialSize = existsSync(tmpPath) ? statSync(tmpPath).size : 0;
    const headers = xhsRequestHeaders(rootDir, note.sourceUrl || "https://www.xiaohongshu.com/");
    const useRange = partialSize > 0;
    if (useRange) headers.Range = `bytes=${partialSize}-`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(sourceUrl, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (useRange && response.status !== 206) {
        unlinkSync(tmpPath);
        continue;
      }
      if (!response.ok && (!useRange || response.status !== 206)) {
        throw new Error(`下载失败：HTTP ${response.status}`);
      }
      await pipeWebStreamToFile(response.body, tmpPath, useRange ? "a" : "w");
      const expectedTail = Number(response.headers.get("content-length") || 0);
      const actualSize = statSync(tmpPath).size;
      if (expectedTail && !useRange && actualSize < expectedTail) {
        throw new Error(`文件不完整：${actualSize}/${expectedTail}`);
      }
      renameSync(tmpPath, targetPath);
      return {
        contentType: response.headers.get("content-type") || "",
        fileSize: statSync(targetPath).size
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < maxRetry) await sleep(300 * (attempt + 1));
    }
  }
  throw lastError || new Error("下载失败");
}

export async function persistNoteAssets(rootDir, note) {
  const settings = envWithSettings(rootDir);
  const rawFolder = settings.download.folderName || "library";
  const libraryRoot = path.isAbsolute(rawFolder) ? rawFolder : path.join(rootDir, "data", rawFolder);
  const brand = safeName(note.brand || "未分组品牌");
  const alias = getAuthorAlias(rootDir, note.authorId);
  const folderTemplate = settings.download.folderNameFormat || "{noteId}";
  const folderValues = {
    index: "01", kind: "note", type: contentTypeShort(note.contentType),
    noteId: note.noteId || note.id,
    title: note.title, titleShort: shortTitle(note.title, 20),
    author: alias || note.authorName, brand: note.brand,
    publishedAt: note.publishedAt || "",
    date: compactDate(note.publishedAt || note.collectedAt),
    tags: Array.isArray(note.tags) ? note.tags.join("-") : "",
    likes: "", comments: "", collects: "", shares: ""
  };
  const noteFolder = safeName(collapseSeparators(formatFileBase(folderTemplate, folderValues)));
  const targetDir = path.join(libraryRoot, brand, noteFolder);

  // 从旧版 library/brand/作者/noteId 迁移到新版 library/brand/template
  if (note.authorId && note.authorName) {
    const author = safeName(alias || note.authorName || "未知作者");
    const oldNoteDir = path.join(libraryRoot, brand, author, safeName(note.noteId || note.id || ""));
    if (oldNoteDir !== targetDir && existsSync(oldNoteDir)) {
      mkdirSync(path.dirname(targetDir), { recursive: true });
      renameSync(oldNoteDir, targetDir);
      try { rmdirSync(path.join(libraryRoot, brand, author)); } catch { }
    }
  }

  mkdirSync(targetDir, { recursive: true });

  const saved = [];
  const assets = Array.isArray(note.assets) ? note.assets : [];
  for (let index = 0; index < assets.length; index += 1) {
    if (index > 0 && Number(settings.download.intervalMs || 0) > 0) {
      await sleep(Number(settings.download.intervalMs || 0));
    }
    const asset = assets[index];
    const kind = asset.kind || "unknown";
    if (kind === "image" && settings.download.imageDownload === false) continue;
    if (kind === "video" && settings.download.videoDownload === false) continue;
    if (kind === "livePhoto" && settings.download.liveDownload === false) continue;
    const sourceUrl = asset.sourceUrl || asset.url || "";
    if (!sourceUrl) {
      saved.push({ ...asset, status: "失败", error: "缺少素材地址" });
      continue;
    }
    try {
      const metrics = note.metrics || {};
      const templateValues = {
        index: String(index + 1).padStart(2, "0"),
        kind, type: contentTypeShort(note.contentType),
        noteId: note.noteId || note.id,
        title: note.title, titleShort: shortTitle(note.title, 20),
        author: alias || note.authorName,
        brand: note.brand,
        publishedAt: note.publishedAt || "",
        date: compactDate(note.publishedAt || note.collectedAt),
        tags: Array.isArray(note.tags) ? note.tags.join("-") : "",
        likes: metricValue(metrics, ["likedCount", "likeCount", "likes"]),
        comments: metricValue(metrics, ["commentCount", "comments"]),
        collects: metricValue(metrics, ["collectedCount", "collectCount", "collects"]),
        shares: metricValue(metrics, ["shareCount", "shares"])
      };
      if (sourceUrl.startsWith("file:")) {
        const sourcePath = fileURLToPath(sourceUrl);
        const fileBase = collapseSeparators(formatFileBase(settings.download.nameFormat, templateValues));
        const fileName = `${safeName(fileBase)}${path.extname(sourcePath)}`;
        const targetPath = path.join(targetDir, fileName);
        copyFileSync(sourcePath, targetPath);
        if (settings.download.writeMtime && note.publishedAt) {
          const mtime = new Date(note.publishedAt).getTime();
          if (!Number.isNaN(mtime)) utimesSync(targetPath, mtime / 1000, mtime / 1000);
        }
        saved.push({
          ...asset,
          sourceUrl,
          localPath: relativePath(rootDir, targetPath),
          fileName,
          fileSize: existsSync(targetPath) ? statSync(targetPath).size : 0,
          status: "已保存"
        });
        continue;
      }

      const ext = extensionFrom("", sourceUrl, kind);
      const fileBase = collapseSeparators(formatFileBase(settings.download.nameFormat, templateValues));
      const fileName = `${safeName(fileBase)}.${ext}`;
      const targetPath = path.join(targetDir, fileName);
      if (settings.download.skipExistingFiles !== false && existsSync(targetPath)) {
        if (settings.download.writeMtime && note.publishedAt) {
          const mtime = new Date(note.publishedAt).getTime();
          if (!Number.isNaN(mtime)) utimesSync(targetPath, mtime / 1000, mtime / 1000);
        }
        saved.push({
          ...asset,
          sourceUrl,
          localPath: relativePath(rootDir, targetPath),
          fileName,
          fileSize: statSync(targetPath).size,
          mimeType: "",
          status: "已存在"
        });
        continue;
      }
      const result = await downloadFile(rootDir, sourceUrl, targetPath, note, settings);
      if (settings.download.writeMtime && note.publishedAt) {
        const mtime = new Date(note.publishedAt).getTime();
        if (!Number.isNaN(mtime)) utimesSync(targetPath, mtime / 1000, mtime / 1000);
      }
      let finalPath = targetPath;
      let finalName = fileName;
      if (asset.kind === "image" && settings.download.imageFormat && settings.download.imageFormat !== "AUTO") {
        const oldExt = path.extname(targetPath).replace(".", "").toLowerCase();
        const newExt = settings.download.imageFormat.toLowerCase();
        if (oldExt !== newExt && ["jpg", "jpeg", "png", "webp"].includes(newExt)) {
          await convertImage(targetPath, settings.download.imageFormat, settings.download.imageQuality || 85);
          const convertedPath = targetPath.replace(/\.[^.]+$/, `.${newExt}`);
          if (existsSync(convertedPath)) {
            finalPath = convertedPath;
            finalName = fileName.replace(/\.[^.]+$/, `.${newExt}`);
          }
        }
      }
      saved.push({
        ...asset,
        sourceUrl,
        localPath: relativePath(rootDir, finalPath),
        fileName: finalName,
        fileSize: existsSync(finalPath) ? statSync(finalPath).size : result.fileSize,
        mimeType: result.contentType,
        status: "已保存"
      });
    } catch (error) {
      saved.push({
        ...asset,
        sourceUrl,
        status: "需人工复核",
        error: error.message
      });
    }
  }

  writeFileSync(
    path.join(targetDir, "metadata.json"),
    JSON.stringify(
      {
        note: {
          sourceUrl: note.sourceUrl,
          noteId: note.noteId,
          brand: note.brand,
          authorName: note.authorName,
          title: note.title,
          description: note.description,
          publishedAt: note.publishedAt || "",
          contentType: note.contentType,
          tags: note.tags || [],
          metrics: note.metrics || {},
          collectedAt: note.collectedAt || new Date().toISOString()
        },
        assets: saved
      },
      null,
      2
    ),
    "utf8"
  );

  return saved;
}
