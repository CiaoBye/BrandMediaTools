import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { persistNoteAssets } from "../src/downloader.mjs";
import { loadSettings } from "../src/settings.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.join(projectRoot, "data", "test-runs", `download-template-${Date.now()}`);
const sourceDir = path.join(rootDir, "fixtures");
mkdirSync(sourceDir, { recursive: true });

const sourcePath = path.join(sourceDir, "source.webp");
writeFileSync(sourcePath, "image", "utf8");

const settings = loadSettings(rootDir);
settings.download.nameFormat = "{date}-{brand}-{author}-{title}-{tags}-{likes}-{comments}-{collects}-{shares}-{index}-{kind}";
writeFileSync(path.join(rootDir, "data", "settings.json"), JSON.stringify(settings, null, 2), "utf8");

const saved = await persistNoteAssets(rootDir, {
  id: "note-id",
  noteId: "note-id",
  sourceUrl: "https://www.xiaohongshu.com/explore/note-id",
  brand: "Bella/ISLA",
  authorName: "测试作者",
  title: "模板测试标题",
  description: "用于测试文件命名模板",
  publishedAt: "2026-06-08T01:23:45.000Z",
  contentType: "图文笔记",
  tags: ["月子", "疗愈"],
  metrics: {
    likedCount: "123",
    commentCount: "45",
    collectedCount: "67",
    shareCount: "8"
  },
  assets: [
    {
      kind: "image",
      sourceUrl: pathToFileURL(sourcePath).toString()
    }
  ]
});

const fileName = saved[0]?.fileName || "";
const expected = "20260608-Bella_ISLA-测试作者-模板测试标题-月子-疗愈-123-45-67-8-01-image.webp";
if (fileName !== expected) {
  throw new Error(`文件命名模板结果不符合预期：${fileName}`);
}

const localPath = saved[0]?.localPath ? path.join(rootDir, saved[0].localPath) : "";
if (!localPath || !existsSync(localPath)) {
  throw new Error(`模板测试文件未保存：${localPath}`);
}

console.log(JSON.stringify({ ok: true, fileName, localPath: saved[0].localPath }, null, 2));
