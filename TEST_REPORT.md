# 最小功能测试反馈

## v1.13.1 审计修复与稳定性强化验证（2026-06-25）

- `npm test`：通过（100%）。包含 48 个源码/测试文件语法检查，以及所有核心及集成测试。
- **真实小红书笔记及视频采集**：通过。视频笔记、图文笔记和 Live 图文在真实网络环境下均完美通过。其中纯视频类型自动划归为 `"视频笔记"`（原判定为 `"待复核"` 的 Bug 已消除）。
- **短链预解析重定向补全**：通过。当 HEAD 检测到相对路径时能够自动补全域名前缀，测试相对路径跳转无报错。
- **多账号调试 CDP 不关闭外部浏览器**：通过。测试已成功区分用户现存 Chrome 与自启 Chrome 句柄，外部 Chrome 在流程结束后未发生非正常关闭。
- **系统诊断服务接口**：通过。`/api/diagnose` 服务调用时，HTTP 快速路径以标准的 AbortController 做 10 秒超时限制，测试返回 `Status: 200`，彻底摆脱旧版 Node 不支持 `AbortSignal.timeout` 导致的 HTTP 500。

## v1.13 全链路 UI 重构与视觉体验升级（2026-06-24）

- `npm test`：通过（100%）。包含 48 个源码/测试文件语法检查，以及所有核心及集成测试。
- **重构色彩与主题系统**：通过。全面废除原紫粉 AI 霓虹渐变底色，白天模式重构为极简曜石黑（`#0f172a`）和 Slate 莫兰迪蓝灰色盘；夜晚模式重构为优雅冰川冷靛蓝（`#6366f1` / `#4f46e5`）渐变，视觉体验高端、精细。
- **通知面板透光与字迹重叠修复**：通过。将通知面板背景设为完全不透明实体底 `var(--surface-solid)`，解决层级透光重叠的视觉 Bug。
- **小红书式瀑布流卡片重构**：通过。内容库外侧卡片锁死 3:4 垂直海报尺寸，裁剪去除了外侧的话题气泡，并在左下角加入创作者圆形头像（或优雅的首字母彩色气泡占位）与昵称，右下角展示 ❤点赞数，与小红书官方卡片设计完美看齐。
- **1060px 左右双栏详情弹窗与评论自启**：通过。笔记详情页重构为 `1060px` 宽度的 `55%:45%` 双栏布局，左侧大屏纯黑遮罩，图片/视频以 `object-fit: contain` 完整无损展示；右侧以 `var(--surface-solid)` 坚实背景呈现作者名片、标题、标签与 AI 拆解；且弹窗打开后**默认自动发起评论加载**。

## v1.12 全链路与 UI 重构复测（2026-06-24）

- `npm test`：通过（100%）。包含 48 个源码/测试文件语法检查，以及核心、调度、Playwright 降级、MCP、Eagle、命名模板、剪贴板、链接合并、存储筛选和服务集成测试。
- 从 Chrome 提取 Cookie 与保存 Cookie 测试：通过。彻底修复内容安全策略 (CSP) 对 inline script 的限制，引入 `<meta name="app-token">` 安全传递 Token，**成功解决提取或手动保存 Cookie 时提示 "Forbidden: 缺少有效的 App Token" 的报错问题**。
- 写入 Cookie 与 API 端点交互：通过。通过临时脚本模拟向 `/api/settings/xhs-cookie` 发送带有 meta-tag 获取的 Token 的 POST 请求，成功返回 `200 ok`，保存操作一切正常。
- 白天明亮模式 (Light Mode) 视觉与切换功能测试：通过。
  - 左侧导航栏底部的主题切换按钮正常运作，点击可实现“白天 Slate-100 玻璃拟态”与“夜间深色发光玻璃拟态”的无感秒级切换。
  - 主题偏好通过 `localStorage` 自动存储，在页面刷新后成功记忆并维持偏好状态，没有首屏闪烁。
  - Chart.js 图表元素自适应极佳：在明亮模式下网格线自动降低透明度，文字自动调整为 Slate-600 色彩，图表数据一目了然。
  - 自建的 `showConfirm` 对话框完美适配，其背景色随着白天/夜晚的主题自适应调整，告别了暗色弹窗的突兀感。

## v1.11 全链路复测（2026-06-24）

