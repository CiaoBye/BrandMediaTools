# 小红书品牌内容情报与素材抓取工具

一个本地网页工具，用于将小红书公开/授权内容采集成品牌内容案例库，支持 AI 内容拆解、素材归档、多账号管理、定时采集和可视化仪表盘。

## 最新版本：v1.14.9（2026-07-02）

- 案例卡片和详情弹窗不再展示“完整入库/待确认/缺失素材”等状态，只保留内容本身，避免干扰浏览。
- 数据大盘新增“待补素材”指标，由后端 `assetIntegrity` 真实计算，仅统计确认缺少素材的笔记。
- 账号抓取链路增加 HTTP 快速路径有限并发，默认 `xhs.accountHttpParallel = 4`，在不改变降级策略的前提下提升批量采集效率。
- 定时任务支持 5 段 Cron 表达式，设置页可配置默认 Cron；未配置时仍按原有间隔执行。
- 本版本已通过 `npm test` 全量回归。

## 当前能力

### 采集核心
- 小红书笔记链接采集，支持直接粘贴 Web 端复制的整段分享文本。
- 支持多链接自动提取，兼容 `explore`、`discovery/item`、`user/profile`、`xhslink.com` 形式。
- **公开页 HTML + Playwright 双层策略**：单篇作品默认先不带 Cookie 请求公开分享页 HTML，解析 `window.__INITIAL_STATE__` 中的结构化数据；公开页解析失败或素材不足时，再使用 Cookie/Playwright 兜底补齐。
- **XHS-Downloader 式主路径**：公开作品页可访问时，不依赖登录态 Cookie 即可提取标题、正文、作者、互动数据、图片、视频和 Live 图地址。
- 支持 `/xhs/detail` 接口，参数对齐 XHS-Downloader：`url/download/index/cookie/proxy/skip`。
- 支持 `/xhs/links` 和 CLI `--links` 提取账号主页、搜索页、推荐页、专辑/收藏等页面作品链接。
- 支持本地 MCP 模式，暴露 `xhs_detail` 和 `xhs_links` 给 Agent/自动化调用。
- 支持命令行模式：采集、下载、序号筛选、Cookie、代理、跳过已下载记录。
- 支持命令行读取剪贴板和监听剪贴板。
- 支持 `data/settings.json` 配置文件。
- 支持从本机 Playwright 浏览器登录态保存 Cookie。
- 下载层支持 `.part` 临时文件、Range 续传、失败重试、下载间隔、超时控制。

### 素材品质（增强）
- **图片**：自动选择宽高积最大 + 无水印的候选；支持 `x-oss-process=image/` 参数清洗；支持格式转换（AUTO/JPEG/PNG/WEBP）和品质配置。
- **视频**：水印惩罚分 `-100000`，优先选 `sns-video` CDN 最高分辨率地址；支持 `videoMinHeight` 分辨率过滤。
- **Live 图文**：结构化解析 `imageList.livePhoto` 与 `stream` 字段，保存静态图 + 配对动态视频，记录 `pairedImageIndex`。

### 数据存储与管理
- SQLite 本地数据库（`data/app.db`）。
- **内容分类管理**：支持笔记归入选题库/脚本模板库/视觉参考库/营销话术库，前后端 CRUD 及批量操作。
- 内容案例库支持按品牌、账号、内容类型、营销目的、素材类型、内容分类筛选。
- 下载记录去重：同一笔记重复采集时替换旧资产记录，已存在文件跳过。
- **级联删除**：笔记删除联动清除本地素材文件 + 数据库清理。

### AI 内容拆解
- 支持 12 家 AI 服务预设及自定义入口，自动填入接口地址和模型列表。
- 覆盖：选题逻辑、开头钩子、内容结构、视觉风格、转化话术、可借鉴点。
- 未配置 API Key 时使用结构化占位分析。

### 内容分析与统计
- **标题分析**：8 类钩子模式检测 + 句式分布（疑问式/数字列举/否定式/身份代入等）
- **主题词云**：自动提取描述中的高频短语
- **互动统计**：平均点赞/评论/收藏/分享，最高互动排行
- **视觉/营销分布**：视觉风格和营销目的占比统计
- **内容分类管理**：选题库/脚本模板库/视觉参考库/营销话术库，支持单条和批量操作

### 账号与登录
- **登录主流程简化**：前端只保留「打开专用浏览器绑定」和「手动粘贴完整 Cookie」两个绑定入口，以及「检测 Cookie」诊断入口。
- **专用浏览器绑定**：使用项目专属 `.browser-profile/chrome-cdp` 配置目录打开小红书，用户正常登录后保存并校验真实登录态 Cookie。
- **手动完整 Cookie 兜底**：按浏览器 Network 请求复制完整 Cookie，保存前必须通过真实登录态校验。
- **Cookie 加密存储**：AES-256-GCM，密钥绑定当前机器、项目目录和应用密钥，并兼容旧数据读取。
- **账号矩阵管理**：绑定/检测/删除多账号，前端 UI 面板。

