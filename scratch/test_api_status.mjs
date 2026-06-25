import { startSignServer, stopSignServer, fetchUserPosted, readApiCookie, apiGet } from "../src/xhsApiClient.mjs";
import path from "node:path";

async function main() {
  const rootDir = process.cwd();
  console.log("准备启动 signserver...");
  try {
    await startSignServer(rootDir);
    console.log("signserver 启动成功。");
    
    const cookie = readApiCookie(rootDir);
    console.log(`读取到的 API Cookie 长度: ${cookie ? cookie.length : 0}`);
    if (!cookie) {
      console.error("没有找到 Cookie，测试可能无法正常签名！请在 data/xhs-cookie.txt 写入可用 Cookie，或直接测试接口是否返回 404/406/496。");
    }

    const testUserId = "6464c13e0000000029010651"; // 艾屿月子
    console.log(`正在请求 API fetchUserPosted (userId=${testUserId})...`);
    
    // 直接尝试调用接口并拦截请求结果
    // 捕获可能产生的各种网络/风控状态
    try {
      const res = await fetchUserPosted(testUserId, "", 10, cookie);
      console.log("接口返回原始结果:", JSON.stringify(res, null, 2));
    } catch (apiErr) {
      console.error("API 调用直接抛出异常:", apiErr.message);
    }
  } catch (err) {
    console.error("初始化/运行测试失败:", err.message);
  } finally {
    console.log("正在停止 signserver...");
    stopSignServer();
  }
}

main();
