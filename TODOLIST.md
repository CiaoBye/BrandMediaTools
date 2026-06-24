# 品牌内容情报与素材抓取工具 TODOLIST

## MVP：小红书采集与内容入库
- [x] 建立本地网页工具项目骨架。
- [x] 建立 SQLite 数据结构：账号、笔记、素材、AI 分析、采集任务、监测源。
- [x] 建立小红书采集器：支持笔记链接与账号页链接的基础解析。
- [x] 支持解析小红书 Web 端复制出来的整段分享文本。
- [x] 支持本机 Chrome/Edge 作为 Playwright 浏览器兜底。
- [x] 支持通过环境变量或 `data/xhs-cookie.txt` 注入小红书 Cookie。
- [x] 支持从本机浏览器登录态保存小红书 Cookie。
- [x] 支持 `/xhs/detail` API，兼容 `url/download/index/cookie/proxy/skip` 参数形态。
- [x] 支持本地 MCP 模式，暴露 `xhs_detail` 与 `xhs_links` 工具。
- [x] 支持命令行模式：链接采集、下载、序号筛选、Cookie、代理、跳过记录。
- [x] 支持命令行读取剪贴板与监听剪贴板，方便直接处理小红书分享文本。
- [x] 支持 `data/settings.json` 配置文件。
- [x] 支持下载 `.part` 临时文件、Range 续传尝试、失败重试、下载间隔和超时配置。
- [x] 支持 `/xhs/links` 和 CLI `--links` 提取账号主页及通用页面作品链接。
- [x] 支持作品链接与主页链接混合输入时保留直接作品链接，并优先保留带 `xsec_token` 的有效分享链。
- [x] 支持多链接自动提取和 `xhslink.com` 链接识别。
- [x] 支持 Live 图文基础识别。
- [x] 支持结构化 Live 图解析：读取 `imageList.livePhoto`，并保存每张图对应的动态视频。
- [x] 支持下载记录去重和已存在文件跳过。
- [x] 支持普通视频候选去重，优先保留最高优先级主视频地址。
- [x] 建立三条用户测试链接的最小功能测试脚本。
- [x] 建立素材保存流程：图片、视频、封面、元数据 JSON。
- [x] 建立采集任务状态：等待、运行中、成功、失败、需人工复核。
- [x] 建立本地网页界面：账号录入、链接采集、笔记检索、AI 分析、Eagle 导出。
- [x] 内容案例库支持按品牌、账号、内容类型、营销目的、素材类型筛选。
- [x] 建立 AI 拆解接口：支持 OpenAI / 兼容 OpenAI API 的模型，未配置时提供规则化占位分析。

## 增强版：采集稳定性与素材质量
- [x] 支持批量粘贴多个小红书链接。
- [x] 支持下载记录去重，避免重复保存同一作品。
- [x] 支持文件完整性校验和失败重试。
- [x] 支持用户配置 Cookie、代理、单次最大采集数量。
- [x] 支持下载间隔和重试次数配置。
- [x] 支持 LivePhoto / 动图素材基础识别。
- [x] 进一步解析小红书明确 livePhoto 字段，区分每张图对应的视频侧资源。
- [x] 支持基础素材命名模板：素材序号、类型、笔记 ID、标题、作者。
- [x] 扩展素材命名模板：发布时间、互动数据、标签。
- [x] 支持账号页滚动加载，批量提取更多笔记链接。
- [x] 支持推荐页、搜索页、收藏/点赞/专辑页的通用作品链接提取机制。
- [x] 支持剪贴板分享文本离线测试，验证 `--clipboard --links` 不打开浏览器也能直返作品链接。

