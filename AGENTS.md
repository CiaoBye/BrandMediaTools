# 项目级工作规则

## 项目定位
本项目是"品牌内容情报与素材抓取工具"，第一阶段聚焦小红书公开/授权内容的采集、素材保存、内容分析和资产沉淀，服务 AI 视频创作、竞品研究、品牌内容运营和营销复盘。

## 合规边界
- 只采集公开可访问或用户已授权/已登录后可正常查看的内容。
- 不实现登录绕过、风控绕过、破解下载、DRM 绕过或二次去水印处理。
- "无水印图片"和"最高分辨率视频"指优先保存页面/接口中合法可访问的原始资源；无法确认时必须标记为"需人工复核"。
- 所有采集内容必须保留来源链接、作者信息、采集时间和素材状态，便于溯源。

## 当前架构概况

### 代码分层
- `src/xhsSdk.mjs`：低层 SDK，导出 29+ 个函数（含 `parseInitState` — SSR HTML `__INITIAL_STATE__` 解析，处理 `undefined`/`NaN` 值）。
- `src/xhsCrawler.mjs` 与 `src/crawler/`：业务编排层，双层策略：① 公开页 HTML 快速路径（`fetchNoteViaHttp`，默认不带 Cookie fetch HTML + `__INITIAL_STATE__` 解析，XHS-Downloader 式主路径）→ ② 公开页解析失败或素材不足时降级 Cookie/Playwright 页面解析。包含采集、搜索、评论、账号跟踪、Cookie 验证及链接提取。
- `src/xhsHealth.mjs`：健康检测工具函数（level 元信息、敏感词检测、标签检查），已不直接参与路由调用。
- `src/xhsViralAnalysis.mjs`：病毒性分析（免 LLM，8 类钩子模式 + 互动率 + 评论主题聚类）。
- `src/contentAnalysis.mjs`：内容统计聚合（标题钩子/句式分布、主题词频、互动统计、视觉/营销目的分布、分类统计）。
- `src/reportGenerator.mjs`：内容报告（每周简报 / 每月复盘，Top10/品牌/钩子/环比 + JSON/Markdown 导出）。
- 登录态入口已收敛到专用浏览器 profile 绑定、后台授权态刷新和手动完整 Cookie 兜底。
- `src/xhsAuth.mjs`：Cookie AES-256-GCM 加密/解密与登录态校验（解析 `__INITIAL_STATE__`，识别 guest/真实登录态）。
- `src/server.mjs`：Express Web 服务器，包含所有 API 路由 + 启动调度器。
- `src/storage.mjs` 与 `src/storage/`：SQLite 存储层，按笔记、账号、任务和统计子模块拆分。
- `src/downloader.mjs`：下载引擎（图片格式转换、视频流过滤、part 文件、重试、Range 续传）。
- `src/settings.mjs`：默认配置 + 12 家 AI 服务预设及自定义入口。
- `src/scheduler.mjs`：定时调度模块，每 60 秒轮询执行 dueTasks。

### 前端
- `public/index.html`：单页应用，含采集、搜索、内容库、仪表盘、内容分析、账号管理、定时任务等面板。
- `public/app.js`：前端逻辑（账号绑定入口、账号 CRUD、定时任务 CRUD、仪表盘 Chart.js 渲染、内容分析图表、评论展示、库分类管理等）。
- `public/styles.css`：响应式样式（仪表盘 grid、搜索卡片网格、账号列表、调度任务列表等）。

### 数据库表
- `notes`：作品笔记
- `assets`：素材（图片/视频/封面/livePhoto）
- `analysis`：AI 拆解结果
- `xhs_accounts`：小红书账号（含加密 Cookie）
- `scheduled_tasks`：定时任务
- `task_logs`：任务执行日志
- `followed_accounts`：跟随跟踪的账号（cursor 断点续查）
- `follow_checks`：每次跟随检查的统计记录
- `comments` / `crawl_jobs` / `monitor_sources` / `notifications` / `app_meta`：评论、任务、监测、通知和迁移元数据

## 第一阶段重点
- 小红书图文/视频笔记采集。
- 图片、视频、封面等素材入库。
- 竞品账号库、内容案例库和品牌资产库。
- AI 拆解：选题逻辑、开头钩子、内容结构、视觉风格、转化话术、可借鉴点、我们可以怎么用。
- Eagle 导出预留：按品牌、账号、笔记建立目录，并生成 sidecar JSON 元数据。
- OpenClaw / Hermes 监测平台预留：只定义接口和数据结构，第一版不实际接入。

