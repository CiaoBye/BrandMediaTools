const { app, BrowserWindow } = require("electron");
const { fork, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let mainWindow;
let serverProcess;

const PORT = 4173;
const SERVER_SCRIPT = path.join(__dirname, "..", "src", "server.mjs");
const PLAYWRIGHT_DIR = path.join(__dirname, "..", "node_modules", "playwright");

function ensurePlaywrightBrowsers() {
  const browsersJson = path.join(PLAYWRIGHT_DIR, "browsers.json");
  if (!fs.existsSync(browsersJson)) {
    console.log("Playwright 未安装，尝试安装浏览器...");
    try {
      execSync("npx playwright install chromium", {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
        timeout: 120000,
      });
      console.log("Playwright 浏览器安装完成");
    } catch (e) {
      console.error("Playwright 浏览器安装失败:", e.message);
    }
  }
}

function startServer() {
  return new Promise((resolve) => {
    serverProcess = fork("node", ["--no-warnings", SERVER_SCRIPT], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(PORT) },
    });

    serverProcess.stdout.on("data", (data) => {
      const msg = data.toString();
      console.log("[server]", msg.trim());
      if (msg.includes("启动") || msg.includes("started") || msg.includes(PORT)) {
        setTimeout(resolve, 1000);
      }
    });

    serverProcess.stderr.on("data", (data) => {
      console.error("[server]", data.toString().trim());
    });

    serverProcess.on("exit", (code) => {
      console.log(`服务器退出 (code=${code})`);
    });

    setTimeout(() => resolve(), 15000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "品牌内容情报工具",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.on("closed", () => (mainWindow = null));
}

app.whenReady().then(async () => {
  console.log("初始化...");
  ensurePlaywrightBrowsers();
  console.log("正在启动服务器...");
  await startServer();
  console.log("服务器已就绪");
  createWindow();
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
