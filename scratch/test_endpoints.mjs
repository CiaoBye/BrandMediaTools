import fs from "node:fs";

const cookie = fs.readFileSync("data/xhs-cookie.txt", "utf8").trim();
const ck = {};
cookie.split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) ck[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
console.log("Cookie a1:", !!ck.a1, "web_session:", !!ck.web_session);

const testCases = [
  ["/api/sns/web/v1/feed", "post", { source_note_id: "66d34b3a000000001b00e4b9" }],
  ["/api/sns/web/v1/user_posted", "get", { user_id: "5e5f7f36000000000100e4b9", num: "30" }],
  ["/api/sns/web/v1/search/notes", "post", { keyword: "test", page_size: 10, sort: "general", note_type: 0 }],
  ["/api/sns/web/v1/user/otherinfo", "post", { user_id: "5e5f7f36000000000100e4b9" }],
];

async function testOne(uri, method, payload, params) {
  const signResp = await fetch("http://127.0.0.1:9223", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri, cookies: ck, method, params: params || {}, payload: payload || {}, sign_format: "xyw" }),
  });
  const signResult = await signResp.json();
  if (!signResult.ok) { console.log(`  ${uri} 签名失败: ${signResult.error}`); return; }

  const opts = {
    headers: {
      ...signResult.headers,
      Cookie: cookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      "Content-Type": "application/json",
    },
  };
  let url;
  if (method === "post") {
    opts.method = "POST";
    opts.body = JSON.stringify(payload);
    url = "https://edith.xiaohongshu.com" + uri;
  } else {
    const qs = new URLSearchParams(params || {}).toString();
    url = "https://edith.xiaohongshu.com" + uri + (qs ? "?" + qs : "");
  }

  const resp = await fetch(url, opts);
  const text = await resp.text();
  const summary = text.length > 120 ? text.slice(0, 120) + "..." : text;
  console.log(`  ${uri} HTTP ${resp.status} | ${summary}`);
}

async function main() {
  for (const [uri, method, payload, params] of testCases) {
    console.log(`\n测试: ${method.toUpperCase()} ${uri}`);
    await testOne(uri, method, payload, params);
  }
  console.log("\n=== 测试完成 ===");
}

main().catch(console.error);
