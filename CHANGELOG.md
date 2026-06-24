# 更新日志

## v1.10 (2026-06-24)
- **下载链路修复**：补齐临时文件原子重命名；新增 WebP 转换；PNG 使用正确压缩级别；旧目录迁移仅删除空目录，避免误删同作者其他素材。
- **报告与统计修复**：修复周报/月报未定义变量导致的 500；按北京时间自然月和等长对比周期计算；内容互动统计兼容多种指标字段。
- **浏览器降级修复**：HTTP 快速路径失败后，Playwright 会直接导航目标笔记页再解析；新增本地页面回归测试确认降级链路可用。
- **调度与追踪修复**：失败任务写入下一次执行时间，避免每分钟重复失败；暂停状态读取正确任务；账号追踪游标保留历史 ID；取消跟随后同步删除关联定时任务。
- **登录与 Cookie 修复**：二维码仅在识别到真实二维码时返回；不再把匿名 `a1` Cookie 判为登录成功；Cookie 加密密钥绑定当前机器和项目，并兼容旧数据解密。
- **素材解析与通知修复**：Live 图文类型识别稳定；图片、视频、Live Photo 统一保留 `sourceUrl`；通知配置完整读写，测试通知使用当前表单值并校验 HTTP 状态。
- **文件与服务安全修复**：素材访问使用真实路径白名单；请求体限制 2MB；Range 非法请求返回 416；新增安全响应头和内容安全策略；删除笔记只删除素材库内归属文件，不递归删除共享目录。
- **前端修复**：Chart.js 改为本地依赖，不再受 CDN 失败影响；无图表时列表仍渲染；修复账号页结构、详情视频、品牌对比、移动端导航、任务行横向溢出和布局；移除全部内联事件以兼容内容安全策略。
- **时间修复**：数据库统一存储 UTC；展示、日志和导出按北京时间格式化；加入一次性旧调度时间迁移。
- **测试体系**：新增语法检查、核心回归、调度回归、Playwright 降级和服务集成测试；`npm test` 覆盖 47 个源码/测试文件并全部通过。

## v1.09 (2026-06-23)
- **Bugfix: 账号追踪显示0篇** — `followed_accounts.total_found` 仅记录末次抓取结果，非数据库真实笔记数。修复：`/api/follow/accounts` 新增 `noteCount` 字段（`SELECT COUNT(*)`），前端改用 `noteCount`
- **Bugfix: 账号库头像丢失** — `detect-name` 仅返回 `name`，创建跟随任务时不传 `avatarUrl`。修复：`detect-name` 端点同时返回 `avatarUrl`（从 `__INITIAL_STATE__` / `og:image` / DOM 选择器提取），前端保存账号时传递 `avatarUrl` 到跟随端点
- **Bugfix: 仪表盘品牌对比不显示** — `renderBrandCompare()` 已定义但从未被调用。修复：在 `renderDashboard()` 末尾添加 `renderBrandCompare()`
- **Bugfix: 内容分析标题与正文分析函数混淆** — `getBodyStats(filtered, analyzeTitle)` 用标题分析函数分析正文，`bodyLength`/`hasCallToAction`/`hashtagCount` 全部为 undefined。修复：改为 `getBodyStats(filtered, analyzeBody)` + 补充导入 `analyzeBody`
- **Bugfix: 内容分析视觉风格分布为空** — `getVisualStyleStats` 仅读 `note.visualStyle`（始终为空），未查 `note.analysis?.visualStyle`（AI 拆解结果）。修复：优先读 `note.analysis?.visualStyle`
- **改进：案例库无限滚动** — 新增 `renderLimit`/`renderStep`(30) + IntersectionObserver(rootMargin:200px)，分片渲染降低首屏时间，切换筛选条件时重置
- **改进：笔记详情弹窗支持视频展示** — 媒体轮播混合图片+视频，视频项显示 `<video controls>`
- **改进：笔记详情弹窗增加评论入口** — 右栏新增「💬 评论」按钮，点击懒加载评论列表

