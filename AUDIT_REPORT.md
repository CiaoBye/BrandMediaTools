# 品牌内容情报与分析工具 — 全量代码审计报告

> 本文是 2026-06-23、v1.09 的审计快照。文中待修项及旧架构描述不代表当前状态；修复结果请以 `FIX_REPORT_v1.10.md` 和 `CHANGELOG.md` 的 v1.10 记录为准。

> **审计日期**：2026-06-23  
> **项目版本**：v1.09  
> **审计范围**：全量源码（25 个后端模块 + 3 个前端文件 + 配置/测试）  
> **审计方法**：逐行阅读 + 架构分析 + 安全/性能/可靠性审查

---

## 一、项目概览

| 项目 | 详情 |
|---|---|
| 名称 | brand-content-intelligence-xhs |
| 版本 | v1.09 (2026-06-23) |
| 运行时 | Node.js >= 24，ESM 模式 |
| 依赖 | `playwright` ^1.54.0 + `sharp` ^0.33.0（零 Express 依赖，纯 `http` 模块） |
| 数据库 | SQLite WAL（`node:sqlite` DatabaseSync 同步 API） |
| 前端 | 纯原生 SPA + Chart.js CDN，无框架依赖 |
| 总代码量 | ~7,200 行后端 + ~2,100 行前端 JS + ~2,000 行 CSS + ~420 行 HTML |

---

## 二、架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│  public/index.html + app.js + styles.css (SPA)                 │  ← 前端 UI（8 个面板）
├─────────────────────────────────────────────────────────────────┤
│  src/server.mjs (http.createServer, 715 行)                    │  ← HTTP 路由层（~50 个端点）
├─────────────────────────────────────────────────────────────────┤
│  src/server-utils.mjs (readBody/sendJson/crawlAndStore/diagnose)│  ← 工具函数 + 内存缓存
├─────────────────────────────────────────────────────────────────┤
│  业务层:                                                        │
│    crawler/flow.mjs     — 采集流程编排（HTTP→PW→OpenCLI 三层）  │
│    crawler/account.mjs  — 账号跟踪（HTTP+PW+OpenCLI 三层）      │
│    crawler/extract.mjs  — 笔记数据提取（DOM+INIT_STATE 双路径）  │
│    crawler/search.mjs   — 搜索采集（Playwright DOM 提取）       │
│    crawler/comment.mjs  — 评论采集（DOM+INIT_STATE 双路径）     │
│    crawler/auth.mjs     — 浏览器 Cookie 保存 + whoami          │
│    xhsViralAnalysis.mjs — 免 LLM 病毒性分析（8 类钩子）        │
│    contentAnalysis.mjs  — 内容统计聚合（6 种统计函数）          │
│    reportGenerator.mjs  — 周报/月报生成（含环比）               │
│    aiAnalyzer.mjs       — AI 拆解（11 家厂商预设）              │
├─────────────────────────────────────────────────────────────────┤
│  SDK 层:                                                        │
│    xhsSdk.mjs    — URL 解析/资产评分/Playwright/INIT_STATE 解析 │
│    xhsAuth.mjs   — Cookie AES-256-GCM 加密 + 验证              │
│    xhsHealth.mjs — 笔记健康检测（level/敏感词/标签）            │
│    xhsLogin.mjs  — 多账号 QR 扫码登录                           │
├─────────────────────────────────────────────────────────────────┤
│  存储层:                                                        │
│    storage.mjs          — 门面类（委托给 5 个子 store）         │
│    storage/db.mjs       — SQLite 连接 + 迁移（11 张表）         │
│    storage/note-store.mjs   — 笔记 CRUD + 资产 + 分析 + 导出   │
│    storage/account-store.mjs — 竞品账号 + 跟随账号 CRUD         │
│    storage/xhs-store.mjs    — XHS 账号 + 定时任务 + 通知        │
│    storage/stats-store.mjs  — 统计聚合                          │
├─────────────────────────────────────────────────────────────────┤
│  基础设施:                                                      │
│    downloader.mjs — 文件下载（Range 续传/retry/格式转换）       │
│    scheduler.mjs  — 60s 轮询定时任务（爬/搜/跟随）             │
│    settings.mjs   — 配置管理（文件+环境变量+11 家 AI 预设）     │
│    logger.mjs     — 日志（文件轮转 5MB/搜索/分页）              │
│    time.mjs       — 北京时间工具                                │
│    webhook.mjs    — 飞书/钉钉/企微 Webhook 通知                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、核心功能分析

