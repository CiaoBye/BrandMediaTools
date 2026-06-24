import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "./storage.mjs";
import { crawlXhs, extractPageLinks, extractXhsUrls, isXhsNoteUrl, mergeXhsLinks, openXhsContext } from "./xhsCrawler.mjs";
import { persistNoteAssets } from "./downloader.mjs";
import { parseBool } from "./settings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const storage = new Storage(rootDir);

function jsonText(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function summarizeNote(note) {
  return {
    id: note.id || "",
    sourceUrl: note.sourceUrl,
    noteId: note.noteId,
    title: note.title,
    contentType: note.contentType,
    status: note.status,
    reviewReason: note.reviewReason || "",
    assets: (note.assets || []).map((asset) => ({
      kind: asset.kind,
      status: asset.status,
      fileName: asset.fileName,
      fileSize: asset.fileSize,
      localPath: asset.localPath,
      sourceUrl: asset.sourceUrl || asset.url,
      imageIndex: asset.imageIndex || null,
      pairedImageIndex: asset.pairedImageIndex || null
    }))
  };
}

async function detail(args = {}) {
  const inputText = args.url || args.shareText || "";
  const urls = extractXhsUrls(inputText);
  if (!urls.length) {
    throw new Error("请提供小红书作品链接、账号主页链接，或包含链接的分享文本。");
  }

  const download = parseBool(args.download, false);
  const skip = parseBool(args.skip, false);
  const output = [];
  const skipped = [];

  for (const url of urls) {
    const existing = storage.findNoteBySourceUrl(url);
    if (existing && skip) {
      skipped.push(summarizeNote(existing));
      continue;
    }

    const notes = await crawlXhs(
      {
        url,
        brand: args.brand || "",
        tags: Array.isArray(args.tags) ? args.tags : [],
        index: Array.isArray(args.index) ? args.index : [],
        cookie: args.cookie || "",
        proxy: args.proxy || ""
      },
      {
        rootDir,
        maxNotes: args.maxNotes,
        cookie: args.cookie || "",
        proxy: args.proxy || "",
        headless: args.headless === undefined ? true : parseBool(args.headless, true)
      }
    );

    for (const note of notes) {
      const savedNote = storage.upsertNote(note);
      if (download) {
        const assets = await persistNoteAssets(rootDir, {
          ...note,
          id: savedNote.id,
          collectedAt: savedNote.collectedAt
        });
        storage.addAssets(savedNote.id, assets);
      } else {
        storage.addAssets(savedNote.id, note.assets || []);
      }
      output.push(summarizeNote(storage.getNote(savedNote.id)));
    }
  }

  return {
    message: output.length ? "success" : skipped.length ? "skipped" : "empty",
    count: output.length,
    dataList: output,
    skipped
  };
}

async function links(args = {}) {
  const inputText = args.url || args.shareText || "";
  const urls = extractXhsUrls(inputText);
  if (!urls.length) {
    throw new Error("请提供小红书账号主页、作品链接或分享文本。");
  }

  const directNoteLinks = urls.filter((item) => isXhsNoteUrl(item));
  const pageUrl = urls.find((item) => !isXhsNoteUrl(item)) || "";
  if (!pageUrl) {
    const links = mergeXhsLinks(urls);
    return { message: "success", count: links.length, links, diagnostics: [] };
  }

  const context = await openXhsContext(rootDir, args.cookie || "", {
    headless: args.headless === undefined ? true : parseBool(args.headless, true),
    proxy: args.proxy || ""
  });
  try {
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const diagnostics = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      text: document.body?.innerText?.slice(0, 500) || ""
    }));
    const extractedLinks = await extractPageLinks(page, {
      rootDir,
      maxNotes: args.maxNotes,
      scrollPages: args.scrollPages,
      scrollDelayMs: args.scrollDelayMs
    });
    const links = mergeXhsLinks(directNoteLinks, extractedLinks);
    return {
      message: links.length ? "success" : "empty",
      inputUrl: pageUrl,
      count: links.length,
      links,
      diagnostics
    };
  } catch (error) {
    if (directNoteLinks.length) {
      const links = mergeXhsLinks(directNoteLinks);
      return { message: "partial", inputUrl: pageUrl, count: links.length, links, error: error.message, diagnostics: [] };
    }
    throw error;
  } finally {
    await context.close();
  }
}

const tools = [
  {
    name: "xhs_detail",
    description: "采集小红书作品或账号主页内容，参数对齐 /xhs/detail。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "小红书链接或分享文本。" },
        shareText: { type: "string", description: "包含小红书链接的分享文本。" },
        download: { type: ["boolean", "string"], description: "是否下载素材，默认 false。" },
        skip: { type: ["boolean", "string"], description: "已有记录时是否跳过。" },
        index: { type: "array", items: { type: "number" }, description: "只采集指定素材序号。" },
        cookie: { type: "string", description: "单次调用 Cookie。" },
        proxy: { type: "string", description: "单次调用代理。" },
        brand: { type: "string", description: "品牌归属。" },
        tags: { type: "array", items: { type: "string" }, description: "标签。" },
        maxNotes: { type: "number", description: "账号主页最大作品数。" },
        headless: { type: ["boolean", "string"], description: "是否使用无界面浏览器。" }
      },
      required: ["url"]
    }
  },
  {
    name: "xhs_links",
    description: "提取小红书账号主页作品链接，参数对齐 /xhs/links。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "小红书账号主页、作品链接或分享文本。" },
        shareText: { type: "string", description: "包含小红书链接的分享文本。" },
        cookie: { type: "string", description: "单次调用 Cookie。" },
        proxy: { type: "string", description: "单次调用代理。" },
        maxNotes: { type: "number", description: "最多返回作品数。" },
        scrollPages: { type: "number", description: "主页滚动轮数。" },
        scrollDelayMs: { type: "number", description: "每轮滚动等待时间。" },
        headless: { type: ["boolean", "string"], description: "是否使用无界面浏览器。" }
      },
      required: ["url"]
    }
  }
];

async function handle(message) {
  const { id, method, params = {} } = message;
  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "brand-content-intelligence-xhs",
            version: "1.10.0"
          }
        }
      };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools } };
    }
    if (method === "tools/call") {
      const name = params.name;
      const args = params.arguments || {};
      if (name === "xhs_detail") return { jsonrpc: "2.0", id, result: jsonText(await detail(args)) };
      if (name === "xhs_links") return { jsonrpc: "2.0", id, result: jsonText(await links(args)) };
      throw new Error(`未知工具：${name}`);
    }
    if (method === "notifications/initialized") return null;
    throw new Error(`未知方法：${method}`);
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: error.message
      }
    };
  }
}

function writeMessage(message) {
  if (!message) return;
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", async (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length) {
    const text = buffer.toString("utf8");
    const headerEnd = text.indexOf("\r\n\r\n");
    if (headerEnd >= 0) {
      const header = text.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = Buffer.byteLength(text.slice(0, headerEnd + 4), "utf8");
      if (buffer.length < bodyStart + length) return;
      const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.slice(bodyStart + length);
      writeMessage(await handle(JSON.parse(body)));
      continue;
    }

    const lineEnd = text.indexOf("\n");
    if (lineEnd < 0) return;
    const line = text.slice(0, lineEnd).trim();
    buffer = buffer.slice(Buffer.byteLength(text.slice(0, lineEnd + 1), "utf8"));
    if (line) writeMessage(await handle(JSON.parse(line)));
  }
});
