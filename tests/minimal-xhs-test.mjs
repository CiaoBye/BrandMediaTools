import { crawlXhs, extractXhsUrls } from "../src/xhsCrawler.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const samples = [
  {
    name: "视频链接",
    brand: "Bella ISLA艾屿月子",
    input:
      "59 【屿间风吟｜下午三点，一场声音织就的停顿 - Bella ISLA艾屿月子 | 小红书 - 你的生活兴趣社区】 😆 gTFsyeEwOgrjhpj 😆 https://www.xiaohongshu.com/discovery/item/6a210e2b0000000038034342?source=webshare&amp;xhsshare=pc_web&amp;xsec_token=ABOUdvMA94bHXNyXoQG3VfHgB5dg0rV3ixhaAofXtR3Qc=&amp;xsec_source=pc_share ，这是视频链接。"
  },
  {
    name: "Live 图文链接",
    brand: "Bella ISLA艾屿月子",
    input:
      "68 【艾屿疗愈月子｜完成一场深度的能量清理 - Bella ISLA艾屿月子 | 小红书 - 你的生活兴趣社区】 😆 W5hXmzNnx68b4gt 😆 https://www.xiaohongshu.com/discovery/item/6a201838000000003601a74e?source=webshare&amp;xhsshare=pc_web&amp;xsec_token=ABtnqS0POoxkI-W9AHI6T85L92P8JZTXEeLAGbxnYZey0=&amp;xsec_source=pc_share ，这是图文链接，图片为live图，需要能成功解析出。"
  },
  {
    name: "项目主页",
    brand: "Bella ISLA艾屿月子",
    input:
      "https://www.xiaohongshu.com/user/profile/6464c13e0000000029010651?xsec_token=AB9xwn-kwQRqup9Sc2CIReKNQoT-ev99o0ee4sLhmn5Uk%3D&amp;xsec_source=pc_search  这是项目主页。"
  }
];

function summarize(note) {
  const assets = note.assets || [];
  return {
    sourceUrl: note.sourceUrl,
    title: note.title,
    contentType: note.contentType,
    status: note.status,
    reviewReason: note.reviewReason,
    assetCount: assets.length,
    imageCount: assets.filter((asset) => asset.kind === "image").length,
    videoCount: assets.filter((asset) => asset.kind === "video").length,
    livePhotoCount: assets.filter((asset) => asset.kind === "livePhoto").length,
    livePhotoPairs: assets
      .filter((asset) => asset.kind === "livePhoto")
      .slice(0, 8)
      .map((asset) => ({
        pairedImageIndex: asset.pairedImageIndex,
        resolution: asset.resolution,
        source: asset.source,
        url: (asset.sourceUrl || "").slice(0, 120)
      })),
    firstAssets: assets.slice(0, 5).map((asset) => ({
      kind: asset.kind,
      watermarkStatus: asset.watermarkStatus,
      resolution: asset.resolution,
      source: asset.source,
      imageIndex: asset.imageIndex,
      pairedImageIndex: asset.pairedImageIndex,
      url: (asset.sourceUrl || "").slice(0, 120)
    }))
  };
}

const results = [];
for (const sample of samples) {
  const urls = extractXhsUrls(sample.input);
  const sampleResult = { name: sample.name, parsedUrls: urls, notes: [], error: "" };
  for (const url of urls) {
    try {
      const notes = await crawlXhs(
        {
          url,
          brand: sample.brand,
          tags: ["最小功能测试"]
        },
        {
          rootDir,
          maxNotes: sample.name === "项目主页" ? 5 : 1
        }
      );
      sampleResult.notes.push(...notes.map(summarize));
    } catch (error) {
      sampleResult.error = error.stack || error.message;
    }
  }
  results.push(sampleResult);
}

console.log(JSON.stringify(results, null, 2));
