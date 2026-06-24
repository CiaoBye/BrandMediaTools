# 审计报告逐项验证结果（2026-06-23）

## 验证方法
- 逐行阅读当前源码
- 对比 AUDIT_REPORT.md 中每一条声明
- 标注：✅ 确认存在 / ❌ 不属实 / ⚠️ 部分属实

---

## 一、审计报告声称的致命缺陷

### 1. `app.js:1007` 语法错误
- **审计声称**: 此行是截断代码残留，前端白屏
- **实际检查**: `$("#statAnalysis").textContent = stats.overview.totalAnalysis;`
- **结论**: ❌ **不属实**。此行是合法的 JavaScript 语句，不存在语法错误

### 2. `index.html` DOM 结构破损

#### 2a. `#qrOverlay` 缺 `</div>`
- **审计声称**: 行 377 的 `</div>` 缺失，`#notifPanel` 和 `#settingsOverlay` 被嵌套在 QR 弹窗内
- **实际检查**: ✅ **确认**。`#qrOverlay` 在行 377 打开，**没有对应的 `</div>` 关闭标签**。文件末尾深度为 1（不平衡）。浏览器会在 `</body>` 自动闭合，所以实际影响较小（`#notifPanel` 和 `#settingsOverlay` 作为 DOM 子节点但各自控制显示）

#### 2b. `#page-xhs-accounts` 提前关闭
- **审计声称**: `</div>` 在行 305 提前关闭，定时任务/任务日志/健康检测等功能脱离该页面
- **实际检查**: ⚠️ **部分属实**。行 305 的 `</div>` 关闭了绑卡卡片的外层 div，但页面 div (行 270) 在行 305 并未关闭。定时任务等卡片（行 306+）虽然有缩进问题，但仍在 page 的 DOM 范围内。只是 HTML 缩进不规范，不影响功能

#### 2c. `#notesTable` 缺 `<table>`/`<thead>`/`<tr>`
- **审计声称**: `<th>` 直接出现在 `<div>` 内
- **实际检查**: ❌ **不属实**。当前代码（行 156-168）已有正确的 `<table><thead><tr>` 嵌套结构

#### 2d. `#page-logs` 脱离 `.main` 容器
- **审计声称**: 日志页面在 `.main` 外面
- **实际检查**: ❌ **不属实**。行 358 的 `#page-logs` 在行 34 的 `.main` 之内（`.main` 关闭于行 374）

### 3. `server.mjs:59` 路由处理器缺 `res` 参数

- **审计声称**: `() => { logger.clear(); sendJson(res, 200, { ok: true }); }` 中 `res` 不存在
- **实际检查**: ✅ **确认**。箭头函数 `() => {}` 不声明参数，`res` 在其闭包作用域中未定义。调用 `handleApi` 时 `handler(req, res, url)` 传入参数但函数未接收。**触发时抛 ReferenceError**，被外层 catch 捕获后返回 500（不会崩溃进程但接口不可用）
- **同样问题也在行 64**：`route("POST", "/api/notifications/read-all", () => { ... sendJson(res, ...); })`

---

## 二、严重缺陷

### 4. `xhsSigning.mjs` 文件缺失
- **审计声称**: AGENTS.md 声明此文件为关键文件，但实际不存在
- **实际检查**: ✅ **确认**。文件不存在
- 但需注意：此文件仅在原 v1 API 时使用，现所有 v1 API 已封禁，`whoami()` 降级为纯 HTTP Cookie 校验。缺失不影响当前功能

### 5. SQL 注入风险
- **审计声称**: `stats-store.mjs:11` 直接拼接字符串
- **实际检查**: ✅ **确认**。`return \`collected_at >= '${d.toISOString()}'\``，参数未经参数化
- **但风险极低**：`range` 仅接受 `"7"/"30"/"90"`，且 `toISOString()` 输出格式固定，实际不可注入

