import { envWithSettings } from "../settings.mjs";
import { isAccountUrl, openXhsContext, attachResponseCollector, sleep, log } from "../xhsSdk.mjs";
import { fetchNoteViaHttp, extractNote, hasUsableAssets } from "./extract.mjs";
import { extractAccountNotes } from "./account.mjs";
import { crawlNoteViaApi, readApiCookie } from "../xhsApiClient.mjs";

async function crawlWithFallback(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const shortUrl = input.url?.slice(0, 80) || "";
  log("info", `采集开始: ${shortUrl}`);
  if (!isAccountUrl(input.url)) {
    // 1. API 优先（需 Cookie）
    if (readApiCookie(rootDir)) {
      const noteId = input.url.match(/\/explore\/([a-zA-Z0-9]+)/)?.[1];
      if (noteId) {
        const apiResult = await crawlNoteViaApi(noteId, input.url, rootDir);
        if (apiResult && apiResult.length > 0 && hasUsableAssets(apiResult[0])) {
          log("info", `API 采集成功: ${apiResult[0].title?.slice(0, 40) || "未命名"}`);
          return apiResult;
        }
        log("warn", `API 采集无结果，降级 HTTP SSR`);
      }
    }
    // 2. HTTP SSR 路径（免登录）
    const httpResult = await fetchNoteViaHttp(input, options);
    if (httpResult && httpResult.length > 0 && hasUsableAssets(httpResult[0])) {
      log("info", `HTTP SSR 采集成功: ${httpResult[0].title?.slice(0, 40) || "未命名"}`);
      return httpResult;
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
    if (note && (hasUsableAssets(note) || note.status !== "需人工复核")) return [note];
  } catch { /* fall through */ } finally { if (context) try { await context.close(); } catch { console.warn("[crawlWithFallback] context 关闭失败"); } }

  return [];
}

export async function crawlXhs(input, options = {}) {
  return crawlWithFallback(input, options);
}
