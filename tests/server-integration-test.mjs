import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";

const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));

const child = spawn(process.execPath, ["--no-warnings", "src/server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

async function request(pathname, options) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { response, body, text };
}

try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const { response } = await request("/api/health");
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `服务器未启动\n${stdout}\n${stderr}`);

  const health = await request("/api/health");
  assert.equal(health.response.status, 200);
  assert.ok(health.response.headers.get("content-security-policy"));

  const weekly = await request("/api/reports/weekly-brief");
  assert.equal(weekly.response.status, 200, weekly.text);
  assert.equal(weekly.body.type, "weekly");

  const monthly = await request("/api/reports/monthly-review");
  assert.equal(monthly.response.status, 200, monthly.text);
  assert.equal(monthly.body.type, "monthly");

  const analysis = await request("/api/stats/content-analysis?range=30");
  assert.equal(analysis.response.status, 200);
  if (analysis.body.totalNotes > 0) {
    assert.ok(analysis.body.engagementStats.totalNotes > 0, "有笔记时互动统计不应全部被跳过");
  }

  const chart = await request("/vendor/chart.umd.js");
  assert.equal(chart.response.status, 200);
  assert.match(chart.text, /Chart/);

  const forbidden = await request("/files/public/favicon.svg");
  assert.equal(forbidden.response.status, 403);

  const settings = await request("/api/settings");
  assert.equal(settings.response.status, 200);
  assert.ok(Object.hasOwn(settings.body, "notification"));

  const index = await request("/");
  assert.equal(index.response.status, 200);
  assert.doesNotMatch(index.text, /\son(?:click|error|mouseover|mouseout|change|input)=/i);
  const appJs = await request("/app.js");
  assert.equal(appJs.response.status, 200);
  assert.doesNotMatch(appJs.text, /\son(?:click|error|mouseover|mouseout|change|input)=/i);

  const createdTask = await request("/api/scheduled-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "集成测试任务", taskType: "crawl", config: { url: "https://example.invalid" }, intervalMinutes: 60, enabled: true })
  });
  assert.equal(createdTask.response.status, 201);
  const pausedTask = await request(`/api/scheduled-tasks/${createdTask.body.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false })
  });
  assert.equal(pausedTask.response.status, 200);
  assert.equal(pausedTask.body.enabled, false);
  const deletedTask = await request(`/api/scheduled-tasks/${createdTask.body.id}`, { method: "DELETE" });
  assert.equal(deletedTask.response.status, 200);

  console.log("server-integration-test passed");
} finally {
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}
