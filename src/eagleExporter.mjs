import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function safeName(value) {
  return String(value || "未命名")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "未命名";
}

import { beijingNow } from "./time.mjs";
function stamp() {
  return beijingNow().replace(/[:.]/g, "-").slice(0, 19);
}

export function exportForEagle(rootDir, notes) {
  const exportRoot = path.join(rootDir, "data", "eagle-export", stamp());
  mkdirSync(exportRoot, { recursive: true });
  const exported = [];

  for (const note of notes) {
    const folder = path.join(
      exportRoot,
      safeName(note.brand || "未分组品牌"),
      safeName(note.authorName || "未知作者"),
      safeName(note.title || note.noteId || note.id)
    );
    mkdirSync(folder, { recursive: true });
    const copied = [];
    const assetMetadata = [];

    for (const asset of note.assets || []) {
      if (!asset.localPath) continue;
      const source = path.join(rootDir, asset.localPath);
      if (!existsSync(source)) continue;
      const target = path.join(folder, asset.fileName || path.basename(source));
      copyFileSync(source, target);
      const exportPath = path.relative(rootDir, target).replaceAll("\\", "/");
      copied.push(exportPath);
      assetMetadata.push({
        kind: asset.kind,
        fileName: asset.fileName || path.basename(source),
        exportPath,
        sourceUrl: asset.sourceUrl,
        localPath: asset.localPath,
        fileSize: asset.fileSize,
        width: asset.width,
        height: asset.height,
        resolution: asset.resolution,
        mimeType: asset.mimeType,
        status: asset.status,
        watermarkStatus: asset.watermarkStatus,
        imageIndex: asset.imageIndex || null,
        pairedImageIndex: asset.pairedImageIndex || null,
        livePhoto: Boolean(asset.livePhoto),
        fileId: asset.fileId || "",
        traceId: asset.traceId || "",
        source: asset.raw?.source || ""
      });
    }

    const livePhotoPairs = assetMetadata
      .filter((asset) => asset.kind === "livePhoto" && asset.pairedImageIndex)
      .map((asset) => ({
        imageIndex: asset.pairedImageIndex,
        livePhotoFile: asset.fileName,
        livePhotoExportPath: asset.exportPath,
        imageFile: assetMetadata.find((item) => item.kind === "image" && item.imageIndex === asset.pairedImageIndex)?.fileName || ""
      }));

    writeFileSync(
      path.join(folder, "eagle-metadata.json"),
      JSON.stringify(
        {
          title: note.title,
          url: note.sourceUrl,
          tags: note.tags || [],
          brand: note.brand,
          author: note.authorName,
          contentType: note.contentType,
          marketingGoal: note.marketingGoal,
          visualStyle: note.visualStyle,
          description: note.description,
          analysis: note.analysis || null,
          assets: copied,
          assetMetadata,
          livePhotoPairs
        },
        null,
        2
      ),
      "utf8"
    );
    exported.push({ noteId: note.id, folder: path.relative(rootDir, folder).replaceAll("\\", "/"), fileCount: copied.length });
  }

  return {
    exportRoot: path.relative(rootDir, exportRoot).replaceAll("\\", "/"),
    exported
  };
}
