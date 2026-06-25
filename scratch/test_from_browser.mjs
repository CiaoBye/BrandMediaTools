import { saveXhsCookieFromBrowser } from "../src/crawler/auth.mjs";

async function main() {
  const rootDir = process.cwd();
  console.log("准备运行 saveXhsCookieFromBrowser...");
  try {
    const result = await saveXhsCookieFromBrowser(rootDir, { waitMs: 8000 });
    console.log("提取成功！结果如下:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("提取失败！详细异常堆栈如下:");
    console.error(err);
  }
}

main();
