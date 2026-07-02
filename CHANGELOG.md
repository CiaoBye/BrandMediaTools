# 更新日志
## v1.14.9 (2026-07-02)
- **案例库入库状态展示下沉**: 移除案例卡片和详情弹窗中的红色“已入库/应有/缺失”状态块，避免业务内容阅读区被工程状态打断。
- **数据大盘只展示待补素材**: `/api/stats` 仅返回经后端 `assetIntegrity` 确认的 `assetPartialNotes`，前端只展示“待补素材”指标卡。
- **历史数据解释优化**: 没有 `assetIntegrity` 的旧笔记不计入“待补素材”，不再在详情里显示误导性的 `应有 0 / 已落盘 0 / 缺失 0`。
- **统计布局自适应**: 数据大盘统计卡片改为自适应列宽，减少宽屏右侧空白和卡片拥挤。
- **回归测试补齐**: 服务集成测试断言 `/api/stats` 固定返回素材完整性字段。
---

## v1.14.8 (2026-07-02)
- **账号抓取 HTTP 并发加速**: `followAccount()` 的账号作品详情快速路径改为有限并发，默认并发 4、代码上限 8，减少逐条串行公开页解析耗时。
- **降级链路减重复请求**: 已在 HTTP 快速路径确认失败的笔记，进入 Playwright 降级时不再立刻重复 HTTP 请求，减少无效等待。
- **无新增时跳过浏览器空跑**: 账号 HTTP 列表发现本轮没有新增/待修复笔记时直接返回，不再启动浏览器加载主页。
- **设置项补充**: 采集设置新增 `账号详情 HTTP 并发数`，便于根据网络和账号状态调节速度与稳健性。
- **审计测试补齐**: 采集链路审计新增 HTTP 有限并发断言，`crawl-chain-audit-test` 升级为 11/11。
---

## v1.14.7 (2026-07-01)
- **Cron 定时支持**: 定时任务新增 5 段 Cron 表达式，按北京时间计算下一次运行；未配置 Cron 时继续使用原有分钟间隔。
- **设置页默认 Cron**: 采集设置新增“定时任务默认 Cron”，账号跟随和新建定时任务会优先使用该默认值；默认值为空时账号跟随仍为 1440 分钟。
- **任务表单覆盖 Cron**: 新建定时任务表单新增 Cron 输入框，可对单个任务覆盖默认 Cron。
- **校验与展示**: 服务端保存设置和创建任务时校验 Cron 格式；任务列表展示 Cron/间隔、下次运行和上次运行时间。
- **回归测试补齐**: 调度回归新增 Cron 解析、北京时间 nextRun 和 Cron 任务推进断言。
---

## v1.14.6 (2026-07-01)
- **真实入库状态**: 新增统一 `assetIntegrity` 计算，后端记录每条笔记应有素材数、实际落盘数和缺失数；只有全部应有素材落盘才标记为“完整入库”。
- **历史详情复核**: 没有 `assetIntegrity` 的历史图文/Live 笔记会进入详情复核，不再依赖前端或旧 `imageCount` 猜测是否完整。
- **统一保存入口**: 单条采集、手动账号抓取、定时采集、定时 follow、CLI 和 MCP 都统一写入 `expected/saved/missing/assetIntegrity`。
- **前端状态展示**: 案例卡片和详情弹窗展示后端计算出的“部分入库/素材待下载/缺失数量”，前端只展示结果，不参与判断。
- **回归测试补齐**: 核心回归覆盖部分入库、完整入库、历史无完整性元数据进入复核；`npm test` 全量通过。
---

## v1.14.5 (2026-07-01)
- **账号抓取历史缺图修复**: 手动账号抓取和定时 follow 会扫描已入库图文/Live 笔记中的疑似缺图项（0-1 张图、失败素材、HTML fallback），生成 `repairNoteIds` 修复名单。
- **已知笔记不再阻断修复**: `followAccount()` 对 `repairNoteIds` 中的已知笔记不再按 `knownNoteIds` 跳过，会重新进入详情提取和素材保存流程；日志会显示 `repairNoteIds` 数量。
- **修复范围保护**: 新增 `xhs.maxRepairExistingNotes`，默认每轮最多修复 80 条旧疑似缺图笔记，避免一次性重扫全部历史内容。
- **回归测试补齐**: `follow-account-dedup-test` 新增“已知但待修复的笔记会重新采集”场景；`npm test` 全量通过。
---