## 二阶段：搜索、评论、矩阵、调度、仪表盘
- [x] AI 模型预设 11 家厂商（OpenAI / Anthropic / Google / DeepSeek / Moonshot / Qwen 等）。
- [x] 图片最优品质：按宽高积降序 + 无水印优先 + `x-oss-process` 参数清洗。
- [x] 视频最优品质：水印惩罚分 `-100000` + 最高分辨率优先，同级按码率决胜。
- [x] 命名模板 chip 可视化编辑 + 拆分文件夹/文件两级模板 + collapseSeparators 自动修复。
- [x] 设置标签页重构为竖排 4 标签页（AI/采集/下载/作者别名，Cookie 已移除）。
- [x] 图片下载格式转换（AUTO/JPEG/PNG/WEBP）和品质配置。
- [x] 视频分辨率过滤（`videoMinHeight` 配置项）。
- [x] 笔记删除联动清除本地文件 + DB 清理（级联删除）。
- [x] QR 码扫码登录（多账号独立会话），3 级 QR 降级提取。
- [x] Cookie AES-256-GCM 加密存储。
- [x] 签名算法 XYS_（主 API）+ XYW_（创作者 API）移植 — `xhsSigning.mjs`
- [x] API 直连客户端 — XhsApiClient（getNoteById/searchNotes/getComments 等）
- [x] **API-first + Playwright 降级**：crawlXhs / searchXhs / collectComments 均先走 API 直连
- [x] 健康检测 creator 后端 level 字段分析 — `xhsHealth.mjs`
- [x] 病毒性分析免 LLM 8 类钩子 + 互动率 — `xhsViralAnalysis.mjs`
- [x] 仪表盘 Chart.js CDN 渲染 5 图表（采集趋势、类型分布、品牌分布、素材类型、状态分布）。
- [x] 账号矩阵 CRUD + 前端绑定/检测/删除面板。
- [x] 定时自动采集（60 秒轮询，`crawl`/`search` 类型）+ 任务执行日志。
- [x] 设置 Cookie 标签移除，Cookie 管理全部移至账号页面。

## 内容分析与运营沉淀
- [x] 高频主题、标题句式、开头钩子统计（内容分析面板：钩子分布/句式分布/主题词云/互动统计）
- [x] 品牌选题库、脚本模板库、视觉参考库、营销话术库（notes.library_type 字段 + 前后端分类 CRUD）
- [x] **每周竞品案例简报 / 每月内容复盘**（reportGenerator.mjs：自动生成结构化报告，含 Top10/品牌/钩子/环比分析，支持 JSON/Markdown 导出）
- [ ] 建立每月内容复盘。
- [x] 支持按营销目的筛选：品牌曝光、专业信任、产品种草、活动转化、用户案例。

## Eagle / OpenClaw / Hermes 预留
- [x] 建立 Eagle 导出目录与 sidecar JSON 元数据。
- [x] Eagle sidecar 保留素材详细元数据与 Live 图配对关系。
- [x] 建立监测平台接口定义文件。
- [ ] 对接 Eagle 的实际导入流程或自动同步目录。
- [ ] 明确 OpenClaw / Hermes 的接口、账号、鉴权和监测指标。
- [ ] 实现持续监测任务：账号更新检测、关键词监测、内容增量入库。

## 测试与交付
- [x] 使用图文笔记、视频笔记、账号主页三类链接测试。
- [x] 验证素材文件可落盘、视频可下载、元数据完整。
- [x] 验证 MCP 服务 `initialize` 与 `tools/list` 冒烟测试。
- [x] 验证 Eagle 导出保留 `livePhotoPairs`。
- [x] 验证素材命名模板支持发布时间、标签和互动数据。
- [x] 验证剪贴板读取入口可以解析小红书 Web 分享文本。
- [x] 验证链接合并去重逻辑：同一笔记的裸链不会覆盖带 `xsec_token` 的分享链。
- [x] 验证案例库筛选：品牌、账号、内容类型、营销目的、素材类型。
- [ ] 验证登录过期、链接失效、素材缺失、下载失败等异常场景。
- [ ] 验证 Windows 本地启动流程。
- [ ] 验证 Mac 本地启动兼容性。
- [ ] 验证 QR 扫码全链路（扫码 → 搜索 → 采集 → 评论 → 仪表盘）。
- [ ] 验证定时自动采集任务执行。
- [ ] 多账号 Cookie 加密/解密全链路验证。

## 已知问题
- [x] `xhsSdk.mjs` 导出 `scoreXhsNoteUrl`/`isUiAsset`/`uniqueByUrl`（原为内部函数，已修复）
- [x] `searchXhs` 中 `page.evaluate` 闭包变体 bug（参数传递 `existingIds`，已修复）
- [x] 删除路由中 `deleteXhsAccount`/`deleteScheduledTask` 重复调用（已修复）
- [x] `check-cookie` GET 路由错误双重读取 body（已修复）
- [x] `server.mjs` 导入 `openXhsContext` 缺失导出（已修复）
