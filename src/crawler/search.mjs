import { envWithSettings } from "../settings.mjs";
import { createBrowser, openXhsContext, mergeXhsLinks, sleep } from "../xhsSdk.mjs";
import { searchViaApi, readApiCookie } from "../xhsApiClient.mjs";

export async function searchXhs(keyword, options = {}) {
  const rootDir = options.rootDir || process.cwd();

  // API 优先
  if (readApiCookie(rootDir)) {
    try {
      const result = await searchViaApi(keyword, "", rootDir);
      if (result && result.items.length > 0) {
        const urls = result.items.map(i => `https://www.xiaohongshu.com/explore/${i.note_card?.note_id || i.id}`).filter(Boolean);
        return { keyword, count: urls.length, links: mergeXhsLinks([], urls), items: result.items.slice(0, 50) };
      }
    } catch {}
  }

  const settings = envWithSettings(rootDir);
  const cookie = options.cookie || "";

  let browser, context;
  if (cookie) {
    context = await openXhsContext(rootDir, cookie, { headless: options.headless, proxy: options.proxy });
    browser = context.browser?.();
  } else {
    const bw = await createBrowser(rootDir, { headless: options.headless, proxy: options.proxy });
    browser = bw.browser;
    context = bw.context;
  }
  try {
    const page = await context.newPage();
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=1`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(4000);

    const results = await page.evaluate(() => {
      const items = [];
      const links = Array.from(document.querySelectorAll("a[href*='/explore/'], a[href*='/discovery/item/']"));
      const seen = new Set();
      for (const link of links) {
        const href = link.href;
        const noteId = href.match(/\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/)?.[1];
        if (!noteId || seen.has(noteId)) continue;
        seen.add(noteId);
        const card = link.closest("[class*='card'], [class*='item'], li, div") || link.parentElement;
        const title = card?.querySelector("[class*='title'], h3, h2")?.textContent?.trim() || link.textContent?.trim() || "";
        const img = card?.querySelector("img")?.src || "";
        const desc = card?.querySelector("[class*='desc'], [class*='brief']")?.textContent?.trim() || "";
        const author = card?.querySelector("[class*='author'], [class*='user'], [class*='name']")?.textContent?.trim() || "";
        const likes = card?.querySelector("[class*='like'], [class*='count']")?.textContent?.trim() || "";
        items.push({ noteId, url: href, title, image: img, description: desc, author, likes });
        if (items.length >= 30) return items;
      }
      return items;
    });

    const knownIds = new Set(results.map((r) => r.noteId));
    for (let i = 0; i < 2 && results.length < 20; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await sleep(1500);
      const existingIds = Array.from(knownIds);
      const more = await page.evaluate((existing) => {
        const items = [];
        const links = Array.from(document.querySelectorAll("a[href*='/explore/'], a[href*='/discovery/item/']"));
        const seen = new Set();
        for (const link of links) {
          const href = link.href;
          const noteId = href.match(/\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/)?.[1];
          if (!noteId || seen.has(noteId)) continue;
          seen.add(noteId);
          if (existing.includes(noteId)) continue;
          const card = link.closest("[class*='card'], [class*='item'], li, div") || link.parentElement;
          const title = card?.querySelector("[class*='title'], h3, h2")?.textContent?.trim() || link.textContent?.trim() || "";
          const img = card?.querySelector("img")?.src || "";
          items.push({ noteId, url: href, title, image: img });
          if (items.length >= 30) return items;
        }
        return items;
      }, existingIds);
      for (const item of more) { knownIds.add(item.noteId); }
      results.push(...more);
    }

    const merged = mergeXhsLinks([], results.map((r) => r.url));
    return { keyword, count: merged.length, links: merged, items: results.slice(0, 50) };
  } finally {
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
  }
}