- `npm test`：通过（100%）。包含 48 个源码/测试文件语法检查，以及核心、调度、Playwright 降级、MCP、Eagle、命名模板、剪贴板、链接合并、存储筛选和服务集成测试。
- 服务端集成测试：通过。新版本加入的随机 `APP_TOKEN` 在集成测试环境（自动检测 `NODE_ENV === "test"`）下无缝绕过，测试顺利通过，返回 200/201。
- 代码审计修复核对：通过。核对 22 个安全与健壮性修复（路径遍历、APP_TOKEN、动态密钥、JSON 安全保护、SQL 白名单限制、CSV 公式防护、SQLite 级联删除事务、 batchHydrate 批量分块等）无一遗漏。
- 自建反馈弹窗系统：通过。已验证 Toast 提示与 Modal Confirm 系统代替了原生 `alert` 与 `confirm`，操作更流畅，交互效果佳。
- 移动端响应式与骨架屏：通过。已验证 Shimmer 动画骨架屏卡片展示及移动端导航栏遮罩滑动展示，体验显著提升。
- 桌面端 UI 挤压异常修复：已验证。对移动端特有的汉堡按钮和遮罩层在桌面版下进行了隐藏设计，桌面版布局自动恢复为完整的左边栏 + 右侧宽屏卡片列表呈现，完全解决排版挤压变形问题。

## v1.10 全链路复测（2026-06-24）

- `npm test`：通过。包含 47 个源码/测试文件语法检查，以及核心、调度、Playwright 降级、MCP、Eagle、命名模板、剪贴板、链接合并、存储筛选和服务集成测试。
- `npm run test:xhs`：通过。真实视频笔记解析为 1 张封面 + 1 条视频；真实 Live 图文解析为 6 张静态图 + 6 条配对动态视频。
- 正式服务 API 冒烟：12 个端点通过、0 失败，包含健康、统计、内容分析、周报、月报、案例库、账号、任务和首页。
- 真实 CDN 下载：通过。样本《屿间风吟｜下午三点，一场声音织就的停顿》封面下载并转换为 WebP，文件大小 122198 字节。
- 周报与月报接口：均返回 200；周报未定义变量问题已消除。
- Chart.js：改为本地依赖，`/vendor/chart.umd.js` 返回 200。
- 定时任务：创建、暂停、删除接口完成集成测试；失败任务会推进下一运行时间。
- 文件安全：越界访问返回 403；删除笔记不会递归删除同目录其他素材，也不会删除素材库外文件。
- 内容安全策略：页面与脚本已无内联事件属性，严格策略下可执行。
- 移动端：375px 视口下顶部导航可横向滚动，定时任务行不再撑宽页面。
- QR 扫码：已验证服务端会话、二维码识别失败提示和登录态判断逻辑；完整人工扫码仍需用户本人在弹出的浏览器中授权完成。

测试时间：2026-06-08

## 测试链接

1. 视频链接：`6a210e2b0000000038034342`
2. Live 图文链接：`6a201838000000003601a74e`
3. 项目主页：`6464c13e0000000029010651`

## 已验证结果

### 基础采集
- 视频链接可以从整段小红书分享文本中提取真实 URL。
- 视频链接可以解析出作品标题、作者、正文、图片候选和视频候选；重复视频地址已收敛为 1 条主视频候选。
- 视频素材下载成功，已保存 `.mp4` 文件。
- 图片素材下载成功，已保存 `.webp` 文件。
- Live 图文链接可以解析出明确的 `imageList.livePhoto` 字段，并保存静态图与配对动态视频。
- 项目主页可以提取主页内的作品链接。
- 对于主页中返回"当前笔记暂时无法浏览"的作品，工具会标记为 `需人工复核`，不再误保存平台 UI 素材。
- `/xhs/detail` 接口可用，支持 `url/download/index/cookie/proxy/skip` 参数形态。
- MCP 模式可用，`tools/list` 返回 `xhs_detail` 与 `xhs_links`。
- 命令行模式可用，支持 `--download`、`--skip`、`--index`、`--cookie`、`--proxy`、`--max-notes`。
- 命令行剪贴板模式可用，支持 `--clipboard` 读取系统剪贴板中的小红书分享文本。
- 页面作品链接提取可通过 `/xhs/links`、CLI `--links` 和 MCP `xhs_links` 调用。
- `/xhs/links`、CLI `--links`、MCP `xhs_links` 在混合输入中会合并直接作品链接和页面提取链接，并优先保留带 `xsec_token` 的有效分享链。
- 作品链接输入会直接返回；账号主页、搜索页、推荐页、专辑/收藏等页面会打开浏览器滚动提取作品链接。
- 账号主页综合采集已优先保留带 `xsec_token` 的作品链接，避免裸链接导致"当前笔记暂时无法浏览"。
- 可以从本机 Playwright 浏览器登录态保存小红书 Cookie，便于正常登录后复用。
- 配置文件 `data/settings.json` 已接入，支持 Cookie、代理、下载目录、命名模板、下载开关。
- 下载层已接入 `.part` 临时文件、Range 续传尝试、失败重试、下载间隔、超时控制。
- 浏览器启动已禁用 QUIC，降低小红书页面偶发 `ERR_QUIC_PROTOCOL_ERROR` 对采集的影响。
- 资产入库会保留 Live 图配对字段，Eagle 导出会生成 `assetMetadata` 与 `livePhotoPairs`。
- 素材命名模板支持发布时间、品牌、作者、标题、标签和互动数据。
- 内容案例库筛选已落地：支持品牌、账号、内容类型、营销目的、素材类型组合筛选。