## 已完成扩展功能
- AI 模型预设 12 家服务及自定义入口。
- 图片最优品质（宽高积降序 + 无水印优先 + 参数清洗）。
- 视频最优品质（水印惩罚分 `-100000` + 最高分辨率优先，同级按码率决胜）。
- 命名模板 chip 可视化编辑 + 拆分文件夹/文件两级模板 + collapseSeparators 自动修复。
- 设置页面竖排 5 标签页（AI/采集/下载/作者别名/通知）。
- 图片格式转换和品质配置。
- 视频分辨率过滤。
- 级联删除笔记（文件 + DB）。
- 登录主入口已简化为专用浏览器绑定 + 手动完整 Cookie 兜底，旧二维码登录链路已删除。
- Cookie AES-256-GCM 加密。
- 健康检测 creator 后端 level 字段分析（`xhsHealth.mjs`）。
- 病毒性分析免 LLM 8 类钩子（`xhsViralAnalysis.mjs`）。
- **HTTP + Playwright 双层采集**：公开分享页优先解析 SSR 状态，数据不足时直接导航目标页并从页面状态、DOM 和合法可访问的网络响应中补齐。
- **公开页无 Cookie 主链路**（v1.13.5）：单篇作品默认先不带 Cookie 请求公开页 HTML 并解析 `window.__INITIAL_STATE__`，Cookie 仅作为公开页失败或素材不足时的兜底。
- **`followAccount()` 增量跟踪**：从账号主页 DOM/SSR 提取作品链接，逐条走 HTTP 快速路径并在失败时降级 Playwright；游标保存历史作品 ID。
- 仪表盘 Chart.js 5 图表。
- 账号矩阵 CRUD。
- 定时自动采集（60 秒轮询）。
- **内容分析与统计**（`contentAnalysis.mjs`）：标题钩子/句式分布、主题词频、互动统计、视觉/营销目的分布。
- **内容分类管理**（`library_type` 字段）：选题库/脚本模板库/视觉参考库/营销话术库，前后端 CRUD + 批量操作。
- **内容报告**（`reportGenerator.mjs`）：每周简报 / 每月复盘自动生成，Top10/品牌/钩子/环比分析，JSON/Markdown 导出。
- **文件夹按日期-类型-标题命名**（`downloader.mjs`）：新增 `{type}`（中文：视频/图文/Live图文）、`{titleShort}`（自动截断20字）模板变量，默认 `folderNameFormat` 改为 `{date}-{type}-{titleShort}`。
- **账号跟踪**（`followAccount` 在 `xhsCrawler.mjs`）：基于 Playwright SSR 导航到用户主页 + 响应拦截 `user_posted` API，支持增量跟随（已知 note_id 去重提前停止）。新表 `followed_accounts` + `follow_checks` 记录每次检查的新/旧笔记数。独立前端页面展示卡片列表 + 迷你柱状图 + 时间线弹窗。
- **定时跟随任务**（`scheduler.mjs`）：新增 `task_type: "follow"` 处理逻辑，自动提取 `userId`、对比去重、落盘新笔记、记录检查统计。
- **简化认证体系**（v1.13.4+）：前端只保留专用浏览器绑定、手动完整 Cookie 兜底与 Cookie 检测；旧二维码登录链路已删除。所有 Cookie 入库前均需通过真实登录态校验。

## 参考工具说明
可以参考 JoeanAmier/XHS-Downloader 的功能设计，包括作品信息采集、下载地址提取、文件下载、下载记录、文件夹归档、Cookie 配置、API/MCP 模式和断点续传等思路，但不要复制其源码，也不要把它作为本项目的外部运行依赖或可选适配器。重点可借鉴单篇作品的公开页 HTML + `window.__INITIAL_STATE__` 解析、图片/视频/Live 图资源归一化、下载记录去重与 Range 续传；其用户主页签名请求模块只做风险评估，不纳入项目实现。当前项目 v1.13.5 已将单篇作品采集主路径调整为无 Cookie 公开页优先。

可以参考 sigcli/sigcli 的 Cookie 获取思路：只基于用户本机正常登录后的浏览器登录态读取 Cookie，不做账号登录绕过、验证码绕过或风控绕过。

## 最低功能要求
- 必须支持小红书 Web 分享文本中的有效链接自动提取。
- 必须支持视频笔记、图文笔记、Live 图文和账号主页的基础解析。
- Live 图文应优先使用小红书页面状态中的 `imageList.livePhoto` 与 `stream` 字段解析，并记录静态图与动态视频的配对关系。
- 必须支持图片/视频素材下载、重复记录跳过、独立文件夹保存和元数据落盘。
- 必须支持本机浏览器登录态 Cookie 保存入口，便于用户正常登录后复用授权访问状态。
- 必须提供 `/xhs/detail` 二次开发接口，参数形态与 XHS-Downloader 保持接近。
- 必须提供账号主页作品链接提取能力，接口为 `/xhs/links`，CLI 参数为 `--links`。
- 必须提供本地 MCP 模式，至少暴露作品采集和账号主页链接提取两个工具，便于后续 Agent/自动化调用。
- 必须保留命令行模式和配置文件能力，方便后续封装为桌面程序或自动化流程。
- 测试链接和反馈必须维护在 `TEST_REPORT.md`。