### 3.1 数据采集（核心能力）

#### 双层采集策略 (`crawler/flow.mjs:6-47`)

```
输入 URL
  ↓
isAccountUrl()? ──是──→ extractAccountNotes()
  │
  否
  ↓
fetchNoteViaHttp() [HTTP ~300ms, 需 xsec_token]
  │
  失败/无可用素材
  ↓
openXhsContext() → Playwright SSR [~5000ms]
  ├─ extractNote() DOM 解析 + INIT_STATE
  └─ 附带网络响应拦截
  │
  失败
  ↓
crawlNoteViaOpenCLI() [外部工具降级]
```

- **HTTP 快速路径**：直接 `fetch` HTML → `parseInitState()` 解析 `__INITIAL_STATE__` → 提取图片/视频流，约 300ms
- **Playwright 降级**：启动浏览器 → `addInitScript` 去除 webdriver 指纹 → DOM 提取 + 网络响应收集，约 5000ms
- **OpenCLI 最终降级**：调用外部 `opencli xiaohongshu note` 命令

#### 账号跟踪 (`crawler/account.mjs:203-408`)

```
followAccount({ userId, knownNoteIds, brand })
  ↓
fetchAccountNotesViaHttp() [HTTP 直连 profile 页]
  │
  成功 → noteUrls[]
  │
  逐条 fetchNoteViaHttp()
  │
  失败/无链接
  ↓
openXhsContext() → Playwright 导航到 profile
  ├─ 检测 /login 重定向 → 区分"访客会话"vs"无效/过期"
  ├─ extractAccountLinks() [DOM 提取笔记链接, 12 次滚动]
  ├─ __INITIAL_STATE__ 备用提取
  ├─ HTTP 直连 profile 页备用提取
  └─ 逐条: fetchNoteViaHttp() → 失败走 PW 子页 → 失败走 OpenCLI
```

关键设计：
- **增量去重**：`knownNoteIds`（JSON 数组持久化到 `followed_accounts.last_cursor`），遇到已知笔记提前停止
- **空滚动检测**：连续 5 次空滚动（~10s）提前退出
- **风控自动降级**：HTTP 遇到风控 → 自动切换有头浏览器模式

#### 搜索 (`crawler/search.mjs`)

Playwright 打开搜索页 → `document.querySelectorAll("a[href*='/explore/']")` 提取卡片 → 滚动 2 次加载更多 → `mergeXhsLinks` 去重

#### 评论 (`crawler/comment.mjs`)

Playwright 打开笔记页 → 6 次滚动加载 → DOM 选择器提取 + `__INITIAL_STATE__.note.commentMap` 双路径

### 3.2 认证与安全

#### Cookie 管理 (`xhsAuth.mjs`)

| 功能 | 实现 |
|---|---|
| 加密 | AES-256-GCM，IV 随机 16 字节，密钥 = SHA256(USERNAME + APP_SECRET)[0:32] |
| 加密格式 | `{iv_hex}:{authTag_hex}:{ciphertext_hex}` |
| 解密失败 | 返回原始密文（容错） |
| 多源解析 | `resolveCookie()`: 文件 → DB 已绑定账号 → 环境变量 → 设置 |
| 有效性验证 | HTTP 请求 explore 页 → 检查 302 重定向到 /login → 解析 INIT_STATE 提取昵称 |
| Playwright 转换 | `cookieStringToPlaywrightCookies()`: 分号分割 → `{name, value, domain, path}` |

#### QR 扫码登录 (`xhsLogin.mjs`)