## v1.14.4 (2026-07-01)
- **单条笔记图片完整性修复**: 单条 HTTP 快速路径兼容 `image_list` / `images` / `imgs` 等图片字段，以及 `url_default`、`url_pre`、`info_list` 等蛇形资源字段，避免只识别 camelCase `imageList` 导致缺图。
- **历史缺图单条重采修复**: `/api/crawl` 的 skip 判断改为“已存在且素材完整才跳过”；已入库但缺图的单条笔记再次采集时会重新解析并覆盖素材。
- **详情预览远程兜底**: 前端 `fileUrl()` 在素材没有本地 `localPath` 但仍有 `sourceUrl` 时直接使用远程源预览，避免下载失败的图片在详情弹窗中消失。
- **回归测试补齐**: `core-regression-test` 新增 `image_list` 三图样本和“已入库缺图重采”断言；`npm test` 全量通过。
---

## v1.14.3 (2026-07-01)
- **测试闸门修复**: `core-regression-test` 的 Windows 临时目录清理失败降级为警告，避免 EPERM 文件锁掩盖真实业务回归；`npm test` 已重新跑通。
- **采集审计测试同步**: `crawl-chain-audit-test` 兼容 `currentUrl` 登录页判断写法，采集链路审计恢复 10/10 通过。
- **删除一致性修复**: `deleteNote()` / `batchDeleteNotes()` 先收集待删除素材路径，数据库 COMMIT 成功后再删除物理文件，修复素材表先删导致文件无法清理的问题。
- **素材完整性判断精准化**: 新增 `noteCompleteness.mjs`，手动账号抓取和定时跟随共用 `raw.imageCount` / `livePhotoCount` / `videoCount` 与实际素材分类计数判断，减少单图笔记误判和多图缺失漏判。
- **评论定时刷新**: 调度器新增 `comments_refresh` 任务类型，支持按笔记链接、品牌、作者或最近笔记刷新过期评论缓存；前端定时任务下拉新增“刷新评论”。
- **验收记录恢复**: 恢复 `TEST_REPORT.md`，并补充 v1.14.3 全量测试结果。
---

## v1.14.2 (2026-06-30)
- **案例库默认排序修复**: 案例明细默认按发布时间倒序展示，后端 `/api/notes` 默认排序也改为 `published_at` 优先、缺失时回退采集时间。
- **图文素材完整性修复**: 每张图片保留多个候选地址（原始 URL、CDN token 直链等），下载失败时自动切换备用地址，减少图文笔记图片缺失。
- **评论缓存与刷新机制**: 评论保存时记录最近抓取时间；详情页优先读取缓存，默认 6 小时过期后自动刷新；手动获取评论会强制抓取最新评论。
---

## v1.14.1 (2026-06-30)
- **运行日志业务状态增强**: 账号抓取会在运行日志中记录本轮开始、作品列表获取、详情提取进度、素材保存进度、完成和失败状态。
- **日志页自动刷新**: 打开运行日志页面且未搜索时，每 3 秒自动刷新一次，抓取过程无需手动点击“刷新”。
- **抓取任务状态兜底**: `/api/follow/crawl` 的任务 ID 提升到外层作用域，失败时也能写回任务状态。
---

