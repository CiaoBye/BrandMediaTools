# 品牌内容情报与分析工具 — 结构化审计报告

审计日期：2026-06-29 | 版本：v1.13.5 | 审计人：Codex

---

## 一、项目核心链路理解

```
用户输入（分享链接 / 账号主页 / 搜索词）
  ↓
extractXhsUrls / extractXhsUrl — 链接提取（短链 xhslink.com + 完整 URL + xsec_token）
  ↓
fetchNoteViaHttp — HTTP 快速路径（默认无 Cookie，解析 __INITIAL_STATE__）
  ├─ 成功且有素材 → 入库
  └─ 失败或无素材 → crawlWithFallback → Playwright SSR 兜底
      ├─ extractNote（DOM + SSR 状态 + 网络响应拦截）
      └─ 仍失败 → og:image/og:video HTML meta 兜底
  ↓
素材解析（image / video / livePhoto / cover）
  bestImageUrl / bestImageUrls / bestStreamUrl / bestVideoStreams
  ↓
upsertNote → SQLite notes 表
persistNoteAssets → 下载引擎（part 文件 → Range 续传 → rename）
addAssets → SQLite assets 表
  ↓
内容分析（病毒性 / AI 拆解 / 内容统计 / 周报月报）
账号追踪（followAccount → extractAccountLinks → HTTP 优先 → Playwright 降级）
```

**关键设计决策**：双层采集策略（HTTP 快速路径优先，Playwright 降级兜底），与 XHS-Downloader 的思路一致但完全独立实现。所有 v1 API 已封禁，Playwright SSR 是唯一可靠路径。

---

## 二、高风险模块排序

| 风险等级 | 文件/函数 | 负责功能 | 为什么高风险 | 建议重点检查点 |
|----------|-----------|---------|-------------|---------------|
| **P0** | `src/crawler/auth.mjs:saveXhsCookieFromBrowser` | 专用浏览器 Cookie 提取 | CDP 与 interactive 模式切换逻辑、while 循环 deadline 计算、page.goto 超时无 fallback | interactive=true 时是否真正弹出可见窗口；CDP 失败后是否降级到 createBrowser |
| **P0** | `src/crawler/extract.mjs:fetchNoteViaHttp` | HTTP 快速路径采集 | 双层策略首层，所有采集的默认入口 | 短链 resolveShortLink 是否真正调用；多 URL 形态降级是否生效；og:image/og:video 兜底在无 __INITIAL_STATE__ 时是否回退 |
| **P0** | `src/xhsAuth.mjs:checkCookieValid` | Cookie 登录态校验 | 手动粘贴 + 专用浏览器 + 定时任务 + 健康巡检全部依赖此函数 | isGuest 放松逻辑是否仍会拒真登录态；Set-Cookie 多表头提取是否正确更新 a1 |
| **P1** | `src/crawler/account.mjs:followAccount` | 账号追踪采集 | 全部采集几乎必经 followAccount，双层降级逻辑复杂 | HTTP 快速路径失败后是否降级到 Playwright；knownNoteIds 去重是否严谨；并行采集 (accountParallelTabs) 是否线程安全 |
| **P1** | `src/storage/note-store.mjs:addAssets` | 素材入库 | DELETE + INSERT 覆盖写入，事务中间状态风险 | `if (!list.length) return` 提前返回不走 BEGIN/COMMIT，导致后续调用 BEGIN 时 SQLite 行为不确定性 |
| **P1** | `src/scheduler.mjs:runSchedulerCycle` | 定时任务执行 | 健康巡检 + 自动刷新 Cookie + 任务执行耦合在一起 | follow 任务中 cookie 获取失败时 resolveCookie 是否正确兜底；task_lock 的 _runningTasks 是内存级 Set，多进程部署时完全无效 |
| **P1** | `src/downloader.mjs:downloadFile` | 文件下载引擎 | Range 续传 + part 文件 + 格式转换，涉及多个文件系统原子操作 | 非 206 响应时 unlinkSync(tmpPath) + continue 是否会导致死循环；renameSync(tmpPath, targetPath) 跨设备时是否抛出 EXDEV |
| **P2** | `src/xhsSdk.mjs:createBrowser` | Playwright 浏览器创建 | 所有 Playwright 采集共用此函数 | cdPort > 0 时 tryConnectCdp 失败后是否真的降级到常规 launch；launchOpts 不含 timeout 可能无限等待 |

