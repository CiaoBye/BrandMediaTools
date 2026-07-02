import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { persistNoteAssets } from "../src/downloader.mjs";
import { generateReport } from "../src/reportGenerator.mjs";
import { getEngagementStats } from "../src/contentAnalysis.mjs";
import { analyzeTitle } from "../src/xhsViralAnalysis.mjs";
import { decryptCookie, encryptCookie } from "../src/xhsAuth.mjs";
import { fetchNoteViaHttp } from "../src/crawler/extract.mjs";
import { fmtDate, fmtDateTime } from "../src/time.mjs";
import { Storage } from "../src/storage.mjs";
import { crawlAndStore } from "../src/server-utils.mjs";
import { buildAssetIntegrity, isNoteComplete, shouldRepairNoteAssets } from "../src/noteCompleteness.mjs";

const rootDir = mkdtempSync(path.join(os.tmpdir(), "xhs-core-regression-"));
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");

async function rmTempDirWithRetry(target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.warn(`[core-regression-test] 临时目录清理失败，已保留供系统稍后回收：${target} (${error.code || error.message})`);
        return;
      }
      if (error.code !== "EPERM") throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/asset.png" || /^\/asset-\d+\.png$/.test(req.url || "")) {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length });
    res.end(png);
    return;
  }
  if (req.url === "/live") {
    const state = {
      note: {
        noteDetailMap: {
          n1: {
            note: {
              noteId: "1234567890abcdef",
              title: "Live 图回归测试",
              desc: "测试",
              type: "normal",
              time: Date.now(),
              user: { nickname: "测试作者", userId: "u1" },
              interactInfo: { likedCount: 10, commentCount: 2 },
              imageList: [{
                width: 720,
                height: 960,
                urlDefault: `http://127.0.0.1:${server.address().port}/asset.png`,
                livePhoto: true,
                stream: { h264: [{ masterUrl: `http://127.0.0.1:${server.address().port}/live.mp4` }] }
              }]
            }
          }
        }
      }
    };
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`);
    return;
  }
  if (req.url === "/public-first") {
    if (req.headers.cookie) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body>手机号登录 登录小红书</body></html>");
      return;
    }
    const state = {
      note: {
        noteDetailMap: {
          publicFirst: {
            note: {
              noteId: "public-first-note",
              title: "公开页优先测试",
              desc: "即使本地存在 Cookie，也应优先不带 Cookie 解析公开页",
              type: "normal",
              time: Date.now(),
              user: { nickname: "公开页作者", userId: "public-author" },
              interactInfo: { likedCount: 1, commentCount: 0 },
              imageList: [{
                width: 720,
                height: 960,
                urlDefault: `http://127.0.0.1:${server.address().port}/asset.png`
              }]
            }
          }
        }
      }
    };
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`);
    return;
  }
  if (req.url === "/snake-images") {
    const base = `http://127.0.0.1:${server.address().port}`;
    const state = {
      note: {
        noteDetailMap: {
          snakeImages: {
            note: {
              noteId: "snake-image-note",
              title: "蛇形图片字段测试",
              desc: "单条笔记需要完整保留 image_list",
              time: Date.now(),
              user: { nickname: "测试作者", userId: "u-snake" },
              image_list: [
                { width: 720, height: 960, url_default: `${base}/asset-1.png` },
                { width: 720, height: 960, info_list: [{ image_scene: "WB_DFT", url: `${base}/asset-2.png` }] },
                { width: 720, height: 960, url_pre: `${base}/asset-3.png` }
              ]
            }
          }
        }
      }
    };
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`);
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

try {
  const saved = await persistNoteAssets(rootDir, {
    id: "note-1",
    noteId: "note-1",
    sourceUrl: `http://127.0.0.1:${port}/live`,
    brand: "回归测试",
    authorName: "测试作者",
    title: "HTTP 下载测试",
    contentType: "图文笔记",
    collectedAt: new Date().toISOString(),
    assets: [{ kind: "image", sourceUrl: `http://127.0.0.1:${port}/asset.png` }]
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, "已保存");
  assert.ok(saved[0].localPath);
  assert.ok(readFileSync(path.join(rootDir, saved[0].localPath)).length > 0);

  const report = generateReport([{
    id: "n1",
    title: "为什么这条内容有效？",
    brand: "测试品牌",
    authorName: "测试作者",
    collectedAt: new Date().toISOString(),
    contentType: "图文笔记",
    assets: [{}],
    metrics: { likedCount: 100, commentCount: 20, collectedCount: 30, shareCount: 5 }
  }], "weekly", analyzeTitle);
  assert.equal(report.summary.totalNotes, 1);
  assert.equal(report.topNotes[0].totalInteractions, 155);

  const engagement = getEngagementStats([{ metrics: { likedCount: 100, commentCount: 20 } }], (m) => {
    const likes = Number(m.likedCount || 0);
    const comments = Number(m.commentCount || 0);
    return { likes, comments, collects: 0, shares: 0, total: likes + comments };
  });
  assert.equal(engagement.avgLikes, 100);
  assert.equal(engagement.maxTotal, 120);

  const encrypted = encryptCookie("a1=test; web_session=session-value", rootDir);
  assert.equal(decryptCookie(encrypted, rootDir), "a1=test; web_session=session-value");
  assert.equal(decryptCookie("00:11:22", rootDir), "");

  const liveNotes = await fetchNoteViaHttp({ url: `http://127.0.0.1:${port}/live` }, { rootDir });
  assert.equal(liveNotes[0].contentType, "Live图文");
  assert.ok(liveNotes[0].assets.every((asset) => asset.sourceUrl));
  mkdirSync(path.join(rootDir, "data"), { recursive: true });
  writeFileSync(path.join(rootDir, "data", "xhs-cookie.txt"), "a1=stale; web_session=stale-session", "utf8");
  const publicFirstNotes = await fetchNoteViaHttp({ url: `http://127.0.0.1:${port}/public-first` }, { rootDir });
  assert.equal(publicFirstNotes[0].title, "公开页优先测试");
  assert.equal(publicFirstNotes[0].raw.acquisitionMode, "public");
  assert.equal(publicFirstNotes[0].raw.authUsed, false);
  const snakeImageNotes = await fetchNoteViaHttp({ url: `http://127.0.0.1:${port}/snake-images` }, { rootDir });
  assert.equal(snakeImageNotes[0].raw.imageCount, 3, "单条笔记应识别 image_list 中的全部图片");
  assert.equal(snakeImageNotes[0].assets.filter((asset) => asset.kind === "image").length, 3, "单条笔记应保留全部图片素材");
  const partialIntegrity = buildAssetIntegrity(snakeImageNotes[0], [
    { kind: "image", localPath: "data/library/1.webp", status: "已保存" }
  ]);
  assert.equal(partialIntegrity.status, "部分入库");
  assert.equal(partialIntegrity.raw.assetIntegrity.expected.images, 3);
  assert.equal(partialIntegrity.raw.assetIntegrity.saved.images, 1);
  assert.equal(partialIntegrity.raw.assetIntegrity.missing.images, 2);
  const completeIntegrity = buildAssetIntegrity(snakeImageNotes[0], [1, 2, 3].map((idx) => ({ kind: "image", localPath: `data/library/${idx}.webp`, status: "已保存" })));
  assert.equal(completeIntegrity.status, "完整入库");
  assert.equal(completeIntegrity.raw.assetIntegrity.complete, true);

  assert.equal(fmtDate("2026-06-23T16:00:00.000Z"), "2026-06-24");
  assert.match(fmtDateTime("2026-06-23T16:00:00.000Z"), /^2026-06-24 24:00$|^2026-06-24 00:00$/);

  const storage = new Storage(rootDir);
  const repairUrl = "https://www.xiaohongshu.com/explore/64abcdef1234567890abcdef?xsec_token=test";
  const incompleteNote = storage.upsertNote({
    sourceUrl: repairUrl,
    noteId: "64abcdef1234567890abcdef",
    title: "单条缺图修复测试",
    contentType: "图文笔记",
    raw: { source: "http:init-state", imageCount: 3, assetCount: 3 }
  });
  storage.addAssets(incompleteNote.id, [{ kind: "image", sourceUrl: "https://example.test/old-1.jpg", status: "已保存", imageIndex: 1 }]);
  let repairCrawlCalls = 0;
  const repairResult = await crawlAndStore({ url: repairUrl, skip: true, download: false }, {
    rootDir,
    storage,
    crawlFn: async () => {
      repairCrawlCalls++;
      return [{
        sourceUrl: repairUrl,
        noteId: "64abcdef1234567890abcdef",
        title: "单条缺图修复测试",
        contentType: "图文笔记",
        raw: { source: "http:init-state", imageCount: 3, assetCount: 3 },
        assets: [1, 2, 3].map((idx) => ({ kind: "image", sourceUrl: `https://example.test/new-${idx}.jpg`, status: "已保存", imageIndex: idx }))
      }];
    }
  });
  assert.equal(repairCrawlCalls, 1, "已入库但缺图的单条笔记不应被 skip 跳过");
  assert.equal(repairResult.skipped.length, 0);
  assert.equal(storage.getNote(incompleteNote.id).assets.filter((asset) => asset.kind === "image").length, 3);
  assert.equal(shouldRepairNoteAssets(incompleteNote, storage), true, "没有 assetIntegrity 的历史图文笔记应进入详情复核");
  assert.equal(isNoteComplete(storage.getNote(incompleteNote.id), storage), false, "仅有 sourceUrl、未落盘的素材不能算真实完整入库");

  const libraryFile = path.join(rootDir, "data", "library", "安全测试", "同目录", "owned.jpg");
  const siblingFile = path.join(rootDir, "data", "library", "安全测试", "同目录", "other.jpg");
  const outsideFile = path.join(rootDir, "outside.jpg");
  mkdirSync(path.dirname(libraryFile), { recursive: true });
  writeFileSync(libraryFile, png);
  writeFileSync(siblingFile, png);
  writeFileSync(outsideFile, png);
  const storedNote = storage.upsertNote({ sourceUrl: "https://example.test/safe-delete", noteId: "safe-delete", brand: "安全测试", title: "删除边界", assets: [] });
  storage.addAssets(storedNote.id, [
    { kind: "image", localPath: path.relative(rootDir, libraryFile), status: "已保存" },
    { kind: "image", localPath: outsideFile, status: "已保存" }
  ]);
  assert.equal(storage.deleteNote(storedNote.id), true);
  assert.equal(existsSync(libraryFile), false, "应删除归属于笔记的素材");
  assert.equal(existsSync(siblingFile), true, "不得递归删除同目录其他素材");
  assert.equal(existsSync(outsideFile), true, "不得删除素材库根目录之外的文件");
  storage.db.close();

  console.log("core-regression-test passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rmTempDirWithRetry(rootDir);
}