## v1.14.0 (2026-06-30)
- **代码审计修复（v1.14）**: 基于 v1.13.9 审计报告修复 6 项问题。
- **extractNote DOM 等待增强**: 在 page.evaluate 之前添加 waitForSelector，提升页面渲染不全时的提取稳定性。
- **deleteNote 事务顺序修复**: 物理文件删除后置到数据库 COMMIT 之后，避免回滚导致悬挂指针。
- **Cookie 加密 Key 与路径解耦**: deriveKey 改用 data/.scope_id 稳定标识符替代绝对路径，支持目录重命名/移动后仍能解密已有 Cookie。
- **skipExistingFiles 零字节文件过滤**: 跳过已有文件时额外检查 statSync.size > 0，避免中断下载留下的 0 字节文件被永久跳过。
- **_runningTasks 超时自动清理**: 改为 Map 记录启动时间，每次轮询检查超时任务（默认 10 分钟）并自动解锁。
- **/files/ 静态路由 token 校验**: 新增可选的 x-app-token 头/查询参数校验，降低局域网暴露风险。
- **风控参数调优**: 默认并发表从 3 降至 1，滚动延迟从 1200ms 升至 2000ms，减少触发验证码概率。
---

## v1.13.9 (2026-06-30)
- **左侧功能入口重排**: 取消主内容区二级 Tab，把快捷提取、全局发现、竞品监控、账号矩阵、案例明细、库内分析、数据大盘、复盘报告和运行日志全部拆成左侧独立入口；运行日志移入底部“系统”分组。
- **工作区框架拆分**: 将一级模块重构为“工作区头部 + 独立功能切换条 + 子页面内容区”的视觉框架，品牌资产、内容捕获、监测中心和运营决策不再把二级标签挤在页面标题同一层。
- **界面视觉优化**: 按参考图重做浅色工作台观感，降低玻璃拟态和紫色占比，统一侧边栏、页内标签、采集表单、案例卡片、仪表盘卡片、图表配色和设置弹窗的视觉层级。
- **认证链路收口**: 删除旧二维码登录后端模块、服务端 `/api/auth/qr/*` 路由和前端二维码弹窗/轮询代码，登录入口只保留专用浏览器 profile 绑定与手动完整 Cookie 兜底。
- **后台刷新稳定性增强**: 专用浏览器绑定改用项目专属持久 profile，后台健康检查不再强依赖 `cdpPort` 配置；定时任务遇到 Cookie/登录态错误时会先尝试非交互刷新授权态，刷新成功则下一轮自动重试，失败才暂停。
- **Cookie 生命周期稳定性修复**: 修复 `saveXhsCookieFromBrowser()` 登录等待 `deadline` 未定义导致专用浏览器绑定失败的问题；浏览器态识别不再把 `guest_user_id` 当作真实登录；手动保存、浏览器保存和调度健康检查均会持久化 `checkCookieValid()` 返回的更新后 Cookie。
- **采集链路审计测试补齐**: 新增 `tests/crawl-chain-audit-test.mjs`，覆盖账号链接深扫、滚动策略、并发采集、successNoteIds 去重、Cookie/CDP 上下文、noteId 存储去重、定时 follow 一致性、Range 回退、弃用 API 残留和版本同步。
- **Cookie/CDP 上下文修复**: `createBrowser()` 支持调用方用 `cdpPort: 0` 明确禁用设置中的 CDP 端口，避免传入 Cookie 时误连已有浏览器上下文导致 Cookie 未注入。
- **账号与定时跟随去重修复**: `followAccount()` 不再硬置访客态为 false；手动抓取和定时 follow 均按 canonical noteId 判断已采集笔记，并在定时任务中保留旧账号名、头像和品牌字段。
- **存储去重修复**: `notes` upsert 和 skip 判断优先使用 `noteId` 合并同一笔记的不同 URL 形态，减少重复入库和重复下载。
- **下载续传修复**: `.part` 文件续传时若服务端返回 200 而非 206，立即回退为完整下载，不再消耗一次重试。
- **弃用路径删除**: 搜索链路移除旧 `xhsApiClient` API-first 分支，服务端和 Cookie 保存链路不再引用旧 API 缓存；删除 `src/xhsApiClient.mjs`、`src/signserver/` 旧签名服务和对应 scratch 验证脚本；同步 package 和 MCP 版本至 v1.13.9。
---

