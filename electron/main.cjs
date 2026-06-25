const { app, BrowserWindow } = require("electron");
const { fork } = require("child_process");
const path = require("path");
const fs = require("fs");

let mainWindow;
let serverProcess;

const PORT = 4173;
const SERVER_SCRIPT = path.join(__dirname, "..", "src", "server.mjs");

function getBrowsersPath() {
  // 打包后: resources/chromium-1223/
  // 开发时: .browser-cache/chromium-1223/
  const packed = path.join(process.resourcesPath, "chromium-1223");
  if (fs.existsSync(packed)) return packed;
  const dev = path.join(__dirname, "..", ".browser-cache", "chromium-1223");
  if (fs.existsSync(dev)) return dev;
  return "";
}

function startServer() {
  return new Promise((resolve) => {
    const browserPath = getBrowsersPath();
    const env = { ...process.env, PORT: String(PORT) };
    if (browserPath) {
      env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
      console.log("[electron] Playwright 浏览器路径:", browserPath);
    }

    serverProcess = fork("node", ["--no-warnings", SERVER_SCRIPT], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
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
