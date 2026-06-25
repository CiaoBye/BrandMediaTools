import assert from "node:assert";

// 模拟 shouldFallback 计算逻辑的函数，与 src/crawler/account.mjs 保持一致
function calcShouldFallback(noteUrls, isFirstFollow, successCount, attemptedNewCount) {
  return (
    (noteUrls.length === 0) || 
    (isFirstFollow && successCount === 0) || 
    (attemptedNewCount > 0 && successCount === 0)
  );
}

function runTests() {
  console.log("开始 can-should-fallback 单元测试...");

  // 1. 增量跟随，直连主页成功，但全都是已知笔记（无新笔记）
  // 预期：不降级 (false)
  assert.strictEqual(
    calcShouldFallback(["url1", "url2"], false, 0, 0),
    false,
    "已知笔记全跳过时，不应当触发 fallback"
  );

  // 2. 增量跟随，直连主页失败（被风控，获取列表为空）
  // 预期：应该降级 (true)
  assert.strictEqual(
    calcShouldFallback([], false, 0, 0),
    true,
    "直连主页被拦截获取空链接时，应当触发 fallback"
  );

  // 3. 增量跟随，直连主页成功且有新笔记，但子页解析全部风控失败
  // 预期：应该降级 (true)
  assert.strictEqual(
    calcShouldFallback(["url1", "url2"], false, 0, 2),
    true,
    "发现新笔记但抓取全部失败时，应当触发 fallback"
  );

  // 4. 首次跟随，即使有抓到一部分但抓取成功数为0
  // 预期：应该降级 (true)
  assert.strictEqual(
    calcShouldFallback(["url1"], true, 0, 1),
    true,
    "首次跟随但抓取全部失败时，应当触发 fallback"
  );

  // 5. 首次跟随，获取列表为空
  // 预期：应该降级 (true)
  assert.strictEqual(
    calcShouldFallback([], true, 0, 0),
    true,
    "首次跟随但获取列表为空时，应当触发 fallback"
  );

  console.log("can-should-fallback 所有单元测试断言成功！");
}

runTests();