## v1.13.8 (2026-06-29)
- **账号抓取登录态回归修复**: `openXhsContext()` 在调用方传入已保存 Cookie 时不再复用服务启动时的全局浏览器，避免 Cookie 未注入导致账号主页作品列表为空。
- **账号抓取日志增强**: `/api/follow/crawl` 增加开始、完成、失败日志，`followAccount()` 增加候选笔记链接数量日志，便于定位“抓取 0 条”的真实原因。
- **账号抓取增量收口**: 手动账号抓取会把数据库中同作者已采笔记加入 knownNoteIds，默认只处理最近 30 条候选，避免历史账号一次重扫数百条导致前端超时。
---

## v1.13.7 (2026-06-29)
- **followAccount 重复采集修复**: HTTP 部分成功 + 部分失败后降级 Playwright 时，不再清空已成功采集的 seenNoteIds；只让失败的 note 进入降级路径（新增 successNoteIds 跟踪机制）。补充 tests/follow-account-dedup-test.mjs 覆盖 4 个场景。
- **saveXhsCookieFromBrowser deadline 修正**: 登录等待 deadline 改为在 while 循环前重新计算，排除 createBrowser + page.goto 的初始化耗时，用户实际可用登录时间恢复 waitMs 完整值。
- **downloader Range 复核确认**: 非 206 响应时 unlinkSync(tmpPath) + continue → 下次循环 partialSize=0 → 自动回退完整下载，无死循环风险。
- **addAssets 空数组复核确认**: 空数组 = no-op，不清除旧素材，语义正确。如有清除需求应考虑独立 clearAssets 函数。
---

## v1.13.6 (2026-06-29)
- **fetchNoteViaHttp 增强**: 集成 resolveShortLink 替代内联 HEAD 短链解析；新增多 URL 形态降级（/discovery/item、xsec_source=pc_note）；新增 og:image/og:video HTML meta 标签兜底素材提取；封面图作为独立 cover 资产入库；视频候选从 1 个增至 3 个；返回字段增加 ipLocation/lastUpdateTime/cover/shareInfo
- **xhsSdk.mjs**: 新增 bestImageUrls() — 返回有序图片候选列表（含 CDN token 直链）；新增 bestVideoStreams() — 返回完整编码×分辨率视频矩阵；mergeXhsLinks() 改为返回 {url, hasXsecToken, noteId} 对象增强 /xhs/links API
- **crawlWithFallback (flow.mjs)**: playwright 路径增加 og:image/og:video HTML meta 素材兜底；增加 extractXhsId 导入
- **extractAccountLinks (account.mjs)**: 增强 DOM 深度扫描（data-note-id、Vue __vue__、img data-src、section/card 链接）；滚动策略升级（渐进延时 + 随机抖动、每 50 条回到顶部、空滚动阈值 8 次自适应）
- **extractAccountNotes (account.mjs)**: 多标签页并行采集（使用 accountParallelTabs=3 信号量控制）
- **note-store.mjs**: notes 表新增 ip_location/last_update_time/cover_url 列（ALTER TABLE 迁移）；upsertNote/hydrateNoteWith 同步支持新字段
- **/xhs/links API**: 返回增加 xsecTokenResults 字段，每条链接含 url/hasXsecToken/noteId 状态
- **/xhs/detail API**: 返回增加 ipLocation/lastUpdateTime/cover/shareInfo 字段（由 fetchNoteViaHttp 底层支持）
- **server.mjs**: 增加 extractXhsId 导入；所有 /xhs/links 返回路径统一增加 xsecTokenResults
---

## v1.13.5 (2026-06-29)
- **公开页无 Cookie 主链路**：`fetchNoteViaHttp()` 改为默认先不带 Cookie 请求作品公开页 HTML，解析 `window.__INITIAL_STATE__` 获取标题、正文、作者、互动、图片、视频和 Live 图资源；只有公开页解析失败或素材不足时才尝试 Cookie 兜底。
- **XHS-Downloader 思路主线化**：采集日志从 “HTTP SSR” 调整为 “公开页 HTML”，明确当前主路径是公开作品页 HTML + 页面状态解析，而不是登录态 API 或账号 Cookie。
- **账号风险降低**：本地即使存在 Cookie，单篇作品采集也优先不发送 Cookie；新增回归测试覆盖“本地有 Cookie 但公开页可解析时必须走公开页”的场景。
- **兜底策略保留**：公开页无法解析、资源缺失或页面不可访问时，仍保留 Cookie/Playwright 兜底，保证数据获取能力优先。

