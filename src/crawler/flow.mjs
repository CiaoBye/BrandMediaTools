import { envWithSettings } from "../settings.mjs";
import { isAccountUrl, openXhsContext, attachResponseCollector, sleep } from "../xhsSdk.mjs";
import { fetchNoteViaHttp, extractNote, hasUsableAssets } from "./extract.mjs";
import { extractAccountNotes } from "./account.mjs";

async function crawlWithFallback(input, options = {}) {
  if (!isAccountUrl(input.url)) {
    const httpResult = await fetchNoteViaHttp(input, options);
    if (httpResult && httpResult.length > 0 && hasUsableAssets(httpResult[0])) return httpResult;
  }

  const rootDir = options.rootDir || process.cwd();
  const settings = envWithSettings(rootDir);
  const headless = options.headless ?? settings.xhs.headless;
  let context = null;
  try {
    context = await openXhsContext(rootDir, options.cookie || input.cookie || "", {
      proxy: options.proxy || input.proxy || "", headless
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