## 关键文件
- `src/xhsSdk.mjs`：低层 SDK（核心解析逻辑）
- `src/xhsCrawler.mjs`：业务编排（双层策略：HTTP 快速路径优先 → 失败降级 Playwright SSR；`followAccount()` 账号跟踪；`whoami()` Cookie 验证）
- `src/xhsHealth.mjs`：健康检测工具函数（level 元信息、敏感词检测、标签检查），已不直接参与路由调用。
- `src/xhsViralAnalysis.mjs`：病毒性分析（免 LLM 8 类钩子 + 互动率）
- `src/contentAnalysis.mjs`：内容统计聚合（标题钩子/句式分布、主题词频、互动统计、视觉/营销目的分布、分类统计）
- `src/reportGenerator.mjs`：内容报告（每周简报 / 每月复盘，Top10/品牌/钩子/环比 + JSON/Markdown 导出）
- `src/crawler/auth.mjs`：专用浏览器 profile 绑定、Cookie 提取和后台授权态刷新
- `src/xhsAuth.mjs`：AES-256-GCM Cookie 加密
- `src/server.mjs`：Express 服务器（含搜索/评论/QR/账号/调度/仪表盘路由、账号跟随/抓取路由）
- `src/storage.mjs`：SQLite 存储层（7 张表 CRUD + 聚合统计 + followed_accounts/follow_checks 跟踪）
- `src/downloader.mjs`：下载引擎（`contentTypeShort`/`shortTitle` 模板变量支持）
- `src/scheduler.mjs`：定时调度模块（新增 `follow` 任务类型）
- `src/settings.mjs`：默认配置（`folderNameFormat` 默认 `{date}-{type}-{titleShort}`）
- `src/time.mjs`：北京时间工具（`beijingNow`/`fmtDateTime`/`fmtDate`/`beijingDate`）
- `public/index.html` / `app.js` / `styles.css`：前端 SPA（`fmtBJ`/`dateBJ` 使用 `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai" })` 渲染）

## 关键文件（完整目录）
- `src/xhsSdk.mjs`：低层 SDK（核心解析逻辑，含 `parseInitState`、`attachResponseCollector`）
- `src/xhsCrawler.mjs`：业务编排（`followAccount` / `fetchNoteViaHttp` / `crawlXhs` / 双层策略）
- `src/xhsHealth.mjs`：健康检测工具函数，已不直接参与路由
- `src/xhsViralAnalysis.mjs`：病毒性分析（免 LLM 8 类钩子 + 互动率）
- `src/contentAnalysis.mjs`：内容统计聚合
- `src/reportGenerator.mjs`：内容报告
- `src/crawler/auth.mjs`：专用浏览器 profile 绑定、Cookie 提取和后台授权态刷新
- `src/xhsAuth.mjs`：AES-256-GCM Cookie 加密
- `src/server.mjs`：Express 服务器（含账户/跟随/检测名称/全局异常 API）
- `src/storage.mjs`：SQLite 存储层（9 张表 + followed_accounts/follow_checks 跟踪）
- `src/downloader.mjs`：下载引擎
- `src/scheduler.mjs`：定时调度模块（60s 轮询，支持 follow 任务）
- `src/settings.mjs`：默认配置（12 家 AI 服务预设 + 自定义）
- `src/time.mjs`：北京时间工具
- `public/index.html` / `app.js` / `styles.css`：前端 SPA
## 已知问题 / 待验证
- QR 扫码全链路需要本地 `npm start` 后验证（服务器需加载新代码）。
- 插件/多账号加密/解密全链路需验证。
- `openXhsContext` 已在 xhsCrawler.mjs 中添加 re-export。
- **v1 API 全部失效**（2026-06-22 验证）：feed/note/user_posted/search 均返回 404/406，Playwright SSR 为唯一可靠路径
- **HTTP 快速路径仅对含 `xsec_token` 的 URL 有效** — `fetchNoteViaHttp` 自动跳过无 token URL，走 Playwright 降级

