import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { envWithSettings } from "../settings.mjs";
import { readXhsCookie } from "../xhsAuth.mjs";
import {
  extractXhsId, isAccountUrl, classifyUrl, cleanAssetUrl, watermarkStatus,
  normalizeStructuredAssets, bestImageUrl, bestStreamUrl,
  isLoginPage, isBlockedPage, isCaptchaPage, isUnavailablePage,
  normalizeIndexes, filterByIndexes, dedupeVideos,
  attachResponseCollector, collectAssetsFromBodies,
  sleep, isUiAsset, uniqueByUrl, parseInitState
} from "../xhsSdk.mjs";

function uniqueByAssets(items) {
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

function extractVideoStreamAssets(stream) {
  if (!stream || typeof stream !== "object") return [];
  const assets = [];
  for (const codec of ["h264", "h265", "h266", "av1"]) {
    const variants = Array.isArray(stream[codec]) ? stream[codec] : [];
    for (const variant of variants) {
      if (!variant) continue;
      const url = cleanAssetUrl(variant.masterUrl || variant.master_url || (Array.isArray(variant.backupUrls) ? variant.backupUrls[0] : Array.isArray(variant.backup_urls) ? variant.backup_urls[0] : "") || "");
      if (!url) continue;
      const w = variant.width || variant.resolution?.width || null;
      const h = variant.height || variant.resolution?.height || null;
      assets.push({
        kind: "video", url, sourceUrl: url, width: w, height: h,
        resolution: w && h ? `${w}x${h}` : "",
        bitrate: variant.bitrate || variant.videoBitrate || variant.bitRate || variant.bit_rate || null,
        fileSize: variant.fileSize || variant.size || variant.file_size || null,
        source: "initial-state:video.stream",
        watermarkStatus: watermarkStatus(url),
        fileId: variant.fileId || "", traceId: variant.traceId || "",
        livePhoto: false, imageIndex: null, pairedImageIndex: null
      });
    }
  }
  return assets;
}

function hasUsableAssets(note) {
  if (!note || !note.assets) return false;
  return note.assets.some(a => a.kind === "image" || a.kind === "video" || a.kind === "livePhoto");
}

function errorMeta(input, extracted, reason, extra) {
  return {
    platform: "小红书", sourceUrl: input.url, noteId: extractXhsId(input.url),
    accountId: input.accountId || null, brand: input.brand || "",
    title: "", description: "", authorName: "", contentType: "待复核",
    marketingGoal: "", sellingPoints: [], visualStyle: "",
    tags: input.tags || [], metrics: {}, status: "需人工复核",
    reviewReason: reason, assets: [], raw: { ...extra, bodyText: extracted.bodyText }
  };
}

async function extractNote(page, input, networkBodies = [], videoPreference = "resolution", videoMinHeight = 0) {
  const extracted = await page.evaluate(() => {
    const meta = (name) => document.querySelector(`meta[property="${name}"]`)?.content || document.querySelector(`meta[name="${name}"]`)?.content || "";
    const textOf = (selectors) => {
      for (const selector of selectors) {
        const value = document.querySelector(selector)?.textContent?.trim();
        if (value) return value;
      }
      return "";
    };
    const scripts = Array.from(document.scripts).map((script) => script.textContent || "").join("\n");
    const html = document.documentElement.innerHTML;
    const urlRegex = /https?:\/\/[^"'<>\s\\]+/g;
    const scriptUrls = Array.from((scripts + "\n" + html).matchAll(urlRegex)).map((match) => match[0]);
    const domImages = Array.from(document.images).map((img) => ({
      kind: "image", url: img.currentSrc || img.src, width: img.naturalWidth || null, height: img.naturalHeight || null, source: "dom"
    }));
    const domVideos = Array.from(document.querySelectorAll("video, video source")).map((node) => ({
      kind: "video", url: node.currentSrc || node.src, width: node.videoWidth || null, height: node.videoHeight || null, source: "dom"
    }));
    const noteDetailMap = window.__INITIAL_STATE__?.note?.noteDetailMap || {};
    const noteDetails = Object.values(noteDetailMap).map((item) => item?.note || item).filter(Boolean);
    const structuredNote = noteDetails.find((item) => item?.noteId && location.href.includes(item.noteId)) || noteDetails[0] || null;
    const structuredImages = Array.isArray(structuredNote?.imageList)
      ? structuredNote.imageList.map((image) => ({
          fileId: image.fileId || "", width: image.width || null, height: image.height || null,
          url: image.url || "", urlPre: image.urlPre || "", urlDefault: image.urlDefault || "",
          livePhoto: Boolean(image.livePhoto), traceId: image.traceId || "",
          infoList: Array.isArray(image.infoList) ? image.infoList.map((item) => ({ imageScene: item?.imageScene || "", url: item?.url || "" })) : [],
          stream: image.stream || null
        }))
      : [];
    const videoInfo = structuredNote?.video || {};
    const videoStream = videoInfo.media?.stream || videoInfo.consumerInfo?.stream || null;
    const text = document.body?.innerText || "";
    return {
      canonicalUrl: location.href,
      title: structuredNote?.title || meta("og:title") || textOf(["#detail-title", ".title", "h1"]) || document.title,
      description: structuredNote?.desc || meta("og:description") || textOf(["#detail-desc", ".desc", ".content"]),
      authorName: structuredNote?.user?.nickname || textOf([".username", ".user-name", ".nickname", ".author"]),
      authorId: structuredNote?.user?.user_id || structuredNote?.user?.userId || "",
      noteType: structuredNote?.type || "",
      createdAt: structuredNote?.time || null,
      metrics: structuredNote?.interactInfo || {},
      tags: Array.isArray(structuredNote?.tagList) ? structuredNote.tagList.map((item) => item?.name || item).filter(Boolean) : [],
      structuredImages, structuredVideo: videoStream, images: domImages, videos: domVideos, scriptUrls,
      bodyText: text.slice(0, 5000)
    };
  });

  const scriptAssets = extracted.scriptUrls.map((url) => ({
    kind: classifyUrl(url), url: cleanAssetUrl(url), source: "page-data"
  })).filter((asset) => asset.kind !== "unknown");
  const structuredAssets = normalizeStructuredAssets({ imageList: extracted.structuredImages });
  const videoStreamAssets = extractVideoStreamAssets(extracted.structuredVideo);
  if (videoStreamAssets.length) structuredAssets.push(...videoStreamAssets);
  const hasStructuredImages = structuredAssets.some((asset) => asset.kind === "image");
  const networkAssets = collectAssetsFromBodies(networkBodies);
  const fallbackAssets = [...extracted.images, ...extracted.videos, ...scriptAssets, ...networkAssets]
    .filter((asset) => !(hasStructuredImages && (asset.kind || classifyUrl(asset.url || "")) === "image"));

  if (isBlockedPage(extracted)) return errorMeta(input, extracted, "小红书返回安全限制页面：IP存在风险，请切换可靠网络环境后重试，或在本机正常登录后使用可访问的网络环境采集。", { canonicalUrl: extracted.canonicalUrl, blockedDetected: true });
  if (isCaptchaPage(extracted)) return errorMeta(input, extracted, "小红书返回验证码/风控页面，需要真人验证。请尝试使用已登录的浏览器打开链接，或切换网络环境后重试。", { canonicalUrl: extracted.canonicalUrl, captchaDetected: true });
  if (isLoginPage(extracted)) return errorMeta(input, extracted, "当前页面返回小红书登录页。请先在弹出的浏览器中正常登录，或在工具中保存有效 Cookie 后重新采集。", { canonicalUrl: extracted.canonicalUrl, loginDetected: true });
  if (isUnavailablePage(extracted)) return errorMeta(input, extracted, "小红书返回当前笔记暂时无法浏览，该链接可能需要最新分享链接、登录态或可访问网络环境。", { canonicalUrl: extracted.canonicalUrl, unavailableDetected: true });

  const allAssets = uniqueByAssets([...structuredAssets, ...fallbackAssets])
    .filter((asset) => /^https?:\/\//.test(asset.url))
    .filter((asset) => !isUiAsset(asset.url))
    .map((asset) => ({
      kind: asset.kind || classifyUrl(asset.url), sourceUrl: cleanAssetUrl(asset.url),
      url: cleanAssetUrl(asset.url), width: asset.width || null, height: asset.height || null,
      resolution: asset.width && asset.height ? `${asset.width}x${asset.height}` : "",
      bitrate: asset.bitrate || null, fileSize: asset.fileSize || null,
      watermarkStatus: watermarkStatus(asset.url), source: asset.source || "unknown",
      imageIndex: asset.imageIndex || null, pairedImageIndex: asset.pairedImageIndex || null,
      livePhoto: Boolean(asset.livePhoto), fileId: asset.fileId || "", traceId: asset.traceId || ""
    }));

  const requestedIndexes = normalizeIndexes(input.index);
  const images = filterByIndexes(allAssets.filter((a) => a.kind === "image"), requestedIndexes).slice(0, 80);
  const livePhotos = filterByIndexes(allAssets.filter((a) => a.kind === "livePhoto"), requestedIndexes).slice(0, 20);
  const rawVideos = allAssets.filter((a) => a.kind === "video").filter((v) => {
    if (!videoMinHeight || videoMinHeight <= 0) return true;
    return Number(v.height || v.resolution?.height || 0) >= videoMinHeight;
  });
  const dedupedVideos = dedupeVideos(rawVideos, videoPreference);
  const likelyLivePhoto = !livePhotos.length && images.length >= 6 && dedupedVideos.length > 0;
  const bestVideos = livePhotos.length ? [] : likelyLivePhoto ? dedupedVideos.slice(0, 12) : dedupedVideos.slice(0, 1);
  const status = images.length || bestVideos.length || livePhotos.length ? "已入库" : "需人工复核";

  return {
    platform: "小红书", sourceUrl: input.url, noteId: extractXhsId(input.url),
    accountId: input.accountId || null, brand: input.brand || "",
    title: extracted.title || "未命名笔记", description: extracted.description || "",
    authorName: extracted.authorName || "", authorId: extracted.authorId || "",
    publishedAt: extracted.createdAt ? new Date(Number(extracted.createdAt)).toISOString() : "",
    contentType: livePhotos.length || likelyLivePhoto ? "Live图文" : bestVideos.length ? "视频笔记" : "图文笔记",
    marketingGoal: "", sellingPoints: [], visualStyle: "",
    tags: Array.from(new Set([...(input.tags || []), ...(extracted.tags || [])])),
    metrics: extracted.metrics || {}, status,
    reviewReason: status === "需人工复核" ? "未在页面中发现可直接访问的图片或视频资源" : "",
    raw: { canonicalUrl: extracted.canonicalUrl, bodyText: extracted.bodyText, assetCandidateCount: allAssets.length, imageCount: images.length, videoCount: bestVideos.length, livePhotoCount: livePhotos.length, likelyLivePhoto, structuredImageCount: extracted.structuredImages?.length || 0 },
    assets: [...images, ...livePhotos, ...bestVideos]
  };
}

async function fetchNoteViaHttp(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const settings = envWithSettings(rootDir);
  const videoPreference = options.videoPreference || settings.download.videoPreference || "resolution";
  const videoMinHeight = options.videoMinHeight || settings.download.videoMinHeight || 0;
  let cookie = options.cookie || input.cookie || readXhsCookie(rootDir) || "";

  let url = input.url;
  if (!url) return null;

  // 1. 短链 HEAD 极速预检解析
  if (url.includes("xhslink.com")) {
    const headController = new AbortController();
    const headTimer = setTimeout(() => headController.abort(), 3000);
    try {
      const headRes = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: headController.signal
      });
      const location = headRes.headers.get("location");
      if (location) {
        // 兼容相对路径重定向（如 /explore/xxxxx）
        url = location.startsWith("http") ? location : new URL(location, "https://www.xiaohongshu.com").href;
      }
    } catch (headErr) {
      console.warn("[fetchNoteViaHttp] HEAD 短链预解析失败:", headErr.message);
    } finally {
      clearTimeout(headTimer);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const fetchWithParams = async (useCookie) => {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.xiaohongshu.com/",
      };
      if (useCookie) headers.Cookie = useCookie;
      const res = await fetch(url, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      const html = await res.text();
      return { status: res.status, html };
    };

    let { status: fetchStatus, html } = await fetchWithParams(cookie);

    // 2. 双重 WAF 风控裸奔尝试：若请求被安全限制或登录拦截，且之前带了 Cookie，则尝试清除 Cookie 裸跑一次
    const isBlocked = (code, text) => {
      return code !== 200 || text.includes("安全限制") || text.includes("手机号登录");
    };

    if (isBlocked(fetchStatus, html) && cookie) {
      console.log("[fetchNoteViaHttp] 携带 Cookie 请求受阻，自动清除 Cookie 尝试免登录裸跑重试...");
      try {
        const retryResult = await fetchWithParams("");
        if (!isBlocked(retryResult.status, retryResult.html)) {
          fetchStatus = retryResult.status;
          html = retryResult.html;
          console.log("[fetchNoteViaHttp] 免登录裸跑重试成功！已成功绕过风控拦截。");
        }
      } catch (retryErr) {
        console.warn("[fetchNoteViaHttp] 免登录裸跑重试发生网络错误:", retryErr.message);
      }
    }

    if (fetchStatus !== 200) return null;
    if (html.includes("安全限制") || html.includes("手机号登录") || html.includes("你访问的页面不见了") || html.includes("当前笔记暂时无法浏览")) return null;

    const state = parseInitState(html);
    if (!state) return null;

    const getNote = () => {
      const pc = state?.note?.noteDetailMap;
      if (pc) {
        const entries = Object.values(pc).map(n => n?.note || n).filter(Boolean);
        const found = entries.find(n => n?.title) || entries.find(n => n?.noteId);
        if (found) return found;
      }
      const mobile = state?.noteData?.data?.noteData;
      if (mobile?.title) return mobile;
      return null;
    };
    const noteData = getNote();
    if (!noteData) return null;

    const imageList = Array.isArray(noteData.imageList) ? noteData.imageList : [];
    const hasVideo = Boolean(noteData.video);
    const assets = [];
    for (let i = 0; i < imageList.length; i++) {
      const img = imageList[i];
      const imgUrl = cleanAssetUrl(bestImageUrl(img));
      if (imgUrl) {
        assets.push({
          kind: "image", url: imgUrl, sourceUrl: imgUrl,
          width: img.width || null, height: img.height || null,
          resolution: img.width && img.height ? `${img.width}x${img.height}` : "",
          watermarkStatus: watermarkStatus(imgUrl),
          source: "http:init-state", imageIndex: i + 1,
          fileId: img.fileId || "", traceId: img.traceId || "",
          livePhoto: Boolean(img.livePhoto), pairedImageIndex: null, bitrate: null, fileSize: null,
        });
      }
      if (img.livePhoto) {
        const streamUrl = cleanAssetUrl(bestStreamUrl(img.stream));
        if (streamUrl) {
          assets.push({
            kind: "livePhoto", url: streamUrl, sourceUrl: streamUrl,
            width: img.width || null, height: img.height || null,
            resolution: img.width && img.height ? `${img.width}x${img.height}` : "",
            watermarkStatus: watermarkStatus(streamUrl),
            source: "http:init-state", imageIndex: i + 1, pairedImageIndex: i + 1,
            fileId: img.fileId || "", traceId: img.traceId || "",
            livePhoto: true, bitrate: null, fileSize: null,
          });
        }
      }
    }
    if (hasVideo && noteData.video && typeof noteData.video === "object") {
      const streamAssets = extractVideoStreamAssets(noteData.video.media?.stream || noteData.video.consumerInfo?.stream);
      const consumer = noteData.video.consumer || noteData.video.consumerInfo || {};
      if (consumer.originVideoKey) {
        const directUrl = `https://sns-video-bd.xhscdn.com/${consumer.originVideoKey}`;
        streamAssets.unshift({
          kind: "video", url: directUrl, sourceUrl: directUrl,
          width: null, height: null, resolution: "",
          bitrate: null, fileSize: null,
          watermarkStatus: watermarkStatus(directUrl),
          source: "http:originVideoKey",
          fileId: "", traceId: "", livePhoto: false, imageIndex: null, pairedImageIndex: null,
        });
      }
      const deduped = dedupeVideos(streamAssets, videoPreference);
      const filtered = deduped.filter(v => {
        if (!videoMinHeight || videoMinHeight <= 0) return true;
        return Number(v.height || 0) >= videoMinHeight;
      });
      assets.push(...filtered.slice(0, 1));
    }

    const authorName = noteData.user?.nickname || noteData.user?.nickName || "";
    const authorId = noteData.user?.userId || noteData.user?.user_id || "";
    const metrics = noteData.interactInfo || {};
    const title = noteData.title || "未命名笔记";
    const hasLivePhoto = assets.some((asset) => asset.kind === "livePhoto");
    // 修复：纯视频笔记（无 imageList）时正确标记为视频笔记，而非待复核
    const contentType = hasLivePhoto ? "Live图文" : hasVideo ? "视频笔记" : imageList.length ? "图文笔记" : "待复核";
    const status = assets.length ? "已入库" : "需人工复核";

    return [{
      platform: "小红书", sourceUrl: url, noteId: extractXhsId(url),
      accountId: input.accountId || null, brand: input.brand || "",
      title, description: noteData.desc || "",
      authorName, authorId,
      publishedAt: noteData.time ? new Date(Number(noteData.time)).toISOString() : "",
      contentType,
      marketingGoal: "", sellingPoints: [], visualStyle: "",
      tags: Array.from(new Set([...(input.tags || []), ...(Array.isArray(noteData.tagList) ? noteData.tagList.map(t => t.name || t).filter(Boolean) : [])])),
      metrics, status,
      reviewReason: status === "需人工复核" ? "HTTP快速路径未发现可直接访问的资源" : "",
      raw: { source: "http:init-state", noteId: noteData.noteId, imageCount: imageList.length, assetCount: assets.length },
      assets: assets.map((asset) => ({ ...asset, sourceUrl: asset.sourceUrl || asset.url || "" })),
    }];
  } catch (e) {
    console.warn("[fetchNoteViaHttp] 请求失败:", e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export { uniqueByAssets, extractVideoStreamAssets, hasUsableAssets, extractNote, fetchNoteViaHttp };