---

## 三、确定性问题

### P0 级

| 文件/函数 | 问题 | 触发条件 | 影响 | 修复建议 | 建议测试 |
|-----------|------|---------|------|---------|---------|
| `auth.mjs:saveXhsCookieFromBrowser` 第 104 行 | `deadline = Date.now() + waitMs` 在函数入口计算，但 `createBrowser` 和 `page.goto` 可能耗费大量时间，导致 while 循环实际可用时间远小于 waitMs。默认 waitMs=120000，但 createBrowser ~5s + page.goto ~8s + sleep(2500) = ~15.5s 已消耗，用户实际只剩 ~104s | 首次绑定（需要创建浏览器 + 导航） | 用户在登录时可能因剩余时间不足而超时，但前端显示为 "提取失败" | 将 deadline 移到 while 循环之前重新计算，或把 waitMs 用于 while 循环计时而非总计时 | waitMs=5000 时，while 循环应在 ~5s 内退出，而非 18s |
| `extract.mjs:fetchNoteViaHttp` 第 180-190 行 | `resolveShortLink` 的动态 import 可能不稳定，且如果模块加载失败错误被 catch 吞掉 | 短链输入时 | 短链解析降级走旧 HEAD 方法，不影响功能但增加延迟 | 改为文件顶部静态 import `resolveShortLink` | 短链 + 无 xsec_token 的笔记 URL 端到端采集 |
| `xhsAuth.mjs:checkCookieValid` 第 228-231 行 | a1 提取第二个 regex `sc.match(/name=([^;]+).*?value=([^;]+)/i)` 在实际 Set-Cookie 格式中几乎不可能匹配 | 正常 Cookie 刷新场景 | a1 字段错失更新，但不会导致登录态失效 | 建议记录为已知限制，不需要修复 | — |
| `account.mjs:followAccount` 第 153-173 行 | HTTP 快速路径部分成功 + 部分失败，降级 Playwright 时 `seenNoteIds.delete(noteId)` 回滚了所有 noteId（包括已成功的） | HTTP 路径部分成功 | 已成功的笔记在 Playwright 路径中被重复采集，可能导致重复入库 | 降级时不重置 seenNoteIds，只 re-process HTTP 失败的 note | 半成功的 followAccount 不会产生重复笔记 |

### P1 级

| 文件/函数 | 问题 | 触发条件 | 影响 | 修复建议 | 建议测试 |
|-----------|------|---------|------|---------|---------|
| `note-store.mjs:addAssets` 第 138 行 | `if (!list.length) return listAssetsByNote(noteId);` — 没有 list 时直接 return，不走 BEGIN/COMMIT。若外部已开启事务，这个 return 导致事务悬空 | addAssets 在外部事务中调用 | 事务泄漏，后续 SQL 操作行为不确定 | 去掉早期 return，让空列表也走完整事务路径 | 空 assets 数组传入 addAssets |
| `downloader.mjs:downloadFile` 第 79-82 行 | `useRange && response.status !== 206` 时 `unlinkSync(tmpPath); continue;` — 如果服务器始终不支持 Range，会无限重试直到 maxRetry 耗尽 | XHS 服务器返回 200 而非 206 | maxRetry 被浪费，最终失败不影响数据一致性 | 在 continue 前设置 `useRange = false` | Range 续传时服务器始终返回 200 的场景 |
| `scheduler.mjs:runSchedulerCycle` 第 113-121 行 | follow 任务的 knownNoteIds 过滤：只保留 `findNoteBySourceUrl` 存在的 ID。被用户手动删除的笔记下次 follow 时会重新采集 | 用户在内容库删除了某条笔记 | 被删除的笔记被重新采集入库，而非跳过 | knownNoteIds 应跟踪所有已见过的 noteId，不管笔记是否还在库中 | 删除笔记后 follow 不会重新采集 |
| `server.mjs:xhs-cookie/from-browser` 第 774-785 行 | `saveXhsCookieFromBrowser` 返回后重新读取文件并 upsert。两层写入无同步机制，并发请求时可能覆盖 | 高并发请求 | 最终一致性无问题，但浪费一次文件读取 | 让 saveXhsCookieFromBrowser 直接返回 cookieString | 不需要修改 |