## 近期修复
### 2026-06-30 v1.13.9 采集链路审计测试与去重修复
- 新增 `tests/crawl-chain-audit-test.mjs`，把账号采集增强、successNoteIds 去重、Cookie/CDP 上下文、noteId 存储去重、定时 follow 一致性、Range 回退和弃用代码残留纳入回归检查。
- 修复 `saveXhsCookieFromBrowser()` 登录等待 `deadline` 未定义导致专用浏览器绑定/刷新 Cookie 入口失败的问题；浏览器态识别不再把 `guest_user_id` 当作真实登录。
- 手动 Cookie 保存、浏览器 Cookie 保存和调度器健康检查会持久化校验时返回的更新后 Cookie，避免 DB 加密 Cookie 与 `data/xhs-cookie.txt` 保留旧值。
- `createBrowser()` 支持 `cdpPort: 0` 显式覆盖设置中的 CDP 端口，传入 Cookie 的采集链路应优先使用独立 Playwright 上下文注入 Cookie。
- `notes` 存储、手动账号抓取、定时 follow 和 skip 判断优先按 canonical noteId 去重，避免同一笔记不同 URL 形态重复入库。
- 定时 follow 会合并数据库已有 noteId，并在本次解析不到作者名、头像或品牌时保留旧账号资料。
- 搜索链路移除旧 `xhsApiClient` API-first 分支，并删除 `src/xhsApiClient.mjs` 与 `src/signserver/` 旧签名服务；旧签名/API 代码不得重新接入采集主线。
- Range 续传遇到服务端返回 200 时立即回退完整下载，不再消耗重试次数。

### 2026-06-29 v1.13.8 账号抓取 Cookie 上下文修复
- 修复 `/api/follow/crawl` 在服务启动后复用全局持久浏览器，导致已保存 Cookie 未注入、账号主页作品列表提取为 0 的问题。
- 当调用方传入已保存 Cookie 时，`openXhsContext()` 改为创建独立带 Cookie 的 Playwright 上下文；仅无 Cookie 且需要浏览器会话时才复用全局上下文或 CDP。
- 账号抓取链路新增开始、候选链接数量、完成和失败日志，运行日志可直接看到是否提取到图文候选。

### 2026-06-29 v1.13.5 公开页无 Cookie 主链路
- `fetchNoteViaHttp()` 改为默认先不带 Cookie 请求公开作品页 HTML，解析 `window.__INITIAL_STATE__` 获取作品元数据和下载资源。
- 本地即使存在 Cookie，单篇作品采集也优先不发送 Cookie；只有公开页解析失败或素材不足时才尝试 Cookie 兜底。
- `crawlWithFallback()` 日志改为“公开页 HTML”路径，明确主路径不是登录态 API。
- 新增回归测试覆盖“本地有 Cookie 但公开页可解析时必须使用 public acquisitionMode”的场景。

### 2026-06-29 v1.13.4 登录方式简化与 XHS-Downloader 研究
- 账号管理页主入口收敛为「打开专用浏览器绑定」「手动粘贴完整 Cookie」「检测 Cookie」，旧二维码登录链路已删除。
- 设置页移除 SigCLI 预留配置展示，保留专用浏览器会话、两小时自动复检/刷新和后台刷新等待时间。
- 研究 XHS-Downloader 最新实现：单篇作品详情使用 HTTP 获取 HTML、解析 `window.__INITIAL_STATE__`、抽取作品字段与图片/视频/Live 图资源；下载层具备记录去重、文件夹归档、Range 续传和重试。
- 其用户主页列表模块使用签名请求，属于更高账号/平台风险路径，本项目不接入、不复制。
- 将 HTTP 快速路径旧日志中的“绕过风控”表述修正为公开页降级重试。

### 2026-06-29 v1.13.3 三通道认证体系合并
- 新增 Network 完整 Cookie 教程入口，手动粘贴 Cookie 保存前会进行真实登录态校验，访客态或跳登录页 Cookie 不再入库。
- 浏览器提取 Cookie 成功后同步写入 `data/xhs-cookie.txt` 和 `xhs_accounts` 加密账号库，修复定时任务仍使用旧 DB Cookie 的问题。
- 调度器两小时健康巡检新增非交互式专用 CDP 会话刷新：若专用浏览器已有登录态，会自动刷新单账号 DB Cookie；未登录时不弹窗打扰。
- 服务重启时自动结束残留“运行中”任务日志，并把卡在运行态的定时任务恢复为等待态，避免强制重启后 UI 误判任务仍在执行。
- 设置页新增 `autoRefreshCookie`、`cookieRefreshWaitMs`、`authProvider`、`sigCliCommand` 配置；SigCLI 作为可选外部凭证代理预留，不作为强制依赖。
- 新增 `AUTH_STRATEGY_REPORT.md` 记录当前方式、Network Cookie、真实浏览器会话与 SigCLI 的对比。