## v1.08 (2026-06-22)
- **Bugfix: followAccount 登录页重定向无检测** — Playwright 导航到账号主页时若 Cookie 无效/过期，页面被重定向到 `/login` 但代码无检测，静默返回 0 结果。新增：导航后检查 `page.url()` 是否包含 `/login`，判读 `__INITIAL_STATE__` 中 `_value.guest` 决定提示"访客会话"还是"无效/过期"
- **Bugfix: 名称提取忽略 Vue reactive wrapper** — `__INITIAL_STATE__` 中的 `userPageData` 被 Vue `_value`/`_rawValue` 包装，原有提取路径 `user.userInfo.nickname` 始终为 `{userId:null}`。修复：展开 `_value`/`_rawValue`，提取 `basicInfo.nickname`，增加最多 3 次 (×3s) 重试等待 JS 渲染
- **Bugfix: detect-name 对账号主页完全失效** — profile URL 时 HTTP fetch 获取不到异步渲染的昵称；修复后 profile URL 改用 Playwright 渲染（5 次 ×3s 轮询），非 profile 走 `noteDetailMap` 提取笔记作者，所有 HTTP 路径增加 Cookie header
- **Bugfix: QR 登录后昵称非实际用户名** — `collectQrCookies()` 用错误 DOM 选择器提取昵称，失败后使用自动生成的 "账号-" + 时间戳。修复：优先用 `__INITIAL_STATE__` 的 Vue 展开值获取真实昵称
- **Bugfix: 抓取全链路 Cookie 源不全** — 爬取端点仅读文件 Cookie，不查 DB 中已绑定的有效账号。新增 `resolveCookie()` 统一从文件→设置→环境变量→DB 依次查找可用 Cookie
- **改进: 调度器 follow 任务 Cookie 降级** — 当 `task.account_id` 无有效 Cookie 时，回退读取文件 Cookie 和 DB 已绑定账号
- **改进: 前端抓取按钮显示实际错误** — 按钮文案展示 Cookie/登录相关错误片段而非笼统的"失败"；恢复时间延长至 4s
- **Bugfix: QR 登录放 cookie 页面自动登录** — `launchPersistentContext` 从磁盘加载过期 Cookie 导致状态误判。重写：改用 `browser.launch()` + `browser.newContext()` 无痕浏览器，避免继承旧状态
- **Bugfix: QR 登录完成后状态检测不到** — `checkQrLoginStatus` 使用 Cookie 和 `__INITIAL_STATE__` 双重检测，登录页本身设置的 `a1`/`web_session` 被误认为已登录。重写：URL 变化后等待 Cookie 就绪再判定；登录页上严格区分 `auth.guest` 和 `loggedIn` 字段
- **Bugfix: QR 登录后昵称仍然为"账号-xxx"** — `collectQrCookies` 昵称提取使用 `__INITIAL_STATE__` 多重路径 + DOM 选择器 + `<title>` 三级降级
- **Bugfix: QR 登录最终 Cookie 不写入文件** — `/api/auth/qr/finalize` 同时写入 DB 和 `data/xhs-cookie.txt`，确保所有读路径可用
- **Bugfix: findInstalledBrowser 未导出** — `xhsSdk.mjs` 中改为 `export function` 供 `xhsLogin.mjs` 引入
- **Bugfix: QR 登录被过期 Cookie 欺骗** — `checkQrLoginStatus` 发现 `a1`/`web_session` 即判为已登录，未验证是否真的有效。修复：导航到 explore 页检查 `__INITIAL_STATE__` 的 `guest`/`loggedIn` 字段；检测到过期残留 Cookie 时自动清除并通知前端刷新二维码
- **Bugfix: QR 登录 persistent profile 残留过期 Cookie** — `launchPersistentContext` 从磁盘加载旧 Cookie，导致状态误判。修复：在 `checkQrLoginStatus` 中清除过期 Cookie 并关闭上下文，前端收到 `clear_and_retry` 后自动重新获取二维码

## v1.07 (2026-06-22)
- **Bugfix: followAccount JSON.parse 对象崩溃** — `attachResponseCollector` 推入 `{url,contentType,text}` 对象，`JSON.parse(body)` 强制转为 `"[object Object]"` 导致跳过所有响应，笔记数永远为 0。改为 `JSON.parse(body.text || body)`
- **Bugfix: 账号抓取空滚动永不退出** — 连续 5 次空滚动（每次 2s，总 10s）提前停止，避免超时
- **Bugfix: 账号抓取后作者名永远为空** — 从页面 `<title>` / `<meta>` 提取作者名作为降级方案
- **Bugfix: 侧边栏「账号追踪」无响应** — `app.js:sidebarNav` 缺 `page-accounts` 路由判断，点击后停留在前一个面板
- **Bugfix: followAccount 中 avatarUrl 作用域错误** — `let avatarUrl` 声明在 `try` 块内，但在 `try-finally` 外的 `return` 中引用导致 `ReferenceError`，Node 进程崩溃。提到与 `authorName` 同级的函数作用域
- **新增: 账号链接自动识别名称** — 输入／粘贴账号主页链接后 `blur` 自动调用 `/api/accounts/detect-name`（HTTP fetch → `parseInitState` → 提取 `user.userInfo.nickname`），失败时降级 `<title>` 提取
- **新增: 账号头像抓取** — `followAccount` 新增 `avatarUrl` 提取（DOM 的 `<meta property="og:image">` / `img[class*=avatar]` 和 `__INITIAL_STATE__` 的 `user.userInfo.avatar`），存入 `followed_accounts.avatar_url`，账号卡片显示真实头像
- **改进: 前端抓取按钮增加 120s 超时** — 使用 `AbortController` 防止无限等待
- **改进: 服务器增加全局异常处理** — `process.on('unhandledRejection')` 和 `process.on('uncaughtException')` 防止未捕获错误导致进程退出
- **改进: Playwright 导航超时缩短至 30s** — 导航失败不抛错，继续使用当前页面状态
- **重构: followAccount 完全重写** — 放弃已失效的 API 响应拦截方式（v1 API 全部封禁），改用 `extractAccountLinks`（从页面 DOM 提取笔记链接） + `fetchNoteViaHttp`（HTTP 快速路径，~300ms/条）+ Playwright 子页降级的三层策略。新增 `__INITIAL_STATE__` / HTTP 直连 profile 页作为 link 提取的备用方案。所有笔记无需等待 API 响应，从 DOM 可见即可采

