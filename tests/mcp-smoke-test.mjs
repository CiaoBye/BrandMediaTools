import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["--no-warnings", "src/mcpServer.mjs"], {
  cwd: rootDir,
  stdio: ["pipe", "pipe", "pipe"]
});

let stdout = Buffer.alloc(0);
let stderr = "";

child.stdout.on("data", (chunk) => {
  stdout = Buffer.concat([stdout, chunk]);
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function readMessages() {
  const messages = [];
  let buffer = stdout;
  while (buffer.length) {
    const text = buffer.toString("utf8");
    const headerEnd = text.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = text.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;
    const length = Number(match[1]);
    const bodyStart = Buffer.byteLength(text.slice(0, headerEnd + 4), "utf8");
    if (buffer.length < bodyStart + length) break;
    messages.push(JSON.parse(buffer.slice(bodyStart, bodyStart + length).toString("utf8")));
    buffer = buffer.slice(bodyStart + length);
  }
  return messages;
}

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "xhs_links",
    arguments: {
      url: "https://www.xiaohongshu.com/discovery/item/6a210e2b0000000038034342?xsec_token=test"
    }
  }
});

await new Promise((resolve) => setTimeout(resolve, 500));
child.kill();

const messages = readMessages();
const initialize = messages.find((message) => message.id === 1);
const list = messages.find((message) => message.id === 2);
const call = messages.find((message) => message.id === 3);

if (!initialize?.result?.serverInfo?.name) {
  throw new Error(`MCP initialize 失败：${stderr || JSON.stringify(messages)}`);
}

const toolNames = (list?.result?.tools || []).map((tool) => tool.name);
for (const required of ["xhs_detail", "xhs_links"]) {
  if (!toolNames.includes(required)) {
    throw new Error(`MCP tools/list 缺少 ${required}：${JSON.stringify(toolNames)}`);
  }
}

const callPayload = JSON.parse(call?.result?.content?.[0]?.text || "{}");
if (callPayload.count !== 1 || !callPayload.links?.[0]?.includes("6a210e2b0000000038034342")) {
  throw new Error(`MCP xhs_links 作品链接直返失败：${JSON.stringify(callPayload)}`);
}

console.log(JSON.stringify({ ok: true, tools: toolNames, linkCall: callPayload }, null, 2));