```
startQrLogin(accountName)
  → createBrowser(headless: false)  // 无痕浏览器
  → 导航到 /login
  → 三级 QR 提取: canvas.toDataURL → img class → 全页截图
  → Map 存储 session

checkQrLoginStatus(accountName)
  → URL 离开 /login → 等待 Cookie 就绪 → 判定 logged_in
  → 仍在 /login → 检查 __INITIAL_STATE__ 的 loggedIn/guest 字段
  → 5 分钟超时

collectQrCookies(accountName)
  → 提取 Cookie 字符串
  → 昵称提取: __INITIAL_STATE__ Vue 展开 → DOM 选择器 → <title> 三级降级
  → 写入 DB + 文件
```

### 3.3 内容分析

#### 病毒性分析 (`xhsViralAnalysis.mjs`)

免 LLM，纯规则引擎：

| 维度 | 检测方法 |
|---|---|
| 标题钩子 | 8 类模式：数字、反问、感叹、列表、身份认同、情绪词、反差、系列 |
| 互动率 | likes/comments/collects/shares + 比率计算 |
| 评论主题 | 双字词频统计（bigram），停用词过滤，≥3 次聚类 |
| 综合评分 | hookScore(20) + engScore(20) + contScore(20) + cmtScore(20) = 80 分制 |

#### 内容统计 (`contentAnalysis.mjs`)

| 函数 | 输出 |
|---|---|
| `getTitleStats()` | 标题长度均值、钩子率、钩子分布、句式分布 |
| `getBodyStats()` | 正文长度均值、CTA 检测、hashtag 统计、主题词频 |
| `getEngagementStats()` | 平均点赞/评论/收藏/分享、最大值 |
| `getVisualStyleStats()` | 视觉风格分布（优先读 AI 拆解结果） |
| `getMarketingGoalStats()` | 营销目的分布 |
| `getContentTypeStats()` | 内容类型分布 |
| `getAuthorStats()` | 作者发布量 Top 20 |
| `getLibraryStats()` | 分类统计（选题库/脚本模板/视觉参考/营销话术） |

#### AI 拆解 (`aiAnalyzer.mjs`)

- 11 家 AI 厂商预设（OpenAI / DeepSeek / GLM / Moonshot / Qwen / MiniMax / Stepfun / Hunyuan / Baichuan / Yi / OpenCode）
- Prompt 拆解 9 个维度：topicLogic / openingHook / videoStructure / sellingPointExpression / visualStyle / conversionScript / takeaways / howWeCanUse / scriptDirections
- 无 API Key 时自动降级为本地规则分析

### 3.4 存储设计

#### 数据库表（11 张）

| 表名 | 用途 | 关键字段 | 约束 |
|---|---|---|---|
| `notes` | 笔记 | source_url, brand, author_id, library_type, content_type | source_url UNIQUE |
| `assets` | 素材 | note_id, kind, local_path, live_photo, file_id | note_id FK→notes CASCADE |
| `analysis` | AI 拆解 | note_id, topic_logic, opening_hook, visual_style | note_id FK→notes CASCADE, UNIQUE |
| `comments` | 评论 | note_id, parent_id, author_name, content, likes | note_id FK→notes CASCADE |
| `crawl_jobs` | 采集任务 | input_url, status, result_count | — |
| `accounts` | 竞品账号 | brand, account_url, tone, industry, priority | — |
| `followed_accounts` | 跟踪账号 | user_id, author_name, last_cursor, total_found, avatar_url | user_id UNIQUE |
| `follow_checks` | 跟踪记录 | account_id, check_at, new_notes, total_notes | account_id FK→followed_accounts CASCADE |
| `xhs_accounts` | 登录账号 | name, cookie_encrypted, status | name UNIQUE |
| `scheduled_tasks` | 定时任务 | task_type, config, interval_minutes, account_id | — |
| `notifications` | 通知 | type, title, message, level, read | — |

#### 存储层设计模式

```
Storage (门面)
  ├─ notes: createNoteStore(db, rootDir)    → 20+ 方法
  ├─ accounts_: createAccountStore(db)      → 12+ 方法
  ├─ xhs_: createXhsStore(db)              → 20+ 方法
  └─ stats_: createStatsStore(db, getNote)  → 4 方法
```

所有方法通过 `bind(this)` 委托到 Storage 实例，对外暴露统一接口。

### 3.5 下载引擎 (`downloader.mjs`)

