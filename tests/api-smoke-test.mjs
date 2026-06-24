import http from "node:http";

const TESTS = [
  { u: "/api/health", n: "Health" },
  { u: "/api/stats", n: "Stats" },
  { u: "/api/stats/interaction", n: "Interaction" },
  { u: "/api/stats/top-notes?limit=3", n: "TopNotes" },
  { u: "/api/stats/tag-cloud?limit=3", n: "TagCloud" },
  { u: "/api/stats/content-analysis?range=30", n: "ContentAnalysis" },
  { u: "/api/reports/weekly-brief", n: "WeeklyBrief" },
  { u: "/api/reports/monthly-review", n: "MonthlyReview" },
  { u: "/api/notes/libraries", n: "Libraries" },
  { u: "/api/xhs-accounts", n: "XhsAccounts" },
  { u: "/api/scheduled-tasks", n: "ScheduledTasks" },
  { u: "/", n: "index.html" },
];

const BASE = "http://127.0.0.1:4173";
let passed = 0, failed = 0;

function run(i) {
  if (i >= TESTS.length) {
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
    return;
  }
  const t = TESTS[i];
  const start = Date.now();
  http.get(BASE + t.u, (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      const dur = Date.now() - start;
      const isHTML = res.headers["content-type"]?.includes("text/html");
      const statusOK = res.statusCode === 200 || res.statusCode === 304;
      if (statusOK) {
        passed++;
        const summary = isHTML ? `HTML ${d.length}b` : `JSON ${d.length}b keys=${Object.keys(JSON.parse(d)).slice(0, 6).join(",")}`;
        console.log(`  ✓ ${t.n.padEnd(18)} ${dur}ms  ${summary}`);
      } else {
        failed++;
        console.log(`  ✗ ${t.n.padEnd(18)} ${dur}ms  HTTP ${res.statusCode}`);
      }
      run(i + 1);
    });
  }).on("error", (e) => {
    failed++;
    console.log(`  ✗ ${t.n.padEnd(18)} ERR  ${e.message}`);
    run(i + 1);
  });
}

console.log("API Smoke Test - " + new Date().toISOString());
run(0);