### AI 预设（新增）
- 12 家 AI 服务预设及自定义入口可自动填入接口地址和模型列表。
- 包括：OpenAI、Anthropic、Google Gemini、DeepSeek、Moonshot (Kimi)、阿里 Qwen、百度 ERNIE、零一万物 Yi、智谱 GLM、MiniMax、Together AI。

### 图片品质增强（新增）
- `bestImageUrl()` 按宽高积降序 + 无水印优先。
- `cleanAssetUrl` 自动移除 `x-oss-process=image/` 参数。
- 图片格式转换配置 `imageFormat`（AUTO/JPEG/PNG/WEBP）+ `imageQuality` 配置。

### 视频品质增强（新增）
- `scoreVideo()` 水印惩罚分 `-100000`。
- `videoMinHeight` 过滤 + `sns-video` CDN 优先。

### 命名模板 chip 可视化（新增）
- token chip 组件，点击 ✕ 移除，下拉框添加。
- 实时预览生成的文件名。

### 设置标签页重构（新增）
- 竖排导航 + 右侧面板，5 标签页：AI 配置、采集设置、下载设置、作者别名、通知。
- Cookie 管理已移至账号页面。

### QR 扫码登录（新增）
- 多账号独立会话（Map 管理模式）。
- QR 提取使用页面画布、图片标签和二维码元素截图；不再把整页截图误当二维码。
- Cookie AES-256-GCM 加密存储。

### 搜索功能（新增）
- Playwright 浏览器自动化搜索小红书。
- 结果卡片网格展示，点击填入采集框。

### 评论采集（新增）
- DOM + `__INITIAL_STATE__` 双路径提取。
- 前端评论区展示在笔记卡片下方。

### 仪表盘（新增）
- `GET /api/stats` 聚合 6 项统计指标。
- 本地 Chart.js 渲染 5 图表：采集趋势（折线）、类型分布（饼图）、品牌分布（柱状）、素材类型（饼图）、状态分布（柱状）。

### 账号矩阵管理（新增）
- `xhs_accounts` 表 + CRUD 路由。
- 前端绑定（QR 扫码 / 手动粘贴 Cookie）、健康检测、删除。

### 定时自动采集（新增）
- `scheduled_tasks` 表 + `task_logs` 表。
- `scheduler.mjs` 每 60 秒轮询执行 `dueTasks`。
- 支持 `crawl`（采集笔记）和 `search`（搜索）类型。

### 级联删除（新增）
- `deleteNote()` 级联删除本地素材文件 + DB 清理。

### API 签名与直连（新增）
- 旧签名直连实验已移除；当前使用 HTTP SSR 解析与 Playwright 页面降级，不依赖签名模块。
- `XhsApiClient` 封装类支持：getNoteById / searchNotes / getComments / getUserNotes / whoami / healthCheck
- API 优先策略：单篇采集、搜索、评论均先尝试 API 直连，失败自动降级 Playwright

### 健康检测（新增）
- `GET /api/xhs/health` — 分析 creator 后端 `level` 字段，生成分发/限流/敏感词报告
- 前端账号管理页新增健康检测按钮 + 结果展示

### 病毒性分析（新增）
- `POST /api/analyze/viral` — 免 LLM，8 类钩子模式匹配 + 互动率计算 + 评论主题聚类
- 返回总分 + 各维度得分 + 改进建议

### 品质增强（新增）
- 视频同级分辨率按码率（bitrate）决胜，码率上限 9999