## v1.13.4 (2026-06-29)
- **登录方式简化**：账号管理页主入口收敛为「打开专用浏览器绑定」「手动粘贴完整 Cookie」「检测 Cookie」三项，移除二维码登录与独立 Network 教程按钮在主界面的展示，减少重复入口和误操作。
- **设置页认证项收敛**：采集设置页不再展示 SigCLI 预留配置，保留专用浏览器会话、自动复检/刷新和后台刷新等待时间等实际可用项。
- **XHS-Downloader 实现研究**：梳理其单篇详情链路：HTTP 获取作品页 HTML、解析 `window.__INITIAL_STATE__`、提取作品信息、图片/视频/Live 图地址、下载记录和断点续传；用户主页签名请求模块仅作为风险评估参考，不纳入本项目。
- **合规文案修正**：将 HTTP 快速路径中的“不带 Cookie 重试”日志改为「公开页重试」表述，避免把公开页面降级误写成风控绕过。

## v1.13.3 (2026-06-29)
- **三通道认证体系合并**：账号管理页新增「Network 完整 Cookie 教程」，保留手动粘贴入口，并与「从 Chrome 提取 Cookie」真实浏览器会话形成互补。
- **手动 Cookie 强校验**：`/api/settings/xhs-cookie` 与 `/api/xhs-accounts` 保存前会调用登录态校验，访客态、跳登录页或缺字段 Cookie 不再入库，避免“保存成功但定时任务跑不通”。
- **浏览器会话同步数据库账号**：`/api/settings/xhs-cookie/from-browser` 成功后不只写入 `data/xhs-cookie.txt`，还会同步更新 `xhs_accounts` 加密 Cookie，修复绑定任务仍使用旧 DB Cookie 的问题。
- **两小时自动复检/刷新**：调度器健康巡检若发现单账号 Cookie 失效，会尝试以非交互方式读取专用 CDP 浏览器已有登录态并刷新 DB；如果专用浏览器未登录，不会弹窗打扰用户。
- **调度重启恢复保护**：服务重启时会自动结束残留的“运行中”任务日志，并把卡在“运行中”的定时任务恢复为等待状态，避免强制重启后界面误显示任务仍在执行。
- **SigCLI 兼容位预留**：设置页新增认证提供方与 SigCLI 命令配置项，当前不作为强制依赖，后续可在安装并确认命令输出格式后接入外部凭证代理。

## v1.13.2 (2026-06-29)
- **Cookie 登录态误判修复**：`checkCookieValid()` 不再仅凭 `web_session` 与 `/explore` HTTP 200 判定有效，而是解析页面 `__INITIAL_STATE__`，识别 Vue reactive wrapper 中的 `guest` / `loggedIn` / `userInfo`，避免把访客会话误判为可抓取登录态。
- **从浏览器提取 Cookie 全链路修复**：`/api/settings/xhs-cookie/from-browser` 默认等待时间从 8 秒调整为 120 秒，并在保存前确认浏览器中为真实登录态；若当前专用浏览器未登录，会打开登录页等待用户正常扫码/短信登录。
- **CDP 专用浏览器启动安全修复**：`launchCdpChrome()` 不再执行 `taskkill` 误杀用户已有 Chrome，只使用项目专属 `.browser-profile/chrome-cdp` 配置目录启动/连接调试浏览器，并标识是否由工具启动。
- **测试体系补充**：新增 `cookie-auth-state-test`，覆盖访客态、真实登录态和登录页 HTML 的离线识别逻辑；版本升级至 `1.13.2`。

