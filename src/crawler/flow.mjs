import { envWithSettings } from "../settings.mjs";
import { isAccountUrl, extractXhsId, openXhsContext, attachResponseCollector, sleep, log } from "../xhsSdk.mjs";
import { fetchNoteViaHttp, extractNote, hasUsableAssets, extractHtmlFallbackAssets } from "./extract.mjs";
import { extractAccountNotes } from "./account.mjs";

async function crawlWithFallback(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const shortUrl = input.url?.slice(0, 80) || "";
  log("info", `采集开始: ${shortUrl}`);

  let httpMetadataOnly = null; // HTTP 路径获取到元数据但无素材时保留，供 Playwright 补充
  if (!isAccountUrl(input.url)) {
    // 1. 公开页 HTML 快速路径：默认不带 Cookie，模仿 XHS-Downloader 的公开页解析思路
    const httpResult = await fetchNoteViaHttp(input, options);
    if (httpResult && httpResult.length > 0) {
      if (hasUsableAssets(httpResult[0])) {
        const mode = httpResult[0].raw?.acquisitionMode === "cookie" ? "Cookie 兜底" : "公开页";
        log("info", `${mode} HTML 采集成功: ${httpResult[0].title?.slice(0, 40) || "未命名"}`);
        return httpResult;
      }
      // 元数据有但素材不足 → 保存元数据，继续尝试 Playwright 补充素材
      httpMetadataOnly = httpResult[0];
      log("info", `公开页 HTML 解析到元数据但无有效素材，尝试 Playwright 补充: ${httpResult[0].title?.slice(0, 40) || "未命名"}`);
    } else {
      log("info", `公开页 HTML 未能解析，降级 Playwright`);
    }
  }

  const settings = envWithSettings(rootDir);
  const headless = options.headless ?? settings.xhs.headless;
  let context = null;
  try {
    context = await openXhsContext(rootDir, options.cookie || input.cookie || "", {
      proxy: options.proxy || input.proxy || "", headless, cdpPort: options.cdpPort || 0
    });
    const page = await context.newPage();
    const networkBodies = [];
    attachResponseCollector(page, networkBodies);
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    if (!headless) {
      let waited = 0;
      while (waited < 60) {
        const u = page.url();
        if (!u.includes("/captcha") && !u.includes("/website-login")) break;
        await sleep(3000);
        waited += 3;
      }
    }
    if (isAccountUrl(input.url)) return await extractAccountNotes(page, input, options);
    const note = await extractNote(page, input, networkBodies, options.videoPreference || settings.download.videoPreference || "resolution", options.videoMinHeight || settings.download.videoMinHeight || 0);
    if (note && (note.title || note.noteId)) {
      // Try og:image/og:video HTML meta extraction if Playwright has no useful assets
      if (!hasUsableAssets(note)) {
        try {
          const html = await page.content();
          const ogAssets = extractHtmlFallbackAssets(html, note.noteId || extractXhsId(input.url));
          if (ogAssets.assets.length) {
            note.assets.push(...ogAssets.assets);
            if (!note.title && ogAssets.note?.title) note.title = ogAssets.note.title;
            if (!note.description && ogAssets.note?.description) note.description = ogAssets.note.description;
            note.status = "已入库";
            note.reviewReason = "";
            log("info", `Playwright og:image/og:video 兜底素材合并完成`);
          }
        } catch (ogErr) {
          log("warn", `og:image/og:video 提取失败: ${ogErr.message?.slice(0, 60)}`);
        }
      }
      // 如果 HTTP 路径获取到更完整的元数据，合并到 Playwright 结果中
      if (httpMetadataOnly && hasUsableAssets(note)) {
        if (!note.title && httpMetadataOnly.title) note.title = httpMetadataOnly.title;
        if (!note.description && httpMetadataOnly.description) note.description = httpMetadataOnly.description;
        if (!note.authorName && httpMetadataOnly.authorName) note.authorName = httpMetadataOnly.authorName;
        if (!note.authorId && httpMetadataOnly.authorId) note.authorId = httpMetadataOnly.authorId;
        if (!note.publishedAt && httpMetadataOnly.publishedAt) note.publishedAt = httpMetadataOnly.publishedAt;
        if (httpMetadataOnly.ipLocation) note.ipLocation = httpMetadataOnly.ipLocation;
        if (httpMetadataOnly.lastUpdateTime) note.lastUpdateTime = httpMetadataOnly.lastUpdateTime;
        if (httpMetadataOnly.atUsers?.length) note.atUsers = httpMetadataOnly.atUsers;
        if (Object.keys(httpMetadataOnly.metrics || {}).length > Object.keys(note.metrics || {}).length) {
          note.metrics = httpMetadataOnly.metrics;
        }
        if (httpMetadataOnly.tags?.length > (note.tags?.length || 0)) {
          note.tags = Array.from(new Set([...(note.tags || []), ...httpMetadataOnly.tags]));
        }
        log("info", `Playwright 素材 + HTTP 元数据合并完成`);
      }
      return [note];
    }
  } catch (e) {
    log("warn", `Playwright 采集失败: ${e.message?.slice(0, 100)}`);
  } finally { if (context) try { await context.close(); } catch {} }

  // Playwright 也失败时，返回 HTTP 元数据（如果有的话）
  if (httpMetadataOnly) {
    log("info", `Playwright 未获取到结果，返回 HTTP 元数据结果（需人工复核）`);
    return [httpMetadataOnly];
  }

  return [];
}

export async function crawlXhs(input, options = {}) {
  return crawlWithFallback(input, options);
}
