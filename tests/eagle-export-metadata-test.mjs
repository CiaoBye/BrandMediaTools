import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "../src/storage.mjs";
import { exportForEagle } from "../src/eagleExporter.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.join(projectRoot, "data", "test-runs", `eagle-${Date.now()}`);
const storage = new Storage(rootDir);

const libraryDir = path.join(rootDir, "data", "library", "brand", "author", "note-1");
mkdirSync(libraryDir, { recursive: true });
writeFileSync(path.join(libraryDir, "01-image.webp"), "image", "utf8");
writeFileSync(path.join(libraryDir, "02-livePhoto.mp4"), "video", "utf8");

const note = storage.upsertNote({
  platform: "小红书",
  sourceUrl: "https://www.xiaohongshu.com/explore/test-note",
  noteId: "test-note",
  brand: "测试品牌",
  authorName: "测试作者",
  title: "Live 图导出测试",
  contentType: "Live图文",
  tags: ["Live图"],
  metrics: {},
  status: "已入库",
  assets: []
});

storage.addAssets(note.id, [
  {
    kind: "image",
    sourceUrl: "https://example.com/01.webp",
    localPath: "data/library/brand/author/note-1/01-image.webp",
    fileName: "01-image.webp",
    fileSize: 5,
    width: 720,
    height: 960,
    resolution: "720x960",
    status: "已保存",
    watermarkStatus: "原始候选",
    imageIndex: 1,
    livePhoto: true,
    source: "initial-state:imageList"
  },
  {
    kind: "livePhoto",
    sourceUrl: "https://example.com/02.mp4",
    localPath: "data/library/brand/author/note-1/02-livePhoto.mp4",
    fileName: "02-livePhoto.mp4",
    fileSize: 5,
    width: 720,
    height: 960,
    resolution: "720x960",
    status: "已保存",
    watermarkStatus: "原始候选",
    pairedImageIndex: 1,
    livePhoto: true,
    source: "initial-state:imageList.stream"
  }
]);

const hydrated = storage.getNote(note.id);
const liveAsset = hydrated.assets.find((asset) => asset.kind === "livePhoto");
if (liveAsset?.pairedImageIndex !== 1) {
  throw new Error(`Live 图配对序号未入库：${JSON.stringify(liveAsset)}`);
}

const result = exportForEagle(rootDir, [hydrated]);
const exported = result.exported[0];
const metadataPath = path.join(rootDir, exported.folder, "eagle-metadata.json");
if (!existsSync(metadataPath)) {
  throw new Error("Eagle metadata 未生成");
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
const pair = metadata.livePhotoPairs?.[0];
if (pair?.imageIndex !== 1 || pair?.imageFile !== "01-image.webp" || pair?.livePhotoFile !== "02-livePhoto.mp4") {
  throw new Error(`Eagle Live 图配对元数据错误：${JSON.stringify(metadata.livePhotoPairs)}`);
}

console.log(JSON.stringify({ ok: true, exportRoot: result.exportRoot, livePhotoPairs: metadata.livePhotoPairs }, null, 2));
