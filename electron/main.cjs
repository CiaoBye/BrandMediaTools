const { app, BrowserWindow } = require("electron");
const { fork } = require("child_process");
const path = require("path");

let mainWindow;
let serverProcess;

const PORT = 4173;
const SERVER_SCRIPT = path.join(__dirname, "..", "src", "server.mjs");

function startServer() {
  return new Promise((resolve, reject) => {
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

    // 超时保护
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
  console.log("正在启动服务器...");
  await startServer();
  console.log("服务器已就绪，打开窗口...");
  createWindow();
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