| 功能 | 实现 |
|---|---|
| 文件夹模板 | `{date}-{type}-{titleShort}` 默认格式，支持 15+ 模板变量 |
| 文件命名 | `{index}-{kind}` 默认格式，chip 可视化编辑 |
| Range 续传 | 检测 `.part` 文件大小 → `Range: bytes={size}-` 头 → 追加写入 |
| 重试机制 | `maxRetry` 次重试，间隔 300ms × (attempt+1) |
| 图片格式转换 | sharp 库，支持 jpg/png/webp/heic/avif |
| 视频择优 | 水印惩罚分 -100000 + 分辨率/码率/文件大小排序 |
| 元数据 | 每个文件夹生成 `metadata.json`（笔记信息 + 素材状态） |

### 3.6 定时调度 (`scheduler.mjs`)

- 60 秒轮询 `getDueTasks()`
- 支持 3 种任务类型：`crawl` / `search` / `follow`
- `follow` 任务自动提取 `userId`、对比去重、落盘新笔记、记录检查统计
- 账号健康检查：每 2 小时检查所有绑定账号的 Cookie 有效性
- 防重入：`running` 标志位，上一轮未完成跳过本轮

### 3.7 前端 UI

#### 8 个面板

| 面板 | 功能 |
|---|---|
| 采集 | 链接粘贴 + 品牌/标签/搜索 + 最近记录 + 品牌建议自动补全 |
| 账号追踪 | 竞品账号 CRUD + 跟随状态 + 抓取按钮 + 迷你柱状图 + 编辑弹窗 |
| 案例库 | 瀑布流卡片（4 列响应式）+ 无限滚动（IntersectionObserver）+ 批量操作 + 表格视图 + 5 分类 Tab |
| 仪表盘 | 6 统计卡 + 6 Chart.js 图表（趋势/类型/品牌/素材/状态/互动）+ 标签云 + Top20 + 品牌对比 |
| 内容分析 | 标题钩子/句式/类型/营销目的/视觉风格/分类 6 图 + 高频主题词云 |
| 报告 | 周报/月报生成 + JSON/Markdown 导出 + 环比分析 |
| 账号管理 | QR 扫码 + Cookie 粘贴 + 全通道诊断 + 定时任务 CRUD + 健康检测 |
| 日志 | 搜索 + 分页 + 清空 |

#### 前端技术细节

- **SPA 路由**：侧边栏 `data-page` 属性切换 `page.active`，无 hash 路由
- **无限滚动**：`IntersectionObserver` + `renderLimit/step=30`，`rootMargin: 200px`
- **笔记详情弹窗**：模态框 + 图片/视频轮播 + 键盘导航 + 评论懒加载
- **设置面板**：竖排 4 Tab（AI/采集/下载/作者别名/通知），chip 可视化编辑命名模板
- **北京时间**：`Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai" })`

---

## 四、审计发现

### 4.1 安全问题

| 严重度 | 问题 | 位置 | 描述 |
|---|---|---|---|
| **高** | APP_SECRET 硬编码 | `xhsAuth.mjs:7` | `const APP_SECRET = "brand-content-intel-xhs-2025"` 硬编码在源码中，任何有代码访问权的人都可解密所有 Cookie。应从环境变量读取 |
| **中** | 文件路径遍历风险 | `server.mjs:683-699` | `/files/` 路径校验依赖 `path.normalize`，但 `decodeURIComponent` 后的路径可能构造绕过。建议增加 `realpath` 对比 |
| **中** | 素材文件无鉴权 | `server.mjs:670-678` | `/api/assets/:id/file` 无任何鉴权，知道 asset UUID 即可下载任意素材文件 |
| **低** | SQL 注入防护 | `note-store.mjs` 全文 | 所有 SQL 使用 `db.prepare` 参数化查询，无注入风险 ✅ |

### 4.2 性能问题