### 2026-06-29 v1.13.2 Cookie 登录态与 CDP 提取修复
- 修复 Cookie 检测误判：不再只凭 `web_session` 和 `/explore` HTTP 200 判断有效，改为解析页面 `__INITIAL_STATE__` 的 `guest`/`loggedIn`/`userInfo` 状态，当前访客态 Cookie 会被正确判为无效。
- 修复「从 Chrome 提取 Cookie」实际链路：默认等待 120 秒，打开专用浏览器登录页等待用户正常登录，保存前再次校验真实登录态。
- 修复 CDP 启动安全问题：移除 `taskkill`，不再误杀用户已有 Chrome，只使用项目专属 `.browser-profile/chrome-cdp`。
- 新增 `tests/cookie-auth-state-test.mjs`，版本升级至 v1.13.2，`npm test` 全量通过。

### 2026-06-24 v1.10 全链路审计修复
- 修复下载原子落盘、WebP 转换、报告 500、互动统计、Playwright 目标页导航、调度失败重试和暂停状态。
- 修复二维码误判、Cookie 加密兼容、Live 图文类型及素材原始地址、通知配置读写。
- 加固文件访问、请求体、Range、安全响应头和级联删除边界。
- Chart.js 改为本地依赖，修复账号页结构、图表降级、移动端导航及内容安全策略兼容。
- 新增核心、调度、浏览器降级、服务集成和真实小红书样本测试；版本升级至 v1.10。

### 2026-06-23 v1.09 账号追踪计数/头像/品牌对比/内容分析/无限滚动
**问题**: 5 个独立 Bug + 2 项改进：
1. 账号追踪显示 0 篇 — `total_found` 仅记录末次抓取，非真实数据库计数
2. 账号库头像丢失 — `detect-name` 不返回 `avatarUrl`，创建跟随时不传头像
3. 品牌对比不显示 — `renderBrandCompare()` 函数未在 `renderDashboard()` 中调用
4. 内容分析正文统计为空 — `getBodyStats` 误用 `analyzeTitle` 而非 `analyzeBody`
5. 视觉风格分布始终为空 — `getVisualStyleStats` 未查 `analysis.visualStyle`（AI 拆解结果）
6. 案例库缺少无限滚动 — 所有笔记一次性渲染，数据多时白屏
7. 笔记详情弹窗仅支持图片轮播 — 视频不可见

**修改**:
- `note-store.mjs:listNotes` — 新增 `filters.authorId`，支持按作者 ID 过滤
- `server.mjs:/api/follow/accounts` — 返回实时 `noteCount`（`storage.listNotes({authorId}).length`）
- `server.mjs:/api/accounts/detect-name` — 同时从 `__INITIAL_STATE__`/`og:image`/DOM 提取 `avatarUrl` 返回
- `server.mjs:/api/accounts/:id/follow` — 接受 `body.avatarUrl` 参数，传入 `upsertFollowedAccount`
- `server.mjs` — 补充导入 `analyzeBody`，`getBodyStats` 改用 `analyzeBody` 分析正文
- `contentAnalysis.mjs:getVisualStyleStats` — 优先读取 `note.analysis?.visualStyle`
- `app.js:renderDashboard` — 末尾增加 `renderBrandCompare()` 调用
- `app.js:renderNotes` — 新增 `renderLimit`/IntersectionObserver 分片渲染（每次 30 条）
- `app.js:fillNotePanel` — 媒体轮播混合图片+视频，视频显示 `<video controls>`
- `app.js:fillNotePanel` — 右栏增加「💬 评论」懒加载按钮
- `app.js:renderAccounts` — 统计显示 `noteCount` 优先于 `total_found`
- `app.js:detect-name` 调用 — 在 URL blur/save/edit 流程中保存 `avatarUrl` 并传递到 API
- `styles.css` — 清理 `.ndp-left`/`.ndp-right` 重复定义；清理 `.lib-card-cb` 冲突定义

### 2026-06-22 v1.08 Bugfix: followAccount 登录页检测 + Vue reactive wrapper + detect-name Playwright 降级
**问题**: 三个独立 Bug 导致账号解析完全不可用：
1. Playwright 导航到 profile 页后被重定向到 `/login`（Cookie 无效/guest 会话），但代码无检测，静默返回 0 结果 + 空名称
2. `__INITIAL_STATE__` 中的 `userPageData` 和 `userInfo` 被 Vue 3 `_value`/`_rawValue`/`dep` 包装，提取路径 `user.userInfo.nickname` 始终返回空（`{userId:null}`）
3. `/api/accounts/detect-name` 对 profile URL 完全无效 — HTTP fetch 获取不到异步渲染的 JS 内容，始终返回空名称