### 6. Cookie 加密密钥极弱
- **审计声称**: `USERNAME + APP_SECRET(硬编码)` 为密钥来源
- **实际检查**: ✅ **确认**。密钥派生仅用 `process.env.USERNAME + "brand-content-intel-xhs-2025"`，同一 Windows 用户名 = 相同密钥

### 7. Alpine.js 集成断裂
- **审计声称**: `el.__x.$data.toast` 为非公开 API hack
- **实际检查**: ✅ **确认**。行 1815 直接访问 `el.__x.$data.toast`，属于 Alpine.js 内部状态，版本升级可能断裂

---

## 三、功能实现评估 - 关键问题

### 8. `crawlNoteViaOpenCLI` 引用未定义变量
- **审计声称**: 行 625-626 使用 `input?.accountId` 但函数参数是 `(url, options)`
- **实际检查**: ✅ **确认**。行 625：`accountId: input?.accountId || null, brand: input?.brand || ""`，`input` 未定义，返回 `null`。**虽不会崩溃（optional chaining 保护），但 accountId 和 brand 始终为 null**

---

## 四、其他重要声明验证

### 代码质量
| 审计声明 | 结论 | 说明 |
|---|---|---|
| 空 `catch {}` 吞错误 ~40+ 处 | ✅ 确认 | grep `catch {}` 可找到大量空 catch |
| `safeName()` 重复定义 3 次 | ✅ 确认 | downloader.mjs, eagleExporter.mjs, note-store.mjs |
| `num()` 重复定义 2 次 | ✅ 确认 | viralAnalysis.mjs, reportGenerator.mjs |
| `sleep()` 重复定义 3 次 | ⚠️ | xhsSdk 导出 sleep，其他文件重复定义 |
| `硬编码 User-Agent 多处不一致` | ✅ 确认 | Chrome/124 vs Chrome/134 vs Chrome/120 |
| `无 ESLint/Prettier` | ✅ 确认 | 全局无配置 |
| `无测试框架` | ✅ 确认 | 8 个手动脚本 |

### 文档一致性
| AGENTS.md 声明 | 实际 | 结论 |
|---|---|---|
| src/xhsSigning.mjs 为关键文件 | 不存在 | ❌ 文档错误 |
| Express Web 服务器 | 实际用 node:http | ⚠️ 风格描述不准确 |
| 9 张表 | 13 张 CREATE TABLE | ⚠️ 文档滞后 |
| xhsHealth.mjs 已不参与路由 | /api/xhs/health 仍调用 | ❌ 文档错误 |

---

## 五、修正后评分（基于当前代码）

| 维度 | 评分 | 变化 |
|---|---|---|
| 功能完整性 | **7/10** | 核心采集链路可用，无阻塞前端的致命缺陷（app.js:1007 原声称有误） |
| 代码质量 | **5/10** | 无类型、空 catch 过多、重复代码、crawlNoteViaOpenCLI 有未定义变量 |
| UI/UX | **6/10** | notesTable 已修、page-logs 位置正确；但 qrOverlay 缺 `</div>` |
| 安全性 | **4/10** | 弱加密、无认证、SQL 拼接（风险低） |
| 可维护性 | **4/10** | 单文件过大、多种代码重复 |
| 测试覆盖 | **3/10** | 无自动化框架 |
| 文档准确性 | **5/10** | 多处不符 |

---

## 六、审计报告自身问题

审计报告中的 **3 个致命缺陷有 2 个是错误的**（app.js:1007 语法错误、notesTable 缺标签、page-logs 脱离 main），对项目真实状况有误导。**建议在参考审计报告时以实际代码为准**。

真实存在的 **P0 级问题** 实际上只有：
1. `server.mjs:59,64` 缺少 `res` 参数 → DELETE /api/logs 和 POST /api/notifications/read-all 不可用
2. `qrOverlay` 缺 `</div>` → 浏览器自动容错，影响较小
3. `crawlNoteViaOpenCLI` 引用了未定义变量 `input` → 字段始终为 null