| 严重度 | 问题 | 位置 | 描述 |
|---|---|---|---|
| **高** | listNotes 全量查询 + 内存过滤 | `note-store.mjs:76-88` | `SELECT * FROM notes ORDER BY collected_at DESC` 全量取出后 JS 过滤，数据量 >1000 条时显著变慢。应改为动态 SQL WHERE |
| **中** | N+1 查询问题 | `note-store.mjs:10-22` | `hydrateNote()` 每条笔记都独立查询 `assets` + `analysis`，批量操作时 O(3N) 查询。应改为批量 IN 查询 |
| **中** | 缓存失效不完整 | `server-utils.mjs:138-154` | 内存缓存 5 分钟 TTL，仅 `crawl` 和 `follow/crawl` 调用 `clearCache()`。编辑笔记/删除笔记/修改设置后缓存未失效 |
| **低** | getTopNotes 未用 SQL 排序 | `stats-store.mjs:54-65` | 全量查询后内存排序 + 评分计算，应改为 SQL `ORDER BY` + `LIMIT` |

### 4.3 可靠性问题

| 严重度 | 问题 | 位置 | 描述 |
|---|---|---|---|
| **高** | fetchNoteViaHttp 强制要求 xsec_token | `crawler/extract.mjs:183` | `if (!url || !url.includes("xsec_token=")) return null`，但账号主页提取的链接通常无 token，导致 HTTP 快速路径对账号跟踪场景永远走不到 |
| **中** | search 无 Cookie 注入 | `crawler/search.mjs:8` | `createBrowser()` 不传 cookie，搜索页可能被重定向到登录页，导致搜索结果为空 |
| **中** | comment DOM 选择器脆弱 | `crawler/comment.mjs:23-34` | 依赖 `[class*='comment']` 等模糊选择器，小红书前端改版后静默失败（返回 0 评论） |
| **低** | Web Streams API 兼容性 | `downloader.mjs:116-132` | `pipeWebStreamToFile` 使用 `ReadableStream.getReader()`，部分 Node 版本可能不支持 |

### 4.4 代码质量问题

| 问题 | 位置 | 描述 |
|---|---|---|
| server.mjs 过于庞大 | `server.mjs` (715 行) | 路由定义、业务逻辑、文件服务、调度启动混在一起，应拆分为独立路由模块 |
| app.js 无模块化 | `app.js` (2057 行) | 所有面板渲染、事件绑定、状态管理、API 调用混在单文件中 |
| AI 预设模型名存疑 | `settings.mjs:5` | 包含 `gpt-5.4`、`deepseek-v4-pro`、`glm-5` 等未来模型名称，可能是笔误或占位符 |
| 时间偏移不一致 | `reportGenerator.mjs:14-15` | 使用 `Date.now() + 8*3600000` 手动偏移，而前端使用 `Intl.DateTimeFormat`，两套机制 |
| xhsHealth level 字段无意义 | `xhsHealth.mjs:28` | `diagnoseNote` 读取 `level_`/`level`/`distribution_level` 但 DB 中无此字段，实际始终为 NaN → 默认 level=1 |

---

## 五、优化建议

### 5.1 性能优化（优先级高）

#### 5.1.1 listNotes SQL 改造

当前：
```js
const rows = _("SELECT * FROM notes ORDER BY collected_at DESC").all();
return rows.map((r) => hydrateNote(r)).filter((note) => { ... });
```

建议：
```js
function listNotes(filters = {}) {
  let sql = "SELECT * FROM notes";
  const conditions = [];
  const params = [];
  if (filters.brand) { conditions.push("brand = ?"); params.push(filters.brand); }
  if (filters.contentType) { conditions.push("content_type = ?"); params.push(filters.contentType); }
  if (filters.libraryType) { conditions.push("library_type = ?"); params.push(filters.libraryType); }
  if (filters.authorId) { conditions.push("author_id = ?"); params.push(filters.authorId); }
  if (filters.q) {
    conditions.push("(title LIKE ? OR description LIKE ? OR brand LIKE ? OR author_name LIKE ?)");
    const q = `%${filters.q}%`;
    params.push(q, q, q, q);
  }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY collected_at DESC";
  return _(sql).all(...params).map(hydrateNote);
}
```

#### 5.1.2 hydrateNote 批量化