**修改**:
- `xhsCrawler.mjs:followAccount` — 导航后检查 `page.url()` 是否包含 `/login`，判读 `__INITIAL_STATE__` 中的 `_value.guest` 决定提示"访客会话"还是"无效/过期"
- `xhsCrawler.mjs:followAccount` — 名称提取展开 `userPageData._value`/`_rawValue`，提取 `basicInfo.nickname`；增加最多 3 次 (×3s) 重试等待 JS 渲染
- `server.mjs:/api/accounts/detect-name` — profile URL 改用 Playwright 渲染（5 次 ×3s 轮询），失败降级 HTTP `<title>` 提取；非 profile URL 走 HTTP + `noteDetailMap` 提取笔记作者名；所有 HTTP 路径增加 Cookie header
- `public/app.js` — 抓取按钮显示 Cookie/登录相关错误片段，恢复时间延长至 4s

### 2026-06-22 v1.08 Bugfix: followAccount 登录页检测 + Vue reactive wrapper + detect-name Playwright 降级
**问题**: 三个独立 Bug 导致账号解析完全不可用：
1. Playwright 导航到 profile 页后被重定向到 `/login`（Cookie 无效/guest 会话），但代码无检测，静默返回 0 结果 + 空名称
2. `__INITIAL_STATE__` 中的 `userPageData` 和 `userInfo` 被 Vue 3 `_value`/`_rawValue`/`dep` 包装，提取路径 `user.userInfo.nickname` 始终返回空（`{userId:null}`）
3. `/api/accounts/detect-name` 对 profile URL 完全无效 — HTTP fetch 获取不到异步渲染的 JS 内容，始终返回空名称

**修改**:
- `xhsCrawler.mjs:followAccount` — 导航后检查 `page.url()` 是否包含 `/login`，判读 `__INITIAL_STATE__` 中的 `_value.guest` 决定提示"访客会话"还是"无效/过期"
- `xhsCrawler.mjs:followAccount` — 名称提取展开 `userPageData._value`/`_rawValue`，提取 `basicInfo.nickname`；增加最多 3 次 (×3s) 重试等待 JS 渲染
- `server.mjs:/api/accounts/detect-name` — profile URL 改用 Playwright 渲染（5 次 ×3s 轮询），失败降级 HTTP `<title>` 提取；非 profile URL 走 HTTP + `noteDetailMap` 提取笔记作者名；所有 HTTP 路径增加 Cookie header
- `public/app.js` — 抓取按钮显示 Cookie/登录相关错误片段，恢复时间延长至 4s

### 2026-06-22 v1.07 Bugfix: followAccount JSON.parse + 空滚动退出 + 侧边栏路由 + 自动识别作者名
**问题**: 三个独立 Bug 导致账号追踪系统完全不可用：
1. 账号抓取按钮点击后无响应，按钮文案卡在"抓取中…"
2. 侧边栏点击"账号追踪"后停留在前一个面板
3. 即使抓取成功，作者名永远为空

**根因**:
1. `followAccount` 第 532 行 `JSON.parse(body)` — `attachResponseCollector` 推入 `{url,contentType,text}` 对象，JS 强制转为 `"[object Object]"` → JSON parse 失败 → `catch { continue }` 吞掉错误 → 每个响应被跳过 → 笔记数永远 0，作者名永远为空
2. `app.js` 侧边栏导航 `sidebarNav` 处理函数仅处理了 `page-library`, `page-dashboard`, `page-reports`, `page-accounts`...（缺 `page-accounts` 路由）
3. `followAccount` 的空滚动循环无提前退出机制 → 30 次 × 2s = 60s 空耗
4. 无作者名降级 — 即使 API 响应有数据，`authorName` 提取路径也全被 JSON.parse 崩溃阻断

**修改**:
- `xhsCrawler.mjs:followAccount` — `JSON.parse(body)` → `JSON.parse(body.text || body)`
- `xhsCrawler.mjs:followAccount` — 新增空滚动计数器，连续 5 次空滚动提前停止
- `xhsCrawler.mjs:followAccount` — 新增 `<title>` / `<meta property="og:title">` 作者名降级
- `public/app.js:sidebarNav` — 补 `if (a.dataset.page === "page-accounts") renderAccounts();`
- `public/app.js` + `src/server.mjs` — 新增 `/api/accounts/detect-name` API + URL blur 自动识别人名

### 2026-06-22 v1.07 新增: 账号头像 + 搜索按钮超时 + 服务器全局异常捕获
**问题**:
1. 账号卡片头像仅显示品牌名首字母，无真实头像
2. 抓取按钮点击后容易卡死（Playwright 耗时 >60s 无反馈）
3. `followAccount` 中 `avatarUrl` 声明在 `try` 块内，`return` 在 `try-finally` 外 → `ReferenceError` → 进程崩溃
4. 无全局异常处理器，任何未捕获的 Promise 拒绝或异常都会终止进程

