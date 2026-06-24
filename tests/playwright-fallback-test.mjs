import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crawlXhs } from "../src/xhsCrawler.mjs";

const rootDir = mkdtempSync(path.join(os.tmpdir(), "xhs-playwright-fallback-"));
const server = http.createServer((req, res) => {
  if (req.url === "/fixtures/long-asset-image.jpg") {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head>
    <meta property="og:title" content="Playwright 目标页测试">
    <meta property="og:description" content="用于确认降级路径确实导航到目标 URL">
  </head><body><h1>Playwright 目标页测试</h1>
    <img src="http://127.0.0.1:${server.address().port}/fixtures/long-asset-image.jpg" width="640" height="480">
  </body></html>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/note`;

try {
  const notes = await crawlXhs({ url }, { rootDir, headless: true });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Playwright 目标页测试");
  assert.ok(notes[0].assets.some((asset) => asset.kind === "image"));
  console.log("playwright-fallback-test passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(rootDir, { recursive: true, force: true });
}
