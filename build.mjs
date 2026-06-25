/*
 * SEA 打包脚本 — 将 server.mjs 打包为单 exe
 * 使用 Node.js 24 内置的 Single Executable Application 功能
 *
 * 用法: node build.mjs
 * 输出: dist/BrandMediaTool.exe
 *
 * 注意：exe 需要与 node_modules/ (playwright, sharp) 和 public/ 在同一目录
 */
import { execSync } from "node:child_process";
import { existsSync, copyFileSync, renameSync, unlinkSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");

// 确保 noint.js 存在（SEA 需要）
const nodeExe = process.execPath;
const nodeVersion = process.version;
console.log(`Node.js ${nodeVersion}`);
console.log("Node exe:", nodeExe);

// Step 1: 用 esbuild 打包 server.mjs（native modules 标记为 external）
console.log("\n[1/5] 打包 JS...");
const esbuild = path.join(__dirname, "node_modules", ".bin", "esbuild");
const bundleEntry = path.join(__dirname, "src", "server.mjs");
const bundleOut = path.join(distDir, "bundle.mjs");

try {
  execSync(
    `"${esbuild}" "${bundleEntry}" --bundle --platform=node --format=esm --outfile="${bundleOut}" --external:sharp --external:playwright --external:http-proxy-agent --external:https-proxy-agent --external:chart.js`,
    { stdio: "inherit", cwd: __dirname }
  );
} catch {
  console.error("esbuild 失败，请确保已安装: npm install esbuild");
  process.exit(1);
}

// 检查 bundle 大小
const bundleSize = existsSync(bundleOut) ? readFileSync(bundleOut).length : 0;
console.log(`  bundle: ${(bundleSize / 1024).toFixed(0)} KB`);

// Step 2: 创建 SEA 配置
console.log("\n[2/5] 创建 SEA 配置...");
const seaConfig = {
  main: bundleOut,
  output: path.join(distDir, "sea.blob"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};
const configPath = path.join(distDir, "sea-config.json");
writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));

// Step 3: 生成 SEA blob
console.log("\n[3/5] 生成 SEA blob...");
execSync(`node --experimental-sea-config "${configPath}"`, { stdio: "inherit", cwd: __dirname });

const blobPath = path.join(distDir, "sea.blob");
if (!existsSync(blobPath)) {
  console.error("SEA blob 生成失败");
  process.exit(1);
}
console.log(`  blob: ${(readFileSync(blobPath).length / 1024).toFixed(0)} KB`);

// Step 4: 复制 node.exe
console.log("\n[4/5] 复制 Node.js 运行时...");
const exeOut = path.join(distDir, "BrandMediaTool.exe");
copyFileSync(nodeExe, exeOut);

// Step 5: 移除签名 + 注入 blob（Windows 需要）
console.log("\n[5/5] 注入 SEA blob...");

// 尝试用 postject 或手动注入
try {
  // 优先用 postject
  execSync(`npx postject "${exeOut}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, {
    stdio: "inherit", cwd: __dirname,
  });
} catch {
  // postject 可能没装，手动安装
  console.log("  安装 postject...");
  execSync(`npm install -g postject`, { stdio: "inherit", cwd: __dirname });
  console.log("  重新注入...");
  execSync(`npx postject "${exeOut}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, {
    stdio: "inherit", cwd: __dirname,
  });
}

console.log(`\n✅ 打包完成: ${exeOut}`);
console.log(`大小: ${(readFileSync(exeOut).length / 1024 / 1024).toFixed(1)} MB`);
console.log("\n注意事项:");
console.log("  1. exe 需要与 node_modules/ 在同一目录才能运行");
console.log("  2. Playwright 浏览器需安装: npx playwright install chromium");
console.log("  3. 双击运行，浏览器访问 http://127.0.0.1:4173");