**修改**:
- `xhsCrawler.mjs:followAccount` — `let avatarUrl` 从 `try` 内移到函数顶层（与 `authorName` 同级）
- `xhsCrawler.mjs:followAccount` — 新增 `<meta property="og:image">` / `img[class*=avatar]` / `__INITIAL_STATE__` 三级降级提取头像 URL
- `storage.mjs` — 新增 `followed_accounts.avatar_url` 字段 + `upsertFollowedAccount` 支持 `avatarUrl` 参数
- `server.mjs` — `/api/follow/crawl` 返回 `avatarUrl`，存入 `upsertFollowedAccount`
- `scheduler.mjs` — 定时跟随任务也传递 `avatarUrl` 到 `upsertFollowedAccount`
- `server.mjs` — 新增 `process.on('unhandledRejection')` + `process.on('uncaughtException')`
- `public/app.js` — 抓取按钮添加 `AbortController` 120s 超时；头像显示 `<img>` 替代首字母
- `public/styles.css` — 新增 `.account-avatar-img` / `.account-avatar-letter` 样式

### 2026-06-22 v1.07 核心修复: followAccount 完全重写
**问题**: 即使 JSON.parse 修复后，`followAccount` 仍然返回 0 条笔记。因为 v1 API 全部封禁（6-22 已验证），浏览器上下文中的 API 响应拦截同样收不到数据，导致所有 scroll 循环都空跑。

**分析**: XHS 用户主页笔记通过已封禁的 `user_posted` API 异步加载，Playwright SSR 能看到的仅是 SSR HTML（不含笔记卡片数据）。页面渲染后（JS 执行完毕），DOM 中的笔记卡片可通过 `extractAccountLinks`（DOM 链接提取）可靠发现，然后每条笔记可走 HTTP 快速路径（`fetchNoteViaHttp`）或 Playwright 子页独立采集。

**修改**:
- `xhsCrawler.mjs:followAccount` — 完全重写：放弃 `attachResponseCollector` API 响应拦截 → 改用三层提取策略：
  1. `extractAccountLinks` 从页面 DOM 提取笔记链接（12 次滚动，~18s）
  2. 每条笔记优先 HTTP 快速路径（`fetchNoteViaHttp`，~300ms，需 `xsec_token`）
  3. 失败时降级 Playwright 子页导航 + `extractNote` DOM 解析（~5000ms）
- 新增 `__INITIAL_STATE__` / HTTP 直连 profile 页作为链接提取的备用方案（`user.notes` / `noteResult`）

### 2026-06-22 HTTP 快速路径：fetchNoteViaHttp + 自动降级 Playwright
**问题**: Playwright SSR 采集单条笔记约 5000ms，且每次都需要启动浏览器，对小规模采集过于沉重。

**分析**: 对比 XHS-Downloader（Python，纯 HTTP GET + `__INITIAL_STATE__` YAML 解析），发现不需要浏览器也能提取笔记数据，但 SSR 数据中 <20% 的笔记内容为空（数据通过 JS 异步加载）。XHS-Downloader 无签名算法，不调 API。

**修改**:
- 新增 `src/xhsSdk.mjs:parseInitState()` — 通用 `__INITIAL_STATE__` 解析，`undefined`/`NaN` 替换后 `JSON.parse`
- 新增 `src/xhsCrawler.mjs:fetchNoteViaHttp()` — HTTP fetch + `parseInitState` + 素材提取，~300ms
- `crawlXhs()` 改为 HTTP 优先 → 失败降级 Playwright SSR
- `extractAccountNotes()` 逐条采集也优先用 HTTP 路径

**实测**: 带 `xsec_token` 笔记从 5000ms（PW）降至 325ms（HTTP），快 ~15 倍；无 `xsec_token` URL 正常降级 Playwright

### 2026-06-22 API 架构迁移：删除 xhsApiClient.mjs，Playwright SSR 为主线
**问题**: 所有 v1 API 端点（feed/note/user_posted/search）均返回 404/406，API 直连路径完全不可用。

**根因**: XHS 网关（Kong）已封锁非浏览器请求，浏览器上下文中的 JavaScript 生成的签名可通过验证，但 Node.js fetch 请求无法通过。

**修改**:
- 删除 `src/xhsApiClient.mjs`，合并 `whoami()` 到 `xhsCrawler.mjs`
- 重写 `followAccount()` 为 Playwright SSR：导航到用户主页 + `attachResponseCollector` 拦截 `user_posted` 响应
- 移除 `crawlXhs()`/`searchXhs()`/`collectComments()` 中的 API-first 代码
- 简化 `/api/xhs/health` 路由：调用 `whoami()` + 数据库统计替代创作者 API
- `scheduler.mjs` 跟随任务改用 `knownNoteIds`（JSON 数组）替代 API `cursor`