---

## 四、疑似问题

| 文件/函数 | 疑点 | 为什么可疑 | 如何验证 |
|-----------|------|-----------|---------|
| `xhsSdk.mjs:resolveShortLink` 第 308-334 行 | HEAD 请求 `redirect: "manual"` 在 Node.js fetch 中是否真的收到 302/301 的 Location？不同 Node.js 版本行为有差异 | Node.js `redirect: "manual"` 行为不跨版本一致 | 用真实 `xhslink.com` 短链测试，记录 hops 和 finalUrl |
| `crawler/auth.mjs:saveXhsCookieFromBrowser` 第 95-98 行 | `page.goto`.catch(()=>{}) 吞掉了所有错误。如果 explore 页面永远无法加载，用户看到的是空白窗口而非错误消息 | 用户反馈 "绑定点击后无效" 的根因可能是静默吞错 | 在 catch 中添加 `console.warn` 观察日志 |
| `downloader.mjs:convertImage` 第 24-45 行 | sharp 转换后的目标路径 `sourcePath.replace(/\.[^.]+$/, '.ext')` 如果 sourcePath 无扩展名，替换不生效 | 无扩展名的临时文件 | 构造无扩展名的图片 URL 测试 |
| `xhsSdk.mjs:extractNoteFromState` 第 283 行 | `Object.keys().filter(k => k !== "__proto__")` — Object.keys 不会枚举原型属性，过滤多余 | Object.keys 行为确认 | 移除后测试依然通过 |
| `storage/note-store.mjs:batchHydrateNotes` 第 37-43 行 | SQL 拼接 `"IN (" + placeholders + ")"`，noteIds 类型未验证。空值或非 UUID 值行为不确定 | 空数组或含 null 的数组 | 添加 noteIds 类型检查 |

---

## 五、优化建议

### P0 — 必须修复

| 问题 | 收益 | 风险 |
|------|------|------|
| `fetchNoteViaHttp` 中 `resolveShortLink` 的 dynamic import 改为静态 import | 减少一次异步 import 开销，确保出错时不再被吞掉 | 无风险，xhsSdk.mjs 已在当前文件中静态 import 了多个函数 |
| `saveXhsCookieFromBrowser` 中 deadline 改为在 while 循环前重新计算 | 用户实际可用登录时间更准确 | 无风险 |
| `account.mjs:followAccount` 降级时不重置 seenNoteIds | 避免重复采集 | 可能导致部分已采集笔记在 Playwright 路径中被再次处理（upsertNote 会去重） |

### P1 — 建议修复

| 问题 | 收益 | 风险 |
|------|------|------|
| `addAssets` 早期 return 改为正常事务路径 | 消除事务泄漏风险 | 无风险 |
| `scheduler.mjs` follow 任务的 knownNoteIds 全部保留而非仅保留 DB 中存在的 | 删除笔记后不会重新采集 | 可能导致 knownNoteIds 无限增长（JSON 序列化的数组大小可控） |
| `downloadFile` 非 206 响应时设置 `useRange = false` 再重试 | 减少重试次数 | 无风险 |

### P2 — 可做可不做

| 问题 | 收益 | 风险 |
|------|------|------|
| `createBrowser` 的 `launchOpts` 中添加 `timeout: 30000` | 防止 `chromium.launch()` 无限等待 | 低 |
| `extractNoteFromState` 中移除多余的 `__proto__` 过滤 | 代码简洁 | 无 |
| `scheduler.mjs` 的 `_runningTasks` 改为持久化任务锁 | 支持多进程部署 | 高（需要重构） |

---

## 六、测试缺口

当前测试共 17 个用例文件。最应补充的 10 个测试：