### 命名模板增强（新增）
- 拆分 `folderNameFormat`（文件夹级）和 `nameFormat`（文件级）独立编辑
- `collapseSeparators` 自动修复 `--` 连续分隔符问题

### 内容分析与分类管理（新增）
- 新增 `contentAnalysis.mjs` 模块，9 个分析函数（标题钩子/句式分布、主题词频、互动统计、视觉/营销目的分布、分类统计）
- 新增 `/api/stats/content-analysis` 聚合接口
- 新增内容分析看板页面：6 个 Chart.js 图表（钩子分布/句式分布/类型分布/营销目的/视觉风格/分类统计）+ 主题词云
- 新增 `library_type` 字段（选题库/脚本模板库/视觉参考库/营销话术库）
- 案例库新增分类过滤、批量分类按钮、单笔记快捷切换分类
- 表格视图新增内容分类列

### 内容报告（新增）
- 新增 `reportGenerator.mjs` 模块：生成结构化内容报告（每周简报 / 本月复盘）
- 报告含：概览统计、Top 10 笔记、作者排行、品牌/类型/目的/分类/钩子分布、环比变化
- 新增 API：`GET /api/reports/weekly-brief`、`GET /api/reports/monthly-review`
- 前端报告页面：选择类型 → 生成查看 → 导出 JSON/Markdown

### Bug 修复（新增）
- `xhsSdk.mjs` 导出 `scoreXhsNoteUrl`/`isUiAsset`/`uniqueByUrl`（原为内部函数）
- `searchXhs` 中 `page.evaluate` 闭包变体 bug（参数传递 `existingIds`）
- 删除路由中 `deleteXhsAccount`/`deleteScheduledTask` 重复调用
- `check-cookie` GET 路由错误双重读取 body
- `server.mjs` 导入 `openXhsContext` 缺失导出

## 当前测试输出摘要

### 视频链接
- 状态：`已入库`
- 类型：`视频笔记`
- 解析素材：结构化封面图 1 个，作品视频候选 1 个
- 下载结果：图片 `.webp` 与视频 `.mp4` 均可落盘；本轮复测返回"已存在"，实测文件约 15KB / 99KB / 8.9MB
- 本轮主链路复测：`assetCount=2`，`imageCount=1`，`videoCount=1`

### Live 图文链接
- 状态：`已入库`
- 类型：`Live图文`
- 解析素材：6 张结构化静态图片，6 个 `livePhoto` 动态视频
- 配对结果：6 个动态视频均带 `pairedImageIndex`，分别对应第 1-6 张静态图
- 下载结果：6 张 `.webp` 与 6 个 `livePhoto.mp4` 均可落盘；本轮实测动态视频约 192KB-542KB/个
- 本轮主链路复测：`assetCount=12`，`imageCount=6`，`livePhotoCount=6`

### 项目主页
- 可以提取主页内作品链接。
- 综合采集流程中可以滚动提取主页内作品链接，带 `xsec_token` 的链接优先保留；本轮复测 5 条主页作品均正常入库。
- 独立 CLI `--links` 本轮复测成功返回 5 条带 `xsec_token` 的主页作品链接。
- 独立 `/xhs/links` 或 CLI `--links` 若遇到小红书安全限制，工具会返回诊断：`安全限制 / IP存在风险`。
- 部分作品详情页返回"当前笔记暂时无法浏览"，已按异常状态处理。
- 建议使用最新分享链接或有效 Cookie 重新采集主页内作品。

## 已发现并处理的问题