### 2026-06-17 API-first 路径 Bug 修复
**问题**: API-first 路径 (`fetchNoteFromApi`) 返回的笔记 contentType 错误（应为"视频笔记"却显示"图文笔记"），且 images/videos 数量为 0，导致所有笔记标记为"需人工复核"。

**根因**: API 响应使用 snake_case 字段名，但提取函数使用 camelCase：
1. `img.stream: {}`（空对象）在 JS 中为 truthy，导致代码错误进入 livePhoto 分支
2. `bestImageUrl()` 不识别 `url_pre`（只识别 `urlPre`）和 `info_list`（只识别 `infoList`）
3. `extractVideoStreamAssets()` 不识别 `master_url`（只识别 `masterUrl`）

**修改**:
- `src/xhsSdk.mjs:bestImageUrl` — 增加 `url_pre`, `info_list` 兼容检查
- `src/xhsCrawler.mjs:extractVideoStreamAssets` — 增加 `master_url`, `backup_urls`, `bit_rate`, `file_size` 兼容检查
- `src/xhsCrawler.mjs:fetchNoteFromApi` — 修复 `img.stream` 空对象 truthy 检查（`Object.keys(img.stream).length > 0`）
- `src/xhsCrawler.mjs:fetchNoteFromApi` — 增加 `xsec_source` URL 参数提取并传递给 API 调用
- `src/reportGenerator.mjs:totalInteractions` — 增加 `liked_count`, `comment_count`, `collected_count`, `share_count` 兼容检查

## 已验证的功能（2026-06-17 全面测试）
- API-first 采集：图文笔记（7-13张图片）和视频笔记（封面+视频）均正确提取 ✅
- 内容分析：5 篇笔记完成钩子检测、主题词频、句式分布分析 ✅
- 内容分类：视觉参考库/选题库/营销话术库 CRUD 正常 ✅
- 周报/月报生成：Top10、品牌分布、环比分析正常 ✅
- 仪表盘统计：notes/assets 计数、byType 聚合正常 ✅
- 现有测试：mcp-smoke-test、storage-filter-test 均通过 ✅
- 所有 22 个源文件语法检查通过 ✅
- **2026-06-22 新增验证**：`whoami()` v2 API 端点正常工作 ✅；删除 `xhsApiClient.mjs` 后服务器正常启动 ✅

## 输出语言
除非用户明确要求英文，所有说明、界面文案、文档、思考过程和最终回复默认使用简体中文。禁止混合中英文输出，禁止在中文上下文中插入英文术语（除非术语无标准中文翻译）。

## 工作流程规则
- **每次功能更新后**必须：① 更新 `CHANGELOG.md` 和 `AGENTS.md`（关键文件章节）同步记录 ② 重启服务器应用新功能
- **每次写完功能后**必须进行测试验证（语法检查 + 启动测试 + 关键路径冒烟），测试通过才能正式发布
- **版本号规则**：从 v1.0 开始，每次功能更新递增 0.01（v1.01 → v1.02 → v1.03 ...）

## 关键文件
- `src/xhsSdk.mjs`：低层 SDK（核心解析逻辑，含 `parseInitState`、`attachResponseCollector`）
- `src/xhsCrawler.mjs`：业务编排（`followAccount` / `fetchNoteViaHttp` / `crawlXhs` / 双层策略）
- `src/xhsHealth.mjs`：健康检测工具函数，已不直接参与路由
- `src/xhsViralAnalysis.mjs`：病毒性分析（免 LLM 8 类钩子 + 互动率）
- `src/contentAnalysis.mjs`：内容统计聚合
- `src/reportGenerator.mjs`：内容报告
- `src/crawler/auth.mjs`：专用浏览器 profile 绑定、Cookie 提取和后台授权态刷新
- `src/xhsAuth.mjs`：AES-256-GCM Cookie 加密
- `src/server.mjs`：Express 服务器（含账户/跟随/检测名称/全局异常 API）
- `src/storage.mjs`：SQLite 存储层（9 张表 + followed_accounts/follow_checks 跟踪）
- `src/downloader.mjs`：下载引擎
- `src/scheduler.mjs`：定时调度模块（60s 轮询，支持 follow 任务）
- `src/settings.mjs`：默认配置（12 家 AI 服务预设 + 自定义）
- `src/time.mjs`：北京时间工具
- `public/index.html` / `app.js` / `styles.css`：前端 SPA