## v1.13 (2026-06-25)
- **纯视频笔记分类识别修复**：修正 `extract.mjs` 中对纯视频类型（存在视频但 imageList 为空时）的误判，避免其被标记为 `"待复核"`，使其正常归为 `"视频笔记"`。
- **采集流程网络超时与稳定性加固**：
  - 移除了 `account.mjs` 中滚动加载提取账号链接时对 `scrollDelayMs` 的 `1200` 毫秒硬编码限制，使其能正确读取 options 与 `settings.json` 中的设置值。
  - 为 `account.mjs` 中的 HTTP Fallback profile 直连请求加装了由 `AbortController` 控制的 10 秒硬性超时机制，彻底消除网络死锁。
  - 在 `flow.mjs` 中添加了对无 `xsec_token` 分享链接的前置校验，直接跳过无效的 HTTP SSR 尝试并降级至 Playwright，优化运行效率；补充 Playwright 在启动或导航异常下的 catch 报错日志捕获，使错误不再被隐蔽。
  - 对笔记提取时哪怕被标记为 `"需人工复核"`（如缺少直接素材），只要包含标题或 ID，也将正确保存并在列表予以保留以便人工审阅。
- **防崩溃与多浏览器 CDP 交互优化**：
  - `extract.mjs` 增加了对 `noteData.video` 的类型防御检测（当为布尔值时避免 TypeError 崩溃）。
  - 在 `auth.mjs` 中对 CDP 远程调试浏览器进行了标识隔离，仅在工具自己启动浏览器时才在退出时自动执行 `browser.close()`，不干扰和误杀用户已有的系统 Chrome 窗口。
- **系统诊断接口修复**：对诊断工具中的网络请求使用 `AbortController` 代替了在部分旧 Node 运行时不支持的 `AbortSignal.timeout`，防止诊断 API 触发 HTTP 500 崩溃。
- **账号追踪重试优化**：将获取账号主页的 Vue reactive wrapper 展开及 DOM 等待加载重试时间调整为 `3次 × 3s`。

## v1.12 (2026-06-24)
- **从 Chrome 提取 Cookie 功能修复**：解决 Chrome 127+ 的 App-Bound Encryption (`v20` 级别加密无法被外部进程直接解密) 以及 Chrome 136+ 强制阻止对默认用户配置目录进行远程调试（CDP）的问题。我们改用应用专有的、持久的配置目录 `.browser-profile/chrome-cdp` 启动调试，并实现交互式 60 秒扫码/短信登录等待轮询机制。如果用户在专用调试浏览器中未登录，可在弹出窗口中完成登录，代码在检测到有效登录态 Cookie 写入后自动保存并关闭浏览器窗口，后续提取可实现秒级全自动检测。
- **安全凭证拦截与 CSP 冲突修复**：修复在严格的内容安全策略 (CSP) 限制下，因内联脚本被浏览器拦截而导致 `window.__APP_TOKEN__` 无法初始化，从而在写入或获取 Cookie 时触发 `Forbidden: 缺少有效的 App Token` 错误的问题。我们彻底移除内联脚本，改为利用轻量级 `<meta name="app-token">` 标签安全且完全兼容地传递 Token，保证全功能全链路畅通。
- **UI/UX 视觉完整重构 (新增白天明亮玻璃拟态主题与无缝切换)**：
  - **白天明亮模式 (Light Mode) 引入**：侧栏导航底部新增一键切换的主题开关，使用 `localStorage` 记忆用户喜好。明亮模式下，底色转为清爽的 Slate-100 (`#f1f5f9`)，卡片升级为半透明白色磨砂玻璃材质（`rgba(255, 255, 255, 0.45)`），高光边缘更清晰。
  - **色彩系统与背景装饰**：夜间模式下主色调升级为极具高级感的深色夜空背景（`#080b11`），新增紫/粉/蓝三色背景渐发光圆盘（`.bg-glow`）营造太空舱悬浮氛围；面板卡片与侧栏应用磨砂玻璃背景（`rgba(15, 23, 42, 0.45)`）结合 `backdrop-filter: blur(16px)` 及细致的 `rgba(255, 255, 255, 0.08)` 半透明高光描边。
  - **组件多主题适配**：对 `showConfirm` 确认弹窗进行了完全去硬编码重构，使用 `var(--surface-solid)`、`var(--line)` 等系统 CSS 变量，解决其原先在明亮模式下依然显示暗色背景与字体的色彩违和感。
  - **字体与排版**：全面引入 Google Fonts，标题采用科技感强的 `Outfit` 字体，正文采用高易读性的 `Inter` 字体。
  - **微交互与转场动画**：自定义平滑页面转场动效（`slideUpFade`：向上位移、渐显与虚化消除）；卡片悬浮支持轻微浮起（`translateY(-2px)`）和高光扩张；所有按钮使用紫粉渐变或半透明幽灵边框，按压时拥有 `scale(0.97)` 的真实按压物理缩放回弹反馈；骨架屏动画根据主题亮度动态变换明暗微光。
  - **图表 Chart.js 自适应主题**：在 `app.js` 中全局覆盖配置 Chart.js 的默认 ticks、gridline、border 及 legend label 色彩（深色使用高对比度 `#94a3b8` 和半透明白网格，浅色自动重设为深蓝灰文字与轻量浅网格），并在切换时动态自动重绘当前激活的数据图表面板，保证完美的图表可读性。

