# 专用浏览器绑定 & 手动粘贴 Cookie 修复记录

> 日期: 2026-06-29
> 版本: v1.13.7
> 涉及文件: 4 个（xhsAuth.mjs / auth.mjs / server.mjs / app.js）

---

## 问题现象

1. **专用浏览器绑定** — 点击「打开专用浏览器绑定」后无反应，或长时间无反馈后超时
2. **手动粘贴 Cookie** — 粘贴完整 Cookie 后点击保存，提示无效或静默失败

---

## 根因分析

### 专用浏览器绑定（`saveXhsCookieFromBrowser`）

| 问题 | 根因 | 修复 |
|------|------|------|
| 浏览器窗口不可见 | `getGlobalContext()` 返回了服务端启动时创建的 headless 全局上下文，导致登录页打开在无头浏览器中，用户看不到窗口 | `|| interactive` 强制交互模式创建可见浏览器 |
| API 端点卡死 | `chromium.launch()` 在浏览器不可用时挂起，导致 HTTP 请求无响应 | `withTimeout` 包装，20 秒超时报错 |
| 登录态误判 | `pageAuthState()` 中 `isGuest` 检查过严，SSR 中 `guest:true` 预渲染值导致有效登录被拒绝 | 改为 `guestFlags >= 2 && !hasIdentity` 放松判断 |
| 页面意外关闭 | 用户关闭浏览器窗口后，while 循环继续等待 120 秒无反馈 | 增加 `page.evaluate(() => 1)` 页面存活检测，崩溃后重建标签页 |

### 手动粘贴 Cookie（`checkCookieValid`）

| 问题 | 根因 | 修复 |
|------|------|------|
| SSR 解析失败 | `parseInitStateForAuth` 未处理新版 SSR 中的 `\u002F` 等 Unicode 转义序列 | 对齐 SDK 版 `parseInitState`，增加 Unicode 转义处理 + 二次清理 |
| 登录态误判 | `inspectCookieStateFromHtml` 中单个 `guest:true` 标志即判定为访客态 | 改为需要 2+ guest 标志且无用户身份才判定 |
| Cookie 更新丢失 | `Set-Cookie` 仅提取第一个表头（`headers.get("set-cookie")`），错过了 `a1` 刷新 | 改用 `headers.forEach` 收集所有 Set-Cookie 表头 |
| 异常静默 | catch 块空执行 `catch {}`，前端收到空错误 | 增加 `console.warn` 日志输出 |

### 前端（已验证正确）

`$` 函数在 `app.js:40` 定义为 `document.querySelector(id)`，因此 `$("#savePastedCookie")` 通过 CSS 选择器 `#savePastedCookie` 正确匹配 `<button id="savePastedCookie">`。点击事件监听器已在 `app.js:1370` 正确绑定。

---

## 修改文件总览

### `src/xhsAuth.mjs` — 4 项改动

**parseInitStateForAuth**（`xhsAuth.mjs:136-154`）
- 增加 `\u002F` / `\u0026` / `\u003C` / `\u003E` / `\u003D` Unicode 转义序列处理
- 增加二次清理：尾部逗号去除、空值替换、hex 转义解码
- 与 SDK 版 `parseInitState` 保持一致，对齐容错能力

**inspectCookieStateFromHtml**（`xhsAuth.mjs:175-189`）
- `guestFlags = [userInfo.guest, pageData.guest, auth.guest].filter(v => v === true).length`
- `hasIdentity = Boolean(userId || nickname 或基础用户字段)`
- `isGuest = guestFlags >= 2 && !hasIdentity`（不再因为 SSR 预渲染默认值误判）

**checkCookieValid**（`xhsAuth.mjs:227`）
- `headers.forEach((val, key) => { if (key.toLowerCase() === "set-cookie") setCookies.push(val); })`
- 替代旧的 `resp.headers.get("set-cookie") ? [resp.headers.get("set-cookie")] : []`

**checkCookieValid catch**（`xhsAuth.mjs:253-256`）
- 增加 `console.warn("[checkCookieValid] 检测异常:", e.message)`

### `src/crawler/auth.mjs` — 4 项改动

**saveXhsCookieFromBrowser**（`auth.mjs:32-33`）
- `getGlobalContext()` 分支增加 `|| interactive`，交互模式强制创建可见浏览器
- `launchCdpChrome` 调用包装 `withTimeout(..., 15000)`，CDP 连接超时 15 秒
- `createBrowser` 调用包装 `withTimeout(..., 20000)`，浏览器创建超时 20 秒
- 增加 `withTimeout` 辅助函数：`Promise.race` + `clearTimeout`

**pageAuthState**（`auth.mjs:84-90`）
- `guestFlags` / `hasIdentity` 放松逻辑，与 xhsAuth.mjs 对齐

**while 循环**（`auth.mjs:108-125`）
- 每次轮询前增加 `page.evaluate(() => 1)` 检测页面存活
- 页面不可访问时尝试 `ctx.newPage()` 重建标签页
- 剩余时间不足 10 秒时跳过重建，让 deadline 正常触发

### `src/server.mjs` — 1 项改动

**from-browser 后处理**（`server.mjs:783-785`）
- `catch {}` → `catch (postErr) { console.warn("[from-browser] 保存加密账号失败:", postErr.message) }`

### `public/app.js` — 已验证

- `$` 函数定义（第 40 行）：`function $(id) { return document.querySelector(id); }` ✓
- `savePastedCookie` 事件监听器（第 1370 行）：`$("#savePastedCookie")?.addEventListener("click", async () => { ... })` ✓
- `extractCookieBtn` 事件监听器（第 1351 行）：调用 `/api/settings/xhs-cookie/from-browser` ✓
- 手动粘贴保存逻辑（第 1373 行）：同时调用 `/api/xhs-accounts` 和 `/api/settings/xhs-cookie` ✓

---

## 验证结果

| 测试项 | 预期 | 结果 |
|--------|------|------|
| 手动粘贴无效 Cookie | HTTP 400 + 错误原因 | ✅ |
| 专用浏览器（无可运行浏览器） | 2 秒返回错误，不卡死 | ✅ |
| 所有修改文件语法检查 | 全部通过 | ✅ |
| 服务启动 | 健康检查通过 | ✅ |

---

## 注意事项

- 修复专注于服务端 Cookie 验证和浏览器创建流程，不涉及前端 UI 改动
- `saveXhsCookieFromBrowser` 的 `withTimeout` 超时时间（20 秒）是保守值，可根据实际环境调整
- 如果 `chromium.launch()` 频繁超时，说明缺少浏览器依赖，需运行 `npx playwright install chromium`
- CDP 模式（设置中的「专用浏览器会话」）不受本次修复影响，仍按原有逻辑通过 `launchCdpChrome` 连接