当前逐条查询 assets + analysis，建议增加：
```js
function hydrateNotes(rows) {
  const noteIds = rows.map(r => r.id);
  // 一次查询所有 assets
  const allAssets = _("SELECT * FROM assets WHERE note_id IN (" + noteIds.map(() => "?").join(",") + ")").all(...noteIds);
  const assetsByNote = new Map();
  for (const a of allAssets) {
    if (!assetsByNote.has(a.note_id)) assetsByNote.set(a.note_id, []);
    assetsByNote.get(a.note_id).push(a);
  }
  // 一次查询所有 analysis
  const allAnalysis = _("SELECT * FROM analysis WHERE note_id IN (" + noteIds.map(() => "?").join(",") + ")").all(...noteIds);
  const analysisByNote = new Map();
  for (const a of allAnalysis) analysisByNote.set(a.note_id, a);
  // 组装
  return rows.map(r => hydrateNote(r, assetsByNote.get(r.id), analysisByNote.get(r.id)));
}
```

#### 5.1.3 getTopNotes SQL 优化

```js
// 当前：全量查询 + 内存排序
const rows = _(`SELECT * FROM notes ${wd} ORDER BY collected_at DESC`).all();

// 建议：SQL 直接排序（如果 metrics 字段经常查询，考虑提取为独立列）
const rows = _(`SELECT * FROM notes ${wd} ORDER BY 
  CAST(json_extract(metrics, '$.likedCount') AS INTEGER) DESC`).all(...params).slice(0, limit);
```

### 5.2 安全加固

| 建议 | 实现方式 |
|---|---|
| APP_SECRET 从环境变量读取 | `process.env.COOKIE_ENCRYPT_SECRET \|\| "brand-content-intel-xhs-2025"` |
| 文件路径校验增强 | `const real = path.realpath(filePath); if (!real.startsWith(allowedRoot)) return 403;` |
| 素材访问签名 | 下载链接附带 `?token={hmac(noteId+assetId+timestamp)}`，5 分钟有效 |
| API 限流 | 对 `/api/crawl`、`/api/follow/crawl` 等重操作增加 IP 级别限流 |

### 5.3 架构改进

#### 5.3.1 server.mjs 拆分

```
src/
  routes/
    crawl.mjs      — POST /api/crawl, POST /api/search, POST /xhs/detail, POST /xhs/links
    accounts.mjs   — GET/POST/PUT/DELETE /api/accounts, /api/follow/*
    stats.mjs      — GET /api/stats, /api/stats/*, /api/reports/*
    xhs-auth.mjs   — POST /api/auth/qr/*, GET/POST/DELETE /api/xhs-accounts/*
    settings.mjs   — GET/PUT /api/settings, POST /api/settings/*
    notes.mjs      — GET/DELETE /api/notes, POST /api/notes/*/analyze, /api/notes/*/comments
    system.mjs     — GET /api/health, /api/logs, /api/notifications, /api/diagnose
```

#### 5.3.2 app.js 拆分

```
public/
  app.js            — 入口 + 状态管理 + 路由
  panels/
    crawl.js        — 采集面板
    accounts.js     — 账号追踪面板
    library.js      — 案例库面板
    dashboard.js    — 仪表盘面板
    content.js      — 内容分析面板
    reports.js      — 报告面板
    xhs-accounts.js — 账号管理面板
    logs.js         — 日志面板
  components/
    note-detail.js  — 笔记详情弹窗
    settings.js     — 设置面板
    notifications.js — 通知面板
```

### 5.4 功能补全

| 建议 | 描述 |
|---|---|
| 搜索注入 Cookie | `searchXhs` 应调用 `openXhsContext(rootDir, cookie)` 而非 `createBrowser(rootDir)` |
| 评论选择器加固 | 增加多套 CSS 选择器 + `__INITIAL_STATE__` 优先策略 |
| xhsHealth level 字段 | 从 `metrics` 中推断分发等级，或标记为"待采集"状态 |
| 导出 Eagle 格式 | `eagleExporter.mjs` 已有框架但未集成到路由，可作为独立功能 |
| Webhook 通知 | 已实现但仅在 `crawl` 和 `follow/crawl` 触发，搜索/定时任务也应触发 |

---

## 六、数据流总结