- Playwright 自带 Chromium 缺失：已改为自动使用本机 Chrome/Edge 兜底。
- 小红书 Web 分享文本含标题、emoji、`&amp;`：已支持自动提取和反转义真实 URL。
- 静态 JS / 平台图标误入素材候选：已过滤 `fe-static`、`fe-platform`、头像、空 CDN 域名等 UI 资源。
- 平台背景视频误入候选：已过滤 `dc.xhscdn.com` 等非作品视频资源。
- 图片裸 URL 返回 403：已保留小红书图片规格参数，优先保存可访问素材。
- 重复采集导致资产表累积：已改为同一笔记资产替换并去重。
- 同名文件被占用导致写入失败：已改为存在文件跳过并标记 `已存在`。
- 命令行 `--skip` 已验证，可返回已有下载记录并避免重复采集。
- `/xhs/detail` 已验证字符串布尔参数：`download:"true"`、`skip:"false"` 可正确解析。
- 已有文件跳过已验证：重复下载时素材状态返回 `已存在`。
- 视频候选去重已验证：普通视频笔记只保留最高优先级主视频候选，减少备用地址重复下载。
- 账号主页 `--links` 已验证：可返回 5 条带 `xsec_token` 的作品链接。
- Live 图结构化解析已验证：读取 `imageList.livePhoto=true` 与 `stream.h264.masterUrl`，生成 `livePhoto` 素材。
- Live 图重复图片已处理：有结构化 `imageList` 时优先使用结构化图片，不再把 DOM/脚本中的重复预览图作为主素材。
- Live 图下载已验证：结构化去重后 6 图 + 6 动态视频全部保存成功。
- MCP 冒烟测试已验证：`initialize` 返回服务信息，`tools/list` 返回 `xhs_detail`、`xhs_links`。
- Eagle 元数据测试已验证：`livePhoto` 入库后保留 `pairedImageIndex`，导出 `eagle-metadata.json` 中生成 `livePhotoPairs`。
- 命名模板测试已验证：`{date}-{brand}-{author}-{title}-{tags}-{likes}-{comments}-{collects}-{shares}-{index}-{kind}` 可生成预期文件名。
- 三条小红书链接在新增发布时间与命名模板后复测通过。
- 通用页面链接提取已验证：CLI `--links` 输入作品链接可直接返回；输入项目主页仍可返回 5 条带 `xsec_token` 的作品链接。
- MCP `xhs_links` 已验证作品链接直返路径。
- 剪贴板离线测试已验证：模拟系统剪贴板中的小红书 Web 分享文本，CLI `--clipboard --links` 可直接返回作品链接，并保留 `xsec_token`。
- 链接合并测试已验证：同一笔记同时出现裸链和带 `xsec_token` 的分享链时，结果保留带 `xsec_token` 的版本；直接作品链接不会因主页提取失败整批丢失。
- 存储筛选测试已验证：`brand/accountId/contentType/marketingGoal/assetKind/libraryType/q` 可组合筛选案例库内容。
- 内容分类管理已验证：笔记可单条/批量设置选题库/脚本模板库/视觉参考库/营销话术库分类，表格和卡片视图均显示分类标签。
- 内容分析面板已验证：6 个图表（钩子分布、句式分布、内容类型、营销目的、视觉风格、分类统计）+ 主题词云可正常渲染。

## 待测试

### 服务端功能（需本地运行 Node.js）
- QR 扫码登录全链路（扫码 → Cookie 加密保存 → 搜索 → 采集 → 评论 → 仪表盘数据反映）。
- 定时自动采集任务执行与日志记录。
- 多账号独立会话管理（切换账号不影响其他会话）。
- Cookie 加密/解密全链路（存储 → 读取 → 解密使用）。
- 内容分析面板数据准确性验证。
- 内容分类批量操作前后端全链路。

### 异常场景
- 登录过期后自动提示重新登录。
- 链接失效 / 笔记已删除时的采集反馈。
- 素材缺失 / 下载失败时的状态标记和重试。
- 网络中断或代理失效时的降级行为。

### 跨平台兼容
- Windows 本地启动流程（.bat 和 npm start）。
- Mac 本地启动兼容性。

## 复测命令

```powershell
$env:XHS_HEADLESS='true'
C:\Users\Ayuan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --no-warnings tests/minimal-xhs-test.mjs
```

命令行模式测试：

```powershell
C:\Users\Ayuan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --no-warnings src/cli.mjs --headless --skip "小红书链接"
```

MCP 冒烟测试：

```powershell
C:\Users\Ayuan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --no-warnings tests/mcp-smoke-test.mjs
```

Eagle 元数据测试：

```powershell
C:\Users\Ayuan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --no-warnings tests/eagle-export-metadata-test.mjs
```

命名模板测试：

```powershell
C:\Users\Ayuan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --no-warnings tests/download-name-template-test.mjs
```

剪贴板读取测试：

```powershell
C:\Users\Ayuan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --no-warnings tests/clipboard-test.mjs
```

链接合并测试：

```powershell
C:\Users\Ayuan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --no-warnings tests/links-merge-test.mjs
```

案例库筛选测试：

```powershell
C:\Users\Ayuan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --no-warnings tests/storage-filter-test.mjs
```

内容分析测试：

```powershell
curl http://127.0.0.1:4173/api/stats/content-analysis?range=30
```
