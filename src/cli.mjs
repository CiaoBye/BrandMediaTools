import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "./storage.mjs";
import { extractXhsUrls, crawlXhs, extractPageLinks, isXhsNoteUrl, mergeXhsLinks, openXhsContext, saveXhsCookieFromBrowser } from "./xhsCrawler.mjs";
import { persistNoteAssets } from "./downloader.mjs";
import { parseBool } from "./settings.mjs";
import { readClipboardText } from "./clipboard.mjs";
import { buildAssetIntegrity } from "./noteCompleteness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    urlParts: [],
    download: false,
    skip: false,
    index: [],
    cookie: "",
    proxy: "",
    brand: "",
    maxNotes: undefined,
    headless: undefined,
    linksOnly: false,
    scrollPages: undefined,
    saveCookie: false,
    waitMs: undefined,
    clipboard: false,
    watchClipboard: false,
    clipboardIntervalMs: 1500
  };
  for (const arg of argv) {
    if (arg === "--download" || arg === "-d") options.download = true;
    else if (arg.startsWith("--download=")) options.download = parseBool(arg.slice("--download=".length), false);
    else if (arg === "--skip") options.skip = true;
    else if (arg.startsWith("--skip=")) options.skip = parseBool(arg.slice("--skip=".length), false);
    else if (arg === "--headless") options.headless = true;
    else if (arg.startsWith("--headless=")) options.headless = parseBool(arg.slice("--headless=".length), false);
    else if (arg === "--links") options.linksOnly = true;
    else if (arg === "--save-cookie") options.saveCookie = true;
    else if (arg === "--clipboard") options.clipboard = true;
    else if (arg === "--watch-clipboard") options.watchClipboard = true;
    else if (arg.startsWith("--wait-ms=")) options.waitMs = Number(arg.slice("--wait-ms=".length));
    else if (arg.startsWith("--clipboard-interval-ms=")) options.clipboardIntervalMs = Number(arg.slice("--clipboard-interval-ms=".length));
    else if (arg.startsWith("--scroll-pages=")) options.scrollPages = Number(arg.slice("--scroll-pages=".length));
    else if (arg.startsWith("--index=")) {
      options.index = arg.slice("--index=".length).split(",").map((item) => Number(item.trim())).filter(Boolean);
    } else if (arg.startsWith("--cookie=")) options.cookie = arg.slice("--cookie=".length);
    else if (arg.startsWith("--proxy=")) options.proxy = arg.slice("--proxy=".length);
    else if (arg.startsWith("--brand=")) options.brand = arg.slice("--brand=".length);
    else if (arg.startsWith("--max-notes=")) options.maxNotes = Number(arg.slice("--max-notes=".length));
    else options.urlParts.push(arg);
  }
  return options;
}

async function extractLinksOnly(url, options) {
  if (isXhsNoteUrl(url)) return [url];
  const context = await openXhsContext(rootDir, options.cookie || "", {
    headless: options.headless ?? true,
    proxy: options.proxy || ""
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const diagnosis = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      text: document.body?.innerText?.slice(0, 500) || ""
    }));
    const links = await extractPageLinks(page, {
      rootDir,
      maxNotes: options.maxNotes,
      scrollPages: options.scrollPages
    });
    return { links, diagnosis };
  } finally {
    await context.close();
  }
}

function summarize(note) {
  return {
    sourceUrl: note.sourceUrl,
    noteId: note.noteId,
    title: note.title,
    contentType: note.contentType,
    status: note.status,
    reviewReason: note.reviewReason,
    assets: (note.assets || []).map((asset) => ({
      kind: asset.kind,
      status: asset.status,
      fileName: asset.fileName,
      fileSize: asset.fileSize,
      localPath: asset.localPath,
      sourceUrl: asset.sourceUrl
    }))
  };
}

async function runInput(input, options, storage = new Storage(rootDir)) {
  const urls = extractXhsUrls(input);
  if (!urls.length) {
    throw new Error("请提供小红书作品链接、账号主页链接，或包含链接的分享文本。");
  }

  if (options.linksOnly) {
    const links = [];
    const diagnostics = [];
    const inputUrls = [];
    for (const url of urls) {
      inputUrls.push(url);
      const result = await extractLinksOnly(url, options);
      if (Array.isArray(result)) {
        links.push(...result);
      } else {
        links.push(...result.links);
        diagnostics.push({ inputUrl: url, ...result.diagnosis });
      }
    }
    const mergedLinks = mergeXhsLinks(inputUrls, links);
    return { count: mergedLinks.length, links: mergedLinks, diagnostics };
  }

  const output = [];
  for (const url of urls) {
    const existing = storage.findNoteBySourceUrl(url);
    if (existing && options.skip) {
      output.push({ skipped: true, ...summarize(existing) });
      continue;
    }
    const notes = await crawlXhs(
      {
        url,
        brand: options.brand,
        index: options.index,
        cookie: options.cookie,
        proxy: options.proxy
      },
      {
        rootDir,
        maxNotes: options.maxNotes,
        cookie: options.cookie,
        proxy: options.proxy,
        headless: options.headless
      }
    );
    for (const note of notes) {
      const savedNote = storage.upsertNote(note);
      let assets = [];
      if (options.download) {
        assets = await persistNoteAssets(rootDir, { ...note, id: savedNote.id, collectedAt: savedNote.collectedAt });
      } else {
        assets = note.assets || [];
      }
      const integrity = buildAssetIntegrity(note, assets);
      const finalNote = storage.upsertNote({ ...note, status: integrity.status, reviewReason: integrity.reviewReason, raw: integrity.raw });
      storage.addAssets(finalNote.id, assets);
      output.push(summarize(storage.getNote(finalNote.id)));
    }
  }
  return output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.saveCookie) {
    const result = await saveXhsCookieFromBrowser(rootDir, {
      proxy: options.proxy,
      waitMs: options.waitMs || 8000
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const storage = new Storage(rootDir);
  if (options.watchClipboard) {
    let lastText = "";
    console.error("正在监听剪贴板中的小红书链接，按 Ctrl+C 停止。");
    while (true) {
      const text = readClipboardText();
      if (text && text !== lastText && extractXhsUrls(text).length) {
        lastText = text;
        const result = await runInput(text, options, storage);
        console.log(JSON.stringify({ fromClipboard: true, result }, null, 2));
      }
      await new Promise((resolve) => setTimeout(resolve, options.clipboardIntervalMs || 1500));
    }
  }

  const input = options.clipboard ? readClipboardText() : options.urlParts.join(" ");
  console.log(JSON.stringify(await runInput(input, options, storage), null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