| # | 测试内容 | 输入 | 预期结果 | 建议测试文件 |
|---|---------|------|---------|------------|
| 1 | **fetchNoteViaHttp 多 URL 形态降级** | 无 xsec_token 的笔记 URL | 自动尝试 `/discovery/item/{noteId}` 和 `xsec_source=pc_note`；og:image/og:video 兜底素材被正确提取 | `tests/fallback-url-regression-test.mjs` |
| 2 | **saveXhsCookieFromBrowser interactive vs non-interactive CDP 跳转** | `{interactive: true}` 和 `{interactive: false}` 分别调用 | interactive=true 时跳过 CDP；CDP 失败时降级到 createBrowser；错误消息明确 | `tests/browser-auth-regression-test.mjs` |
| 3 | **followAccount 半成功降级重复采集** | HTTP 路径 3 条成功 + 2 条失败，降级 Playwright | 失败 2 条被 Playwright 采集且不与成功 3 条重复 | `tests/follow-account-dedup-test.mjs` |
| 4 | **addAssets 空数组 + 事务边界** | 多次调用 `addAssets(noteId, [])` 后再调用 `addAssets(noteId, realAssets)` | 空数组不破坏事务状态，随后真实素材正常入库 | `tests/storage-transaction-test.mjs` |
| 5 | **scheduler follow knownNoteIds 跨删除保留** | 入库笔记→手动删除→定时 follow | 已删除笔记的 noteId 仍保留在 knownNoteIds 中，不会重新采集 | `tests/scheduler-follow-consistency-test.mjs` |
| 6 | **resolveShortLink 多级跳转** | 真实 `xhslink.com` 短链（或 mock HTTP 302 服务） | 最多 5 跳后解析出 finalUrl、noteId、xsecToken | `tests/shortlink-resolve-test.mjs` |
| 7 | **mergeXhsLinks xsecTokenResults 格式** | 混合 xsec_token URL 和无 token URL | 返回对象数组含 `url`/`hasXsecToken`/`noteId`；API 响应包含 `xsecTokenResults` | 扩展 `tests/links-merge-test.mjs` |
| 8 | **notes 表 ip_location/lastUpdateTime/cover_url 迁移兼容** | 旧数据库（无这 3 列）→ 启动新代码 | ALTER TABLE 静默成功；旧笔记返回 null 而非崩溃 | `tests/storage-migration-test.mjs` |
| 9 | **saveXhsCookieFromBrowser 超时路径检查** | `waitMs=1000` + `interactive=false`，期望在 3 秒内返回错误而非挂起 | 返回 "专用浏览器当前不是有效登录态" 或类似错误 | `tests/browser-auth-regression-test.mjs` |
| 10 | **checkCookieValid 多重 Set-Cookie** | mock HTTP server 返回多个 Set-Cookie 头 | `headers.forEach` 正确提取所有 Set-Cookie；a1 字段被正确更新 | 扩展 `tests/cookie-auth-state-test.mjs` |

---

## 七、建议下一步

**优先修复（P0）：**

1. **`saveXhsCookieFromBrowser` deadline 计算** — 把 `deadline` 移到 while 循环前重新计算，让用户有完整的 waitMs 时间登录。当前实现消耗了 ~15s 在 createBrowser + page.goto 上，用户实际可用时间缩短 12%。

2. **`followAccount` 降级时 seenNoteIds 重置** — 当前 HTTP 部分成功后降级会清空 seenNoteIds 导致重复入库。改为只回滚失败的 noteId。

3. **`addAssets` 早期 return 事务泄漏** — 空数组时直接 return 不走 BEGIN/COMMIT，若外部已开启事务会导致事务悬空。改为空数组也走完整事务路径。

**建议补充测试（P1）：**

4. **fetchNoteViaHttp 多 URL 降级 + 短链** — 当前测试只有 mock HTTP server 的 Live 图文和 public-first 测试，缺少短链解析和无 xsec_token 降级的回归测试。

5. **浏览器认证端到端** — 当前 `tests/cookie-auth-state-test.mjs` 只测了 HTTP 层的 Cookie 校验，未覆盖 `saveXhsCookieFromBrowser` 的浏览器创建、CDP 降级、interactive 模式切换。