## v1.06 (2026-06-22)
- **HTTP 快速路径（XHS-Downloader 方式）** — 新增 `fetchNoteViaHttp()`：直接 HTTP fetch 笔记页 HTML → 解析 `__INITIAL_STATE__` → 提取数据，约 300ms 完成
- **`crawlXhs()` 双层策略** — 优先走 HTTP 快速路径（仅限含 `xsec_token` 的笔记 URL），失败时自动降级 Playwright SSR
- **`extractAccountNotes()` 加速** — 账号笔记逐条采集也优先使用 HTTP 路径，仅失败时走 Playwright 子页面
- **新增 `parseInitState()`** — 通用 `__INITIAL_STATE__` 解析函数，处理 `undefined`/`NaN` → `null` 替（XHS-Downloader 用 YAML 解析，我们用 JSON 预清洗）
- **性能** — 带 `xsec_token` 的笔记采集从 ~5000ms（Playwright）降至 ~300ms（HTTP），快约 16 倍
- **可靠性** — <20% 笔记数据在 SSR 中为空（异步加载），自动降级 Playwright 保证数据完整性

## v1.04 (2026-06-22)
- **Bugfix**: 修复账号抓取时报 `API错误: {"code":-1,"success":false}` — `getUserNotes()` 使用 `mainGet`（GET 请求），现代 XHS API 要求 POST，改为 `mainPost`
- **改进**: `handleResponse()` 对 `code:-1/-8` 给出中文提示（"Cookie 过期/API 端点变更/参数错误"），替代原来的无差别 `API错误` 输出
- **改进**: 抓取接口 (`POST /api/follow/crawl`) 增加 Cookie 为空时的直接提示，避免空白请求 XHS API

## v1.03 (2026-06-22)
- **时区统一为北京时间**：之前所有时间使用 UTC（慢 8 小时），现全部改用北京时间
  - 前端：新增 `fmtBJ()` / `dateBJ()`，所有界面时间使用 `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai" })` 渲染
  - 后端：`scheduler.mjs` `now()`、`logger.mjs` 日志时间戳、`downloader.mjs` `compactDate()`、`eagleExporter.mjs` `stamp()` 统一 `Date.now() + 8h`
  - 报告：`reportGenerator.mjs` 日期范围计算基于北京时间，输出 `from`/`to` 为北京时间字符串
  - 导出文件名：前端下载、CSV/JSON 导出均使用 `dateBJ()`（北京时间）

## v1.02 (2026-06-22)
- **Bugfix**: 修复点击「跟随」按钮报 `UNIQUE constraint failed` 错误 — `upsertFollowedAccount()` 读取 `input.user_id`，但所有调用方传入 `userId`（大小写不一致），导致属性落地为 `""`，重复操作时报唯一约束冲突
- 存储层 `upsertFollowedAccount()` 增加 `input.userId` 兼容检查（`uid = input.user_id || input.userId`）

## v1.01 (2026-06-22)
- 账号卡片新增「编辑」按钮（弹窗修改品牌/名称/链接/调性/行业/优先级）
- 账号卡片新增「删除」按钮（删除账号并自动清理跟随记录）
- 后端新增 `PUT /api/accounts/:id` 和 `DELETE /api/accounts/:id` 路由
- 存储层新增 `updateAccount()` 和 `deleteAccount()` 方法

## v1.0 (2026-06-22)
- **账号追踪系统**：账号库与跟随功能合一，「账号库」改为「账号追踪」页面
- 每个账号卡片直接显示跟随状态、发现笔记数、上次检查时间、迷你检查趋势柱状图
- 新增 `followAccount()` 函数（基于 `getUserNotes` API 分页拉取，cursor 断点续查）
- 新增 `followed_accounts` + `follow_checks` 数据库表记录跟踪状态
- 定时调度支持 `task_type: "follow"`，自动提取 userId、对比去重、落盘新笔记
- 新增 API：`POST /api/accounts/:id/follow`（启用/取消跟随）、`POST /api/follow/crawl`（立即抓取）、`GET /api/follow/accounts`（列表含统计）、`GET /api/follow/accounts/:id/timeline`（时间线）
- **文件夹命名**：默认 `folderNameFormat` 改为 `{date}-{type}-{titleShort}`
- 新增 `{type}` 模板变量（视频笔记→视频，图文笔记/Live图文→图文）
- 新增 `{titleShort}` 模板变量（自动截断 20 字）
- 账户库添加账号时自动开启跟随（若填了主页链接）

