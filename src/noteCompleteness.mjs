function parseRaw(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return typeof raw === "object" ? raw : {};
}

function countExpectedFromRaw(raw) {
  const expected = raw.assetIntegrity?.expected || raw.expected || {};
  const imageCount = Number(raw.imageCount || raw.imagesCount || 0);
  const livePhotoCount = Number(raw.livePhotoCount || raw.liveCount || 0);
  const videoCount = Number(raw.videoCount || raw.videosCount || 0);
  const assetCount = Number(raw.assetCount || 0);
  return {
    images: Number(expected.images ?? imageCount) || 0,
    livePhotos: Number(expected.livePhotos ?? livePhotoCount) || 0,
    videos: Number(expected.videos ?? videoCount) || 0,
    total: Number(expected.total ?? assetCount) || 0
  };
}

function countExpectedFromAssets(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return {
    images: list.filter((asset) => asset.kind === "image").length,
    livePhotos: list.filter((asset) => asset.kind === "livePhoto").length,
    videos: list.filter((asset) => asset.kind === "video").length,
    total: list.filter((asset) => ["image", "livePhoto", "video"].includes(asset.kind)).length
  };
}

function countSavedAssets(assets) {
  const saved = (assets || []).filter((asset) => {
    if (!asset || asset.status === "失败" || asset.status === "需人工复核") return false;
    return Boolean(asset.localPath);
  });
  return {
    images: saved.filter((asset) => asset.kind === "image").length,
    livePhotos: saved.filter((asset) => asset.kind === "livePhoto").length,
    videos: saved.filter((asset) => asset.kind === "video").length,
    total: saved.length
  };
}

function missingCounts(expected, saved) {
  return {
    images: Math.max(0, expected.images - saved.images),
    livePhotos: Math.max(0, expected.livePhotos - saved.livePhotos),
    videos: Math.max(0, expected.videos - saved.videos),
    total: Math.max(0, (expected.total || expected.images + expected.livePhotos + expected.videos) - saved.total)
  };
}

export function buildAssetIntegrity(note, persistedAssets = []) {
  const raw = parseRaw(note?.raw);
  const expectedFromRaw = countExpectedFromRaw(raw);
  const expectedFromAssets = countExpectedFromAssets(note?.assets || []);
  const expected = {
    images: expectedFromRaw.images || expectedFromAssets.images,
    livePhotos: expectedFromRaw.livePhotos || expectedFromAssets.livePhotos,
    videos: expectedFromRaw.videos || expectedFromAssets.videos,
    total: expectedFromRaw.total || expectedFromAssets.total
  };
  if (!expected.total) expected.total = expected.images + expected.livePhotos + expected.videos;

  const saved = countSavedAssets(persistedAssets);
  const missing = missingCounts(expected, saved);
  const complete = expected.total > 0 && missing.images === 0 && missing.livePhotos === 0 && missing.videos === 0 && missing.total === 0;
  const detailReady = expected.total > 0;
  const hasFailures = (persistedAssets || []).some((asset) => asset?.status === "失败" || asset?.status === "需人工复核");

  let status = "详情待补全";
  let reviewReason = "尚未确认笔记详情中的真实素材数量";
  if (complete) {
    status = "完整入库";
    reviewReason = "";
  } else if (detailReady && saved.total > 0) {
    status = "部分入库";
    reviewReason = `缺少素材：图片 ${missing.images}，Live ${missing.livePhotos}，视频 ${missing.videos}`;
  } else if (detailReady && hasFailures) {
    status = "素材下载失败";
    reviewReason = "详情已抓取，但素材未成功落盘";
  } else if (detailReady) {
    status = "素材待下载";
    reviewReason = "详情已抓取，但素材尚未成功落盘";
  }

  return {
    raw: {
      ...raw,
      expected,
      saved,
      missing,
      assetIntegrity: {
        expected,
        saved,
        missing,
        complete,
        detailReady,
        checkedAt: new Date().toISOString()
      }
    },
    status,
    reviewReason
  };
}

export function shouldRepairNoteAssets(note, storage) {
  if (!note) return false;
  const raw = parseRaw(note.raw);
  const assets = note.id && storage?.listAssetsByNote ? (storage.listAssetsByNote(note.id) || []) : (note.assets || []);
  const saved = countSavedAssets(assets);
  const hasFailedAsset = assets.some((asset) => asset?.status === "失败" || asset?.status === "需人工复核" || (!asset?.localPath && asset?.sourceUrl));
  const isImageLike = note.contentType === "图文笔记" || note.contentType === "Live图文";

  if (raw.source === "html:fallback") return true;
  if (raw.assetIntegrity && raw.assetIntegrity.complete === false) return true;
  if (isImageLike && !raw.assetIntegrity && !raw.expected) return true;
  if (hasFailedAsset) return true;
  if (isImageLike) {
    if (saved.images === 0) return true;
    if (saved.images <= 1 && !raw.repairCheckedAt) return true;
  }
  return false;
}

export function isNoteComplete(note, storage) {
  if (!note) return false;
  const raw = parseRaw(note.raw);
  if (raw.source === "html:fallback") return false;
  if (raw.assetIntegrity) return raw.assetIntegrity.complete === true;

  const assets = note.id && storage?.listAssetsByNote ? (storage.listAssetsByNote(note.id) || []) : (note.assets || []);
  const saved = countSavedAssets(assets);
  const expected = countExpectedFromRaw(raw);

  if (note.contentType === "图文笔记" || note.contentType === "Live图文") {
    if (expected.images > 0) return saved.images >= expected.images;
    if (expected.total > 0) return saved.total >= expected.total;
    return false;
  }

  if (note.contentType === "视频笔记") {
    if (expected.videos > 0) return saved.videos >= expected.videos;
    return false;
  }

  if (expected.total > 0) return saved.total >= expected.total;
  return note.status === "完整入库";
}
