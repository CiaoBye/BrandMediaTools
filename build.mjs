/*
 * 打包脚本 — 兼容 CJS 的 SEA 打包
 */
import { execSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");
mkdirSync(distDir, { recursive: true });

const nodeExe = process.execPath;
const esbuild = path.join(__dirname, "node_modules", ".bin", "esbuild");
console.log(`Node.js ${process.version}`);

// 1. 打包 CJS
console.log("\n[1/3] 打包 JS (CJS)...");
const bundleOut = path.join(distDir, "bundle.cjs");
execSync(
  `"${esbuild}" "src/server.mjs" --bundle --platform=node --format=cjs --target=node24 --outfile="${bundleOut}" --external:sharp --external:playwright --external:chart.js`,
  { stdio: "inherit", cwd: __dirname }
);

// 2. 验证
console.log("\n[2/3] 验证 bundle...");
try {
  const r = execSync(`"${nodeExe}" -e "require('${bundleOut.replace(/\\/g, '\\\\')}');"`, { timeout: 5000, encoding: "utf8" });
  console.log("  ✅ bundle 可正常加载");
} catch (e) {
  const err = (e.stderr || "").toString().slice(0, 300);
  if (err.includes("server started") || err.includes("启动")) {
    console.log("  ✅ bundle 已启动服务器（正常行为）");
  } else {
    console.log("  ⚠️", err.split("\n")[0]);
  }
}

// 3. SEA
console.log("\n[3/3] 创建 SEA exe...");
writeFileSync(path.join(distDir, "package.json"), JSON.stringify({ type: "commonjs", private: true }));
writeFileSync(path.join(distDir, "sea-config.json"), JSON.stringify({
  main: bundleOut, output: path.join(distDir, "sea.blob"), disableExperimentalSEAWarning: true,
}));
execSync(`"${nodeExe}" --experimental-sea-config "${path.join(distDir, "sea-config.json")}"`, { stdio: "inherit", cwd: __dirname });

const exeOut = path.join(distDir, "BrandMediaTool.exe");
copyFileSync(nodeExe, exeOut);
execSync(`npx --yes postject "${exeOut}" NODE_SEA_BLOB "${path.join(distDir, "sea.blob")}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { stdio: "inherit", cwd: __dirname });

console.log(`\n✅ 完成: ${exeOut}`);
console.log(`大小: ${(readFileSync(exeOut).length / 1024 / 1024).toFixed(1)} MB`);
