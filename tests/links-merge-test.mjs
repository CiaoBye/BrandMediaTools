import assert from "node:assert/strict";
import { extractXhsUrls, mergeXhsLinks } from "../src/xhsCrawler.mjs";

const shareText = [
  "视频分享 https://www.xiaohongshu.com/discovery/item/6a210e2b0000000038034342?source=webshare&xsec_token=valid_token&xsec_source=pc_share",
  "主页 https://www.xiaohongshu.com/user/profile/6464c13e0000000029010651"
].join(" ");

const inputUrls = extractXhsUrls(shareText);
const extractedLinks = [
  "https://www.xiaohongshu.com/explore/6a210e2b0000000038034342",
  "https://www.xiaohongshu.com/explore/6a201838000000003601a74e?xsec_token=live_token"
];

const links = mergeXhsLinks(inputUrls, extractedLinks);

assert.equal(links.length, 2);
assert.ok(links[0].includes("6a210e2b0000000038034342"));
assert.ok(links[0].includes("xsec_token=valid_token"));
assert.ok(links.some((item) => item.includes("6a201838000000003601a74e")));

console.log("links-merge-test passed");
