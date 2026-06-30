import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { envWithSettings } from "../settings.mjs";
import { readXhsCookie } from "../xhsAuth.mjs";
import { URL } from "node:url";
import {
  extractXhsId, isAccountUrl, classifyUrl, cleanAssetUrl, watermarkStatus,
  normalizeStructuredAssets, bestImageUrl, bestImageUrls, bestStreamUrl, bestVideoStreams,
  isLoginPage, isBlockedPage, isCaptchaPage, isUnavailablePage,
  normalizeIndexes, filterByIndexes, dedupeVideos,
  attachResponseCollector, collectAssetsFromBodies,
  sleep, isUiAsset, uniqueByUrl, parseInitState, extractImageToken, buildCdnImageUrl, extractCoverImage
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

/**
 * Extract og:image and og:video from HTML as last-resort fallback assets.
 */
function extractHtmlFallbackAssets(html, noteId) {
  if (!html || typeof html !== "string") return { note: null, assets: [] };
  const assets = [];
  function getContent(prop) {
    const re1 = new RegExp("<meta[^>]+(?:property|name)=\"" + prop + "\"[^>]+content=\"([^\"]*)\"");
    const m1 = html.match(re1);
    if (m1) return m1[1];
    const re2 = new RegExp("<meta[^>]+content=\"([^\"]*)\"" + "[^>]+(?:property|name)=\"" + prop + "\"");
    const m2 = html.match(re2);
    return m2 ? m2[1] : "";
  }
  const ogImage = getContent("og:image");
  const ogVideo = getContent("og:video");
  const ogTitle = getContent("og:title");
  const ogDesc = getContent("og:description");
  const ogUrl = getContent("og:url");

  if (ogImage) {
    assets.push({
      kind: "image", url: cleanAssetUrl(ogImage), sourceUrl: cleanAssetUrl(ogImage),
      width: null, height: null, resolution: "",
      watermarkStatus: watermarkStatus(ogImage),
      source: "html:og:image", imageIndex: null, fileId: "", traceId: "",
      livePhoto: false, pairedImageIndex: null, bitrate: null, fileSize: null
    });
  }
  if (ogVideo) {
    assets.push({
      kind: "video", url: cleanAssetUrl(ogVideo), sourceUrl: cleanAssetUrl(ogVideo),
      width: null, height: null, resolution: "",
      watermarkStatus: watermarkStatus(ogVideo),
      source: "html:og:video", fileId: "", traceId: "",
      livePhoto: false, imageIndex: null, pairedImageIndex: null, bitrate: null, fileSize: null
    });
  }
  const noteMeta = {};
  if (ogTitle) noteMeta.title = ogTitle;
  if (ogDesc) noteMeta.description = ogDesc;
  if (ogUrl) noteMeta.sourceUrl = ogUrl;
  return { note: Object.keys(noteMeta).length ? noteMeta : null, assets };
}

/**
 * Try to fetch note HTML with different URL formats for xsec_token resilience.
 */
async function tryFetchUrlVariants(baseUrl, noteId, headers, signal) {
  const variants = [baseUrl];
  if (!baseUrl.includes("xsec_token")) {
    variants.push("https://www.xiaohongshu.com/discovery/item/" + noteId);
  }
  if (!baseUrl.includes("xsec_source")) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    variants.push(baseUrl + sep + "xsec_source=pc_note");
  }
  for (const variantUrl of variants) {
    try {
      const resp = await fetch(variantUrl, { headers, redirect: "follow", signal });
      if (resp.status !== 200) continue;
      const html = await resp.text();
      if (!html || html.includes("安全限制") || html.includes("手机号登录") || html.includes("你访问的页面不见了")) continue;
      return { html, url: variantUrl };
    } catch { continue; }
  }
  return null;
}


