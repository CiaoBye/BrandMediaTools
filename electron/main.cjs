const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

let mainWindow;

const PORT = 4173;

function getBrowsersPath() {
  const packed = path.join(process.resourcesPath, "chromium-1223");
  if (fs.existsSync(packed)) return packed;
  const dev = path.join(__dirname, "..", ".browser-cache", "chromium-1223");
  if (fs.existsSync(dev)) return dev;
  return "";
}

async function startServer() {
  const browserPath = getBrowsersPath();
  if (browserPath) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
    console.log("[electron] Playwright 浏览器路径:", browserPath);
  }
  process.env.PORT = String(PORT);

  // 设置数据目录为可写位置（避免 asar 只读）
  const userDataPath = app.getPath("userData");
  process.env.APP_DATA_DIR = userDataPath;
  console.log("[electron] 数据目录:", userDataPath);

  // 确保 data/ 目录存在
  const dataDir = path.join(userDataPath, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // 设置 public 目录路径（打包后 from asar.unpacked，开发时 from 源码）
  const publicDev = path.join(__dirname, "..", "public");
  const publicPacked = path.join(process.resourcesPath, "app.asar.unpacked", "public");
  process.env.APP_PUBLIC_DIR = fs.existsSync(publicPacked) ? publicPacked : publicDev;
  console.log("[electron] public 目录:", process.env.APP_PUBLIC_DIR);

  // 启动服务器
  const serverPath = path.join(__dirname, "..", "src", "server.mjs");
  const serverUrl = pathToFileURL(serverPath).href;
  try {
    await import(serverUrl);
    console.log("[electron] 服务器已启动");
  } catch (e) {
    console.error("[electron] 服务器启动失败:", e.message);
    throw e;
  }
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
  try {
    await startServer();
    console.log("服务器已就绪");
    createWindow();
  } catch (e) {
    console.error("启动失败:", e);
    dialog.showErrorBox("启动失败", `服务器无法启动:\n${e.message}\n\n请确认没有被防火墙拦截。`);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
