import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "../src/storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const rootDir = path.join(projectRoot, "data", "test-runs", `storage-filter-${Date.now()}`);
const storage = new Storage(rootDir);

const account = storage.createAccount({
  brand: "Bella ISLA",
  accountName: "测试账号",
  accountUrl: "https://www.xiaohongshu.com/user/profile/test"
});

const imageNote = storage.upsertNote({
  platform: "小红书",
  sourceUrl: "https://www.xiaohongshu.com/explore/filter-image",
  noteId: "filter-image",
  accountId: account.id,
  brand: "Bella ISLA",
  authorName: "测试作者",
  title: "图文测试",
  contentType: "图文笔记",
  marketingGoal: "品牌曝光",
  tags: ["月子"],
  metrics: {},
  status: "已入库"
});
storage.addAssets(imageNote.id, [{ kind: "image", sourceUrl: "https://example.com/image.webp", status: "已保存" }]);

const videoNote = storage.upsertNote({
  platform: "小红书",
  sourceUrl: "https://www.xiaohongshu.com/explore/filter-video",
  noteId: "filter-video",
  brand: "Other Brand",
  authorName: "视频作者",
  title: "视频测试",
  contentType: "视频笔记",
  marketingGoal: "产品种草",
  tags: ["视频"],
  metrics: {},
  status: "已入库"
});
storage.addAssets(videoNote.id, [{ kind: "video", sourceUrl: "https://example.com/video.mp4", status: "已保存" }]);

assert.equal(storage.listNotes({ brand: "Bella ISLA" }).length, 1);
assert.equal(storage.listNotes({ accountId: account.id }).length, 1);
assert.equal(storage.listNotes({ contentType: "视频笔记" }).length, 1);
assert.equal(storage.listNotes({ marketingGoal: "产品种草" }).length, 1);
assert.equal(storage.listNotes({ assetKind: "image" }).length, 1);
assert.equal(storage.listNotes({ assetKind: "video" })[0].title, "视频测试");
assert.equal(storage.listNotes({ q: "月子", assetKind: "image" })[0].title, "图文测试");
assert.equal(storage.listNotes({ brand: "Bella ISLA", assetKind: "video" }).length, 0);

console.log("storage-filter-test passed");
