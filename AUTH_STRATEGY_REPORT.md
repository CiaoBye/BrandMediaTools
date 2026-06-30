# 小红书认证与采集主路径说明

更新时间：2026-06-29
当前版本：v1.13.5

## 结论

数据采集主路径已调整为 **无 Cookie 公开页优先**：

1. 单篇作品采集默认先不带 Cookie 请求公开作品页 HTML。
2. 从 `window.__INITIAL_STATE__` 解析标题、正文、作者、互动数据、图片、视频和 Live 图地址。
3. 公开页解析失败、素材不足或内容需要授权时，才使用 Cookie/Playwright 兜底。

前端主流程已从“三通道展示”收敛为“两入口一检测”：

1. **专用浏览器绑定（推荐）**：通过项目专属 `.browser-profile/chrome-cdp` 启动/连接 Chrome，用户正常登录后保存 Cookie；后续健康巡检可非交互式复检/刷新。
2. **手动粘贴完整 Cookie（兜底）**：按浏览器开发者工具 Network 请求复制完整 Cookie，粘贴后强校验，验证通过才入库。
3. **Cookie 检测**：作为诊断入口，验证本地 Cookie 是否仍为真实登录态。

二维码登录与 SigCLI 不再作为主界面入口展示：二维码后端兼容代码暂保留，避免破坏旧链路；SigCLI 只保留评估结论，不作为本项目默认登录方案。

## 方案对比

| 方案 | 当前项目支持状态 | 稳定性 | 自动化程度 | 风险/限制 | 适用场景 |
| --- | --- | --- | --- | --- | --- |
| 旧方式：静态 Cookie 文件/DB | 已保留，但保存前强校验 | 中低 | 中 | Cookie 容易变成访客态；旧版本会误判有效 | 临时采集、已有可用 Cookie |
| Network 完整 Cookie 复制 | 已合并 | 中 | 低 | 需要人工复制；复制不完整会失败 | 自动提取失败时的兜底 |
| 内置 CDP 真实浏览器会话 | 已合并，默认推荐 | 高 | 中高 | 首次需要用户正常登录；后台只复用已登录会话，不做登录绕过 | 日常采集、定时任务 |
| SigCLI / 外部凭证代理 | 已从主界面移除，仅保留评估结论 | 取决于外部配置 | 高 | 需要安装和维护外部工具；不能降低平台对自动化行为的识别 | 多系统统一凭证托管的远期方案 |

## 采集主路径对比

| 路径 | 当前定位 | 是否默认发送 Cookie | 数据能力 | 账号风险 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 公开页 HTML + `window.__INITIAL_STATE__` | 主路径 | 否 | 可拿到单篇作品元数据、图片、视频、Live 图资源 | 低 | 作为默认方式 |
| Cookie HTML 兜底 | 辅助路径 | 是 | 公开页不足时补齐授权可见内容 | 中 | 只在必要时使用 |
| Playwright 页面兜底 | 辅助路径 | 视配置而定 | 补 DOM、网络响应和异步渲染内容 | 中高 | 失败兜底，不做主路径 |
| 用户主页签名请求 | 不接入 | 是 | 可批量列表，但更敏感 | 高 | 不复制、不实现 |

## v1.13.5 调整点

- `src/crawler/extract.mjs`：`fetchNoteViaHttp()` 改为公开页无 Cookie 优先；本地有 Cookie 时也不先发送。
- `src/crawler/flow.mjs`：采集日志改为“公开页 HTML”，明确 XHS-Downloader 式公开页解析为主路径。
- `tests/core-regression-test.mjs`：新增公开页优先回归测试，确保有 Cookie 时仍优先走 public acquisitionMode。

## v1.13.4 调整点

- `public/index.html`：账号管理页只显示专用浏览器绑定、手动完整 Cookie 和检测 Cookie；手动 Cookie 教程内嵌到兜底入口。
- `public/app.js`：手动 Cookie 按钮同时展开输入框和教程；浏览器绑定按钮文案统一为「打开专用浏览器绑定」；设置页不再展示 SigCLI 配置。
- `src/server.mjs` / `src/server-utils.mjs`：Cookie 缺失/失效提示从“扫码登录”改为“专用浏览器绑定或手动完整 Cookie”。
- `src/crawler/extract.mjs`：公开页降级重试日志改为合规表述。

## v1.13.3 合并点

- `src/server.mjs`：手动 Cookie 与账号 Cookie 入库前执行真实登录态校验；浏览器提取成功后同步写入文件和 DB。
- `src/scheduler.mjs`：两小时健康巡检时，如果单账号 Cookie 失效且专用 CDP 浏览器已有登录态，会非交互式刷新 DB Cookie；未登录则保持原自动挂起保护。
- `src/crawler/auth.mjs`：支持交互式与非交互式两种浏览器会话提取模式。
- `src/settings.mjs`：新增 `autoRefreshCookie`、`cookieRefreshWaitMs`、`authProvider`、`sigCliCommand` 配置。

## XHS-Downloader 实现研究摘要

- **单篇作品详情**：核心链路是 HTTP 请求作品页 HTML，提取 `window.__INITIAL_STATE__`，再取 `note.noteDetailMap` 或移动端 `noteData.data.noteData` 中的结构化笔记数据。
- **字段抽取**：作品 ID、标题、正文、标签、互动数、发布时间、作者信息等均从页面状态对象读取。
- **图片/Live 图**：从 `imageList` 读取 `urlDefault` 或 `url`，生成图片 CDN 地址；Live 图从 `imageList[].stream.h264[0].masterUrl` 获取动态视频地址。
- **视频**：优先使用 `video.consumer.originVideoKey` 生成视频 CDN 地址；否则读取 `video.media.stream.h264/h265`，按分辨率、码率或大小选择 `masterUrl` / `backupUrls`。
- **下载层**：支持下载记录去重、作者归档、文件名规则、Range 续传、重试和分块下载。这些能力与本项目现有下载器方向一致，可作为安全增强参考。
- **不建议接入部分**：用户主页列表模块使用签名请求获取数据，风险明显高于公开页 HTML/页面状态解析；本项目不复制、不依赖该模块。

## 参考依据

- XHS-Downloader 最新 README 标注“从浏览器读取 Cookie”已失效，并建议手动获取 Cookie；因此本项目不再依赖直接读取 Chrome Cookie 数据库。
- SigCLI 的设计重点是通过真实浏览器登录、加密保存凭证并在运行时注入；本项目已按同类思路保留外部凭证代理兼容位。
- Chrome App-Bound Encryption 会让新版 Chrome 的本地 Cookie 直接解密越来越不可行，因此真实浏览器会话与 Network 完整 Cookie 是更现实的路线。
