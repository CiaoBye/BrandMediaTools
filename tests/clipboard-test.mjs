import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readClipboardText } from "../src/clipboard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const shareText = "63 【屿间风吟｜下午三点，一场声音织就的停顿 - Bella ISLA艾屿月子 | 小红书】 https://www.xiaohongshu.com/discovery/item/6a210e2b0000000038034342?source=webshare&xhsshare=pc_web&xsec_token=test_token&xsec_source=pc_share";

process.env.XHS_CLIPBOARD_TEXT = shareText;
assert.equal(readClipboardText(), shareText);

const result = spawnSync(
  process.execPath,
  ["--no-warnings", "src/cli.mjs", "--clipboard", "--links"],
  {
    cwd: rootDir,
    env: { ...process.env, XHS_CLIPBOARD_TEXT: shareText },
    encoding: "utf8"
  }
);

assert.equal(result.status, 0, result.stderr || result.stdout);

const parsed = JSON.parse(result.stdout);
assert.equal(parsed.count, 1);
assert.equal(parsed.links.length, 1);
assert.ok(parsed.links[0].includes("/discovery/item/6a210e2b0000000038034342"));
assert.ok(parsed.links[0].includes("xsec_token=test_token"));

console.log("clipboard-test passed");