### 搜索与评论
- **搜索**：使用授权 Cookie 的 Playwright 页面搜索，结果卡片网格展示，点击填入采集框。
- **评论采集**：从页面 DOM、初始化状态和浏览器内合法响应提取。

### 仪表盘与内容分析
- **仪表盘**：`GET /api/stats` 聚合，本地 Chart.js 渲染 5 图表（采集趋势、类型分布、品牌分布、素材类型、状态分布）。
- **内容分析**：`GET /api/stats/content-analysis` 聚合 6 图表（标题钩子、句式分布、内容类型、营销目的、视觉风格、分类统计）+ 主题词云。
- **内容报告**：每周简报 / 每月复盘自动生成，含 Top 10 笔记、作者排行、品牌分布、内容类型、标题钩子、环比分析，支持 JSON/Markdown 导出。
- **健康检测**：`POST /api/xhs/health` 分析账号健康状态（level 字段 → 分发/限流/敏感词报告）。
- **病毒性分析**：`POST /api/analyze/viral` 免 LLM 分析笔记病毒性（8 类钩子模式 + 互动率 + 评论主题聚类）。
- **定时自动采集**：`scheduler.mjs` 每 60 秒轮询，支持 `crawl` 和 `search` 类型任务 + 执行日志。

### 文件命名模板
`download.nameFormat` 支持 chip 可视化编辑，支持占位符：
- `{index}`、`{kind}`、`{noteId}`、`{title}`、`{author}`、`{brand}`
- `{publishedAt}`：发布时间 ISO 字符串
- `{date}`：发布时间或采集时间 `YYYYMMDD`
- `{tags}`：标签，`-` 连接
- `{likes}`、`{comments}`、`{collects}`、`{shares}`：互动数据

### 其他
- Eagle 友好导出：按品牌/账号/笔记建立目录，生成 sidecar JSON 元数据。
- OpenClaw / Hermes 监测平台接口预留。

## 合规边界
工具只处理公开可访问或用户授权访问的内容。不实现登录绕过、风控绕过、破解下载、DRM 绕过或二次去水印处理。

## 启动方式

```powershell
npm start
```

或直接双击 `启动工具.bat`，然后访问：

```text
http://127.0.0.1:4173
```

## 命令行模式

```powershell
npm run xhs -- "小红书分享文本或链接" --download
```

常用参数：`--download`、`--skip`、`--index`、`--cookie`、`--proxy`、`--brand`、`--max-notes`、`--headless`、`--links`、`--scroll-pages`、`--clipboard`、`--watch-clipboard`、`--save-cookie`、`--wait-ms`。

## MCP 模式

```powershell
npm run mcp
```

当前 MCP 工具：
- `xhs_detail`：采集作品或账号主页内容。
- `xhs_links`：提取页面中的作品链接。

## AI 配置

复制 `.env.example` 为 `.env`，填入 API Key。支持 12 家服务预设，也可手动填入兼容 OpenAI 接口格式的地址和模型。

未配置 API Key 时生成结构化占位分析。

## 小红书 Cookie

当前前端仅保留两种绑定方式：

- 网页「打开专用浏览器绑定」：使用项目专属 `.browser-profile/chrome-cdp` 调试浏览器，若未登录会打开登录页，等待用户正常扫码/短信登录后再保存。
- 网页「手动粘贴完整 Cookie」：按浏览器开发者工具 Network 请求复制完整 Cookie，粘贴后通过真实登录态校验才保存。

兼容读取方式：

- 环境变量 `XHS_COOKIE` 或 `data/xhs-cookie.txt`
- CLI `--save-cookie`

Cookie 使用 AES-256-GCM 加密存储，仅供正常授权页面访问。系统会解析小红书页面状态，若 Cookie 只是访客态或已跳登录页，会判为无效，避免定时任务反复无效访问。
定时健康巡检每 2 小时会检查账号 Cookie；若启用 CDP 且专用浏览器已有有效登录态，会尝试非交互式刷新单账号 Cookie。

单篇作品采集默认优先走无 Cookie 公开页解析；Cookie 只在公开页数据不足、页面不可访问或需要授权内容时作为兜底，不再作为作品采集主路径。

## 数据目录
- `data/app.db`：SQLite 数据库
- `data/library/`：采集素材库
- `data/eagle-export/`：Eagle 导出目录
- `.browser-profile/chrome-cdp/`：专用 CDP 浏览器登录态
- `.browser-profile/tool-profile/`：Playwright 持久浏览器登录态

## 配置文件 `data/settings.json`

可配置：Cookie、代理、浏览器路径、采集数量、下载目录、图片格式/品质、视频分辨率过滤、命名模板、下载开关、重试/间隔/超时。

## 测试

```powershell
npm test
npm run test:xhs
npm run test:mcp
npm run test:eagle
npm run test:download-template
npm run test:clipboard
npm run test:links-merge
npm run test:storage-filter
```

测试反馈详见 `TEST_REPORT.md`。