### 6.1 采集数据流

```
用户输入 URL/分享文本
  ↓
extractXhsUrls() ──→ 标准化 + 去重 + xsec_token 评分
  ↓
crawlXhs()
  ├─ [HTTP 快速路径] fetchNoteViaHttp()     ~300ms   (需 xsec_token)
  ├─ [Playwright SSR] extractNote()          ~5000ms  (DOM + INIT_STATE)
  └─ [OpenCLI 降级]   crawlNoteViaOpenCLI()  ~25000ms (外部工具)
  ↓
storage.upsertNote()
  ├─ INSERT/UPDATE notes (source_url UNIQUE 去重)
  └─ INSERT assets (kind: image/video/livePhoto)
  ↓
downloader.persistNoteAssets()
  ├─ 文件命名: {date}-{type}-{titleShort}/{index}-{kind}.{ext}
  ├─ 下载: Range 续传 + retry + 超时
  ├─ 图片格式转换 (sharp)
  └─ metadata.json 元数据
  ↓
前端渲染
  ├─ 案例库: 瀑布流卡片 + 无限滚动
  ├─ 仪表盘: Chart.js 图表
  ├─ 内容分析: 标题钩子/句式/主题词频
  └─ 报告: 周报/月报 + JSON/Markdown 导出
```

### 6.2 账号跟踪数据流

```
用户添加竞品账号 (brand + account_url)
  ↓
POST /api/accounts → INSERT accounts
  ↓
POST /api/accounts/:id/follow
  ├─ extractXhsId(url) → userId
  ├─ upsertFollowedAccount({ userId, authorUrl, brand })
  └─ createScheduledTask({ taskType: "follow", interval: 1440min })
  ↓
定时调度 (60s 轮询)
  ├─ followAccount({ userId, knownNoteIds, brand })
  │   ├─ fetchAccountNotesViaHttp() → noteUrls[]
  │   ├─ 逐条 fetchNoteViaHttp() / Playwright 子页
  │   └─ 返回 { notes, cursor, authorName, avatarUrl }
  ├─ 去重: knownNoteIds vs 新发现
  ├─ 存储: upsertNote + persistNoteAssets
  └─ 统计: createFollowCheck({ newNotes, totalNotes })
  ↓
前端展示
  ├─ 账号卡片: 头像 + 笔记数 + 检查时间 + 迷你柱状图
  └─ 点击抓取: POST /api/follow/crawl → 实时采集
```

### 6.3 认证数据流

```
扫码登录流程:
  startQrLogin() → Playwright 无痕浏览器 → /login → 提取 QR
  ↓ 轮询
  checkQrLoginStatus() → URL 变化 + Cookie 就绪 + INIT_STATE 判定
  ↓
  collectQrCookies() → 提取 Cookie + 昵称
  ↓
  encryptCookie() → AES-256-GCM → DB (xhs_accounts)
  + writeFileSync → data/xhs-cookie.txt

Cookie 使用流程:
  resolveCookie(rootDir, storage)
    → 读文件 → 查 DB 有效账号 → 读环境变量 → 读设置
    ↓
  openXhsContext(rootDir, cookie)
    → createBrowser() → context.addCookies()
    ↓
  采集/搜索/跟踪
```

---