async function fetchNoteViaHttp(input$1, options$1 = {}) {
  const rootDir$1 = options$1.rootDir || process.cwd();
  const settings = envWithSettings(rootDir$1);
  const videoPreference$1 = options$1.videoPreference || settings.download.videoPreference || "resolution";
  const videoMinHeight$1 = options$1.videoMinHeight || settings.download.videoMinHeight || 0;
  const cookie$1 = options$1.cookie || input$1.cookie || readXhsCookie(rootDir$1) || "";
  let url$1 = input$1.url;
  if (!url$1) return null;
  if (url$1.includes("xhslink.com")) {
    try {
      const mod = await import("../xhsSdk.mjs");
      const resolved = await mod.resolveShortLink(url$1);
      if (resolved && resolved.finalUrl) {
        url$1 = resolved.finalUrl;
        console.log("[fetchNoteViaHttp] 短链解析成功:", url$1, "(" + resolved.hops + " hops)");
      }
    } catch (e) { console.warn("[fetchNoteViaHttp] 短链预解析失败:", e.message); }
  }
  const controller$1 = new AbortController();
  const timer$1 = setTimeout(() => controller$1.abort(), 15000);
  try {
    const noteId$1 = extractXhsId(url$1) || "";
    const fetchWithParams$1 = async (useCookie, mode) => {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.xiaohongshu.com/"
      };
      if (useCookie) headers.Cookie = useCookie;
      const res = await fetch(url$1, { headers, redirect: "follow", signal: controller$1.signal });
      return { status: res.status, html: await res.text(), mode };
    };
    const isBlocked$1 = (code, text) => code !== 200 || text.includes("安全限制") || text.includes("手机号登录");
    const getNote$1 = (state) => {
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
    const buildFallbackNoteResult$1 = (ogAssets, ogNote, mode) => {
      const contentType$1 = ogAssets.some(a => a.kind === "video") ? "视频笔记" : ogAssets.some(a => a.kind === "image") ? "图文笔记" : "待复核";
      const status$1 = ogAssets.length ? "已入库" : "需人工复核";
      return {
        platform: "小红书", sourceUrl: url$1, noteId: noteId$1,
        accountId: input$1.accountId || null, brand: input$1.brand || "",
        title: ogNote?.title || "未命名笔记", description: ogNote?.description || "",
        authorName: "", authorId: "", publishedAt: "",
        contentType: contentType$1, marketingGoal: "", sellingPoints: [], visualStyle: "",
        tags: [], metrics: {}, status: status$1,
        ipLocation: null, lastUpdateTime: null, cover: null, shareInfo: null,
        reviewReason: status$1 === "需人工复核" ? "公开页 HTML 路径未发现可直接访问的资源" : "",
        raw: { source: "html:fallback", acquisitionMode: mode, authUsed: mode === "cookie", noteId: noteId$1, imageCount: 0, assetCount: ogAssets.length },
        assets: ogAssets.map((a) => ({ ...a, sourceUrl: a.sourceUrl || a.url || "" }))
      };
    };
    async function tryMultiUrlFallback$1(useCookie, mode) {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.xiaohongshu.com/"
      };
      if (useCookie) headers.Cookie = useCookie;
      const result = await tryFetchUrlVariants(url$1, noteId$1, headers, controller$1.signal);
      if (!result) return null;
      url$1 = result.url;
      return { status: 200, html: result.html, mode };
    }
    const buildNoteResult$1 = (noteData, mode) => {
      const imageList = Array.isArray(noteData.imageList) ? noteData.imageList : [];
      const hasVideo$1 = Boolean(noteData.video);
      const assets$1 = [];
      for (let i = 0; i < imageList.length; i++) {
        const img = imageList[i];
        const imgUrl = cleanAssetUrl(bestImageUrl(img));
        if (imgUrl) {
          assets$1.push({
            kind: "image", url: imgUrl, sourceUrl: imgUrl,
            width: img.width || null, height: img.height || null,
            resolution: img.width && img.height ? img.width + "x" + img.height : "",
            cdnToken: extractImageToken(imgUrl) || "",
            watermarkStatus: watermarkStatus(imgUrl),
            source: "http:init-state", imageIndex: i + 1,
            fileId: img.fileId || "", traceId: img.traceId || "",
            livePhoto: Boolean(img.livePhoto), pairedImageIndex: null, bitrate: null, fileSize: null
          });
        }
        if (img.livePhoto) {
          const streamUrl = cleanAssetUrl(bestStreamUrl(img.stream));
          if (streamUrl) {
            assets$1.push({
              kind: "livePhoto", url: streamUrl, sourceUrl: streamUrl,
              width: img.width || null, height: img.height || null,
              resolution: img.width && img.height ? img.width + "x" + img.height : "",
              watermarkStatus: watermarkStatus(streamUrl),
              source: "http:init-state", imageIndex: i + 1, pairedImageIndex: i + 1,
              fileId: img.fileId || "", traceId: img.traceId || "",
              livePhoto: true, bitrate: null, fileSize: null
            });
          }
        }
      }
      if (hasVideo$1 && noteData.video && typeof noteData.video === "object") {
        const streamAssets = extractVideoStreamAssets(noteData.video.media?.stream || noteData.video.consumerInfo?.stream);
        const consumer = noteData.video.consumer || noteData.video.consumerInfo || {};
        if (consumer.originVideoKey) {
          streamAssets.unshift({
            kind: "video", url: "https://sns-video-bd.xhscdn.com/" + consumer.originVideoKey, sourceUrl: "https://sns-video-bd.xhscdn.com/" + consumer.originVideoKey,
            width: null, height: null, resolution: "", bitrate: null, fileSize: null,
            watermarkStatus: watermarkStatus("https://sns-video-bd.xhscdn.com/" + consumer.originVideoKey),
            source: "http:originVideoKey", fileId: "", traceId: "", livePhoto: false, imageIndex: null, pairedImageIndex: null
          });
        }
        const deduped = dedupeVideos(streamAssets, videoPreference$1);
        const filtered = deduped.filter(v => { if (!videoMinHeight$1 || videoMinHeight$1 <= 0) return true; return Number(v.height || 0) >= videoMinHeight$1; });
        assets$1.push(...filtered.slice(0, 3));
      }
      const coverAsset$1 = extractCoverImage(noteData);
      if (coverAsset$1 && coverAsset$1.url) {
        assets$1.push({
          kind: "cover", url: coverAsset$1.url, sourceUrl: coverAsset$1.url,
          width: coverAsset$1.width || null, height: coverAsset$1.height || null,
          resolution: coverAsset$1.width && coverAsset$1.height ? coverAsset$1.width + "x" + coverAsset$1.height : "",
          watermarkStatus: watermarkStatus(coverAsset$1.url),
          source: coverAsset$1.source || "http:cover", imageIndex: null, fileId: "", traceId: "",
          livePhoto: false, pairedImageIndex: null, bitrate: null, fileSize: null
        });
      }
      const authorName$1 = noteData.user?.nickname || noteData.user?.nickName || "";
      const authorId$1 = noteData.user?.userId || noteData.user?.user_id || "";
      const metrics$1 = noteData.interactInfo || {};
      const hasLivePhoto$1 = assets$1.some((a) => a.kind === "livePhoto");
      const contentType$1 = hasLivePhoto$1 ? "Live图文" : hasVideo$1 ? "视频笔记" : imageList.length ? "图文笔记" : "待复核";
      const status$1 = assets$1.length ? "已入库" : "需人工复核";
      return {
        platform: "小红书", sourceUrl: url$1, noteId: noteId$1,
        accountId: input$1.accountId || null, brand: input$1.brand || "",
        title: noteData.title || "未命名笔记", description: noteData.desc || "",
        authorName: authorName$1, authorId: authorId$1,
        publishedAt: noteData.time ? new Date(Number(noteData.time)).toISOString() : "",
        contentType: contentType$1, marketingGoal: "", sellingPoints: [], visualStyle: "",
        tags: Array.from(new Set([...(input$1.tags || []), ...(Array.isArray(noteData.tagList) ? noteData.tagList.map(t => t.name || t).filter(Boolean) : [])])),
        metrics: metrics$1, status: status$1,
        reviewReason: status$1 === "需人工复核" ? "公开页 HTML 路径未发现可直接访问的资源" : "",
        ipLocation: noteData.ipLocation || null,
        lastUpdateTime: noteData.lastUpdateTime ? new Date(Number(noteData.lastUpdateTime)).toISOString() : null,
        cover: coverAsset$1 ? { url: coverAsset$1.url, width: coverAsset$1.width, height: coverAsset$1.height } : null,
        shareInfo: noteData.shareInfo || null,
        raw: { source: "http:init-state", acquisitionMode: mode, authUsed: mode === "cookie", noteId: noteData.noteId, imageCount: imageList.length, assetCount: assets$1.length },
        assets: assets$1.map((a) => ({ ...a, sourceUrl: a.sourceUrl || a.url || "" }))
      };
    };
    const attempts$1 = [{ mode: "public", cookie: "" }];
    if (cookie$1) attempts$1.push({ mode: "cookie", cookie: cookie$1 });
    let bestParsed$1 = null;
    for (const attempt of attempts$1) {
      let response;
      try {
        response = await fetchWithParams$1(attempt.cookie, attempt.mode);
      } catch (err) {
        console.warn("[fetchNoteViaHttp] " + (attempt.mode === "public" ? "公开页" : "Cookie") + " 请求失败:", err.message);
        continue;
      }
      const { status: fs, html: html2, mode: mode2 } = response;
      if (fs !== 200) continue;
      if (html2.includes("安全限制") || html2.includes("手机号登录") || html2.includes("你访问的页面不见了") || html2.includes("当前笔记暂时无法浏览") || isBlocked$1(fs, html2)) continue;
      const state = parseInitState(html2);
      if (!state) continue;
      const noteData = getNote$1(state);
      if (!noteData) continue;
      const parsed = buildNoteResult$1(noteData, mode2);
      if (parsed.assets.length) {
        console.log("[fetchNoteViaHttp] " + (mode2 === "public" ? "公开页 HTML" : "Cookie 兜底 HTML") + " 解析成功。");
        return [parsed];
      }
      bestParsed$1 = bestParsed$1 || parsed;
    }
    if (!bestParsed$1 || !bestParsed$1.assets?.length) {
      for (const attempt of attempts$1) {
        let fallbackResp;
        try {
          fallbackResp = await tryMultiUrlFallback$1(attempt.cookie, attempt.mode);
        } catch (e) { continue; }
        if (!fallbackResp) continue;
        const { html: fhtml, mode: fmode } = fallbackResp;
        const fstate = parseInitState(fhtml);
        if (fstate) {
          const fdata = getNote$1(fstate);
          if (fdata) {
            const fparsed = buildNoteResult$1(fdata, fmode);
            if (fparsed.assets.length) {
              console.log("[fetchNoteViaHttp] URL 形态降级解析成功:", fmode);
              return [fparsed];
            }
            bestParsed$1 = bestParsed$1 || fparsed;
          }
        }
        const ogFallback = extractHtmlFallbackAssets(fhtml, noteId$1);
        if (ogFallback.assets.length) {
          if (bestParsed$1 && !bestParsed$1.assets.length) {
            const merged = { ...bestParsed$1 };
            merged.assets = [...bestParsed$1.assets, ...ogFallback.assets];
            merged.status = "已入库";
            merged.reviewReason = "";
            merged.raw.acquisitionMode = fmode + ":og-fallback";
            if (ogFallback.note?.title && !merged.title) merged.title = ogFallback.note.title;
            if (ogFallback.note?.description && !merged.description) merged.description = ogFallback.note.description;
            console.log("[fetchNoteViaHttp] og:image/og:video 兜底素材合并成功:", fmode);
            return [merged];
          }
          const ogResult = buildFallbackNoteResult$1(ogFallback.assets, ogFallback.note, fmode + ":og-fallback");
          console.log("[fetchNoteViaHttp] og:image/og:video 兜底解析成功:", fmode);
          return [ogResult];
        }
      }
    }
    if (bestParsed$1 && !bestParsed$1.assets?.length && bestParsed$1.raw?.bodyText) {
      const ogFallback = extractHtmlFallbackAssets(bestParsed$1.raw.bodyText, noteId$1);
      if (ogFallback.assets.length) bestParsed$1.assets.push(...ogFallback.assets);
    }
    return bestParsed$1 ? [bestParsed$1] : null;
  } catch (e) {
    console.warn("[fetchNoteViaHttp] 请求失败:", e.message);
    return null;
  } finally {
    clearTimeout(timer$1);
  }
}


export { uniqueByAssets, extractVideoStreamAssets, hasUsableAssets, extractNote, fetchNoteViaHttp, extractHtmlFallbackAssets, tryFetchUrlVariants };