## v0.8 (2026-06-17)
- 新增内容报告系统（`reportGenerator.mjs`）：本周简报 / 本月复盘
- 报告含 Top 10 笔记、作者排行、品牌分布、内容类型、营销目的、内容分类、标题钩子分析、环比变化
- 新增 API：`GET /api/reports/weekly-brief`、`GET /api/reports/monthly-review`
- 前端新增报告页面，支持生成查看 + JSON/Markdown 导出

## v0.7 (2026-06-17)
- 新增内容分析面板（标题钩子分布、句式分布、主题词云、营销目的/视觉风格/内容类型统计）
- 新增笔记分类管理（`library_type` 字段：选题库/脚本模板库/视觉参考库/营销话术库）
- 后端新增 `contentAnalysis.mjs`（getTitleStats / getBodyStats / getEngagementStats 等 9 个分析函数）
- 新增 API：`GET /api/stats/content-analysis`、`POST /api/notes/:id/library`、`POST /api/notes/batch/library`、`GET /api/notes/libraries`
- 案例库新增分类过滤下拉 + 批量分类按钮 + 单笔记分类快捷切换
- 案例库表格视图新增内容分类列

## v0.6 (2026-06-08)
- 移植 XHS API 签名算法（`xhsSigning.mjs`：XYS_ 主 API + XYW_ 创作者 API）
- 新增 API 直连客户端（`xhsApiClient.mjs`：getNoteById / searchNotes / getComments / getUserNotes / whoami / healthCheck）
- 移植健康检测（`xhsHealth.mjs`：creator 后端 level 字段分析）
- 移植病毒性分析（`xhsViralAnalysis.mjs`：免 LLM，8 类钩子模式 + 互动率）
- **API-first + Playwright 降级**：crawlXhs / searchXhs / collectComments 均先走 API 直连，失败后自动降级
- 品质增强：视频同级分辨率按码率决胜（bitrate tiebreaker）
- 命名模板：拆分文件夹/文件两级模板，`collapseSeparators` 自动修复 `--` 问题
- 新增 `/api/xhs/health`（健康检测）、`/api/analyze/viral`（病毒分析）
- 前端新增健康检测按钮、病毒分析入口

## v0.5 (2026-06-08)
- 新增批量导出弹窗（JSON/CSV 格式选择）
- 新增批量打标签（弹窗输入逗号分隔标签）
- 新增批量移动品牌（弹窗输入目标品牌名）
- 后端新增 `exportNotes()`、`batchUpdateTags()`、`batchUpdateBrand()`
- 新增 API：`POST /api/notes/batch/export`、`POST /api/notes/batch/tags`、`POST /api/notes/batch/brand`

## v0.4 (2026-06-08)
- 新增通知系统（notifications 表入库）
- 账号自动健康巡检（每 2 小时检测 Cookie 有效性，失效自动通知）
- 侧边栏新增铃铛按钮 + 未读角标
- 右侧通知面板（全部已读、单条标记已读）
- 前端每 30s 轮询未读数
- 后端新增 notifications CRUD + `/api/xhs-accounts/check-all` 手动检测

## v0.3 (2026-06-08)
- 仪表盘新增时间范围筛选（近 7/30/90 天）
- 新增互动趋势折线图（点赞、评论、收藏、分享）
- 新增热门标签云（字体大小反映频次）
- 新增 Top 20 笔记排行（按总互动量排序）
- 后端新增 `getStats(range)`、`getInteractionStats()`、`getTopNotes()`、`getTagCloud()`
- 新增 API：`/api/stats/interaction`、`/api/stats/top-notes`、`/api/stats/tag-cloud`

## v0.2 (2026-06-08)
- 内容库新增列表视图（默认列：品牌、类型、采集时间、AI 拆解）
- 卡片/列表视图切换按钮
- 每张笔记卡片新增复选框，支持多选
- 批量操作栏：全选/取消选择、批量删除、JSON 导出选中
- 全选自动同步跨视图（卡片↔列表）
- 后端新增 `batchDeleteNotes()` + `POST /api/notes/batch-delete`

## v0.1 (base)
- 初始版本：采集、搜索、评论、账号矩阵、定时任务、仪表盘、AI 拆解、Eagle 导出
