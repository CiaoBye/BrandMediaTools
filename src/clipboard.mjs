import { execFileSync } from "node:child_process";

export function readClipboardText() {
  if (process.env.XHS_CLIPBOARD_TEXT) return process.env.XHS_CLIPBOARD_TEXT;

  if (process.platform === "win32") {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], {
      encoding: "utf8",
      windowsHide: true
    }).trim();
  }

  if (process.platform === "darwin") {
    return execFileSync("pbpaste", [], { encoding: "utf8" }).trim();
  }

  for (const command of ["wl-paste", "xclip", "xsel"]) {
    try {
      if (command === "xclip") return execFileSync(command, ["-selection", "clipboard", "-out"], { encoding: "utf8" }).trim();
      if (command === "xsel") return execFileSync(command, ["--clipboard", "--output"], { encoding: "utf8" }).trim();
      return execFileSync(command, [], { encoding: "utf8" }).trim();
    } catch {
      // Try the next clipboard command.
    }
  }

  throw new Error("未找到可用的剪贴板读取工具。Windows 使用 PowerShell，macOS 使用 pbpaste，Linux 可安装 wl-paste/xclip/xsel。");
}