## 七、文件清单与行数统计

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/server.mjs` | 715 | HTTP 路由 + 服务器 |
| `src/xhsSdk.mjs` | 466 | SDK 核心（URL/资产/Playwright） |
| `src/crawler/account.mjs` | 410 | 账号跟踪 |
| `src/crawler/extract.mjs` | 302 | 笔记数据提取 |
| `src/downloader.mjs` | 348 | 文件下载引擎 |
| `src/server-utils.mjs` | 264 | 工具函数 + 缓存 + 诊断 |
| `src/storage/note-store.mjs` | 266 | 笔记存储 |
| `src/xhsAuth.mjs` | 144 | Cookie 加密/验证 |
| `src/contentAnalysis.mjs` | 171 | 内容统计聚合 |
| `src/xhsLogin.mjs` | 171 | QR 扫码登录 |
| `src/reportGenerator.mjs` | 117 | 报告生成 |
| `src/xhsViralAnalysis.mjs` | 116 | 病毒性分析 |
| `src/settings.mjs` | 154 | 配置管理 |
| `src/storage.mjs` | 88 | 存储门面 |
| `src/storage/stats-store.mjs` | 77 | 统计存储 |
| `src/storage/account-store.mjs` | 74 | 账号存储 |
| `src/storage/xhs-store.mjs` | 74 | XHS 存储 |
| `src/crawler/search.mjs` | 69 | 搜索采集 |
| `src/storage/db.mjs` | 62 | 数据库连接 |
| `src/crawler/comment.mjs` | 61 | 评论采集 |
| `src/crawler/flow.mjs` | 51 | 采集流程编排 |
| `src/xhsHealth.mjs` | 46 | 健康检测 |
| `src/aiAnalyzer.mjs` | 90 | AI 拆解 |
| `src/logger.mjs` | 81 | 日志 |
| `src/time.mjs` | 28 | 北京时间工具 |
| `src/crawler/auth.mjs` | 27 | 浏览器 Cookie |
| `src/xhsCrawler.mjs` | 15 | 重导出中心 |
| `public/app.js` | 2057 | 前端逻辑 |
| `public/styles.css` | 2175 | 响应式样式 |
| `public/index.html` | 426 | SPA 结构 |
| **合计** | **~9,400** | — |

---

## 八、测试覆盖

| 测试文件 | 覆盖范围 |
|---|---|
| `tests/minimal-xhs-test.mjs` | XHS SDK 核心函数 |
| `tests/mcp-smoke-test.mjs` | MCP 服务器冒烟测试 |
| `tests/eagle-export-metadata-test.mjs` | Eagle 导出元数据 |
| `tests/download-name-template-test.mjs` | 下载命名模板 |
| `tests/clipboard-test.mjs` | 剪贴板链接提取 |
| `tests/links-merge-test.mjs` | 链接合并去重 |
| `tests/storage-filter-test.mjs` | 存储过滤 |

`npm run check` 覆盖 18 个源文件的语法检查。

---

## 九、总结

### 优势

1. **零外部框架依赖**：纯 Node.js `http` 模块 + SQLite，部署简单
2. **采集策略健壮**：HTTP → Playwright → OpenCLI 三层降级，覆盖各种网络环境
3. **增量跟踪设计**：`knownNoteIds` 去重 + 空滚动检测 + 风控自动降级
4. **认证体系完善**：AES-256-GCM 加密 + 多源 Cookie 解析 + QR 扫码 + 健康检查
5. **内容分析免 LLM**：8 类钩子模式 + 互动率 + 评论聚类，无需 API Key 即可用
6. **前端体验好**：无限滚动 + 响应式瀑布流 + 品牌对比 + 6 Chart.js 图表

### 待改进

1. **性能瓶颈**：`listNotes` 全量查询 + N+1 问题，数据量增长后会显著变慢
2. **安全缺口**：APP_SECRET 硬编码 + 素材文件无鉴权 + 文件路径遍历风险
3. **代码组织**：`server.mjs`（715 行）和 `app.js`（2057 行）过于庞大，应拆分模块
4. **可靠性**：`fetchNoteViaHttp` 强制要求 `xsec_token` 导致账号跟踪场景 HTTP 路径失效
5. **搜索无 Cookie**：搜索功能未注入 Cookie，可能被重定向到登录页

### 优先级排序

| 优先级 | 建议 | 预期收益 |
|---|---|---|
| P0 | listNotes SQL WHERE 改造 | 数据量 >500 时性能提升 5-10x |
| P0 | fetchNoteViaHttp 移除 xsec_token 强制检查 | 账号跟踪采集速度提升 16x |
| P1 | APP_SECRET 环境变量化 | 消除最大安全风险 |
| P1 | searchXhs 注入 Cookie | 搜索功能可用性提升 |
| P1 | hydrateNote 批量化 | 批量操作查询数降低 66% |
| P2 | server.mjs 路由拆分 | 可维护性提升 |
| P2 | app.js 模块化 | 可维护性提升 |
| P2 | 缓存失效完善 | 数据一致性提升 |