## v1.11 (2026-06-24)
- **安全性加固**：增加 `/files/` 路由路径遍历检测，自动拦截 `..` 相对路径片段；引入启动时随机 `APP_TOKEN` 并要求 API 写入端点校验 Header，防范 CSRF（集成测试中自动绕过）；`xhsAuth.mjs` 改用 `data/.app_secret` 中动态生成的强随机密钥代替硬编码弱密钥；`db.mjs` 中的 `ensureColumn` 增加表名与列名的正则白名单限制防 SQL 注入；导出 CSV 时对字段前置 `'` 符号以防范 Excel 公式注入漏洞。
- **架构健壮性与性能优化**：`deleteNote` 操作使用 SQLite 显式 `BEGIN/COMMIT` 事务包裹，确保级联删除数据一致性；`batchHydrateNotes` 的 `IN` 条件使用 `500` 长度分块（Chunking）防止 SQLite 参数限制报错；`batchUpdateTags` / `batchUpdateBrand` / `batchSetLibraryType` 改为批量 IN 语句分批更新，减少磁盘写次数；`readBody` 加入 try/catch 块防护，对非法 JSON 请求体返回 400 Bad Request；内存 Map 缓存加入 `MAX_CACHE_ENTRIES = 100` 上限与 LRU 淘汰机制；`scheduler.mjs` 调度锁从全局 `running` 互斥体改进为基于任务 ID 的 `Set<taskId>` 任务级锁，并使用 `try/finally` 块保障释锁安全；AI 大模型 API 增加 `AbortSignal.timeout(60000)` 延时保护限制；日志服务写入增加字节计数器以减少高频 statSync 调用。
- **前端表现层与交互升级**：自研轻量原生动画 Toast 反馈与 Modal Confirm 确认，全局替换所有原生的 `alert` 和 `confirm` 弹窗；批量删除按钮支持红色高亮，并使用自建 `showConfirm` 的 danger 样式；左侧导航栏中文名称优化（`账号库` -> **`竞品追踪`**，`账号` -> **`登录授权`**）；新增多链接采集时的**前端分步状态条与实时计时器**；引入 Shimmer 渐变闪烁骨架屏加载过渡效果；移动端响应式布局改进，适配 768px 以下宽度的侧栏抽屉、遮罩层及汉堡按钮；封装 `renderEmptyState` 为各板块空数据态展示统一插图。
- **UI 布局缺陷修复**：修复了自建的移动端汉堡菜单按钮 `.hamburger-btn` 和遮罩层 `.sidebar-overlay` 在桌面端（宽屏视图下）未做 `display: none` 隐藏而渲染成 flex 成员，导致桌面版主内容区被严重挤压变形的问题。

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
