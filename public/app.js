const state = { accounts: [], notes: [], stats: null, xhsAccounts: [], scheduledTasks: [], selectedIds: new Set(), viewMode: "card", followedAccounts: [], activeLibTab: "", selectMode: false, renderLimit: 30, renderStep: 30, _observer: null };
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "请求失败");
  return d;
}

function esc(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

/** 将 ISO 时间字符串转为北京时间显示 (yyyy-MM-dd HH:mm) */
function fmtBJ(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/\//g, "-"); }
  catch { return String(iso).slice(0, 16).replace("T", " "); }
}
/** 返回当前北京时间日期字符串 (yyyy-MM-dd) */
function dateBJ() {
  return new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
}

function fileUrl(asset) {
  if (typeof asset === "string") return `/files/${encodeURIComponent(asset).replaceAll("%2F", "/")}`;
  return asset && asset.id ? `/api/assets/${asset.id}/file` : "";
}

function tagColor(kind) {
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "livePhoto") return "livePhoto";
  return "";
}

// ===== Sidebar =====
$$("#sidebarNav a").forEach((a) => {
  a.addEventListener("click", () => {
    $$("#sidebarNav a").forEach((x) => x.classList.remove("active"));
    a.classList.add("active");
    $$(".page").forEach((p) => p.classList.remove("active"));
    $(`#${a.dataset.page}`).classList.add("active");
    if (a.dataset.page === "page-dashboard") renderDashboard();
    if (a.dataset.page === "page-content-analysis") renderContentAnalysis();
    if (a.dataset.page === "page-reports") renderReports();
    if (a.dataset.page === "page-xhs-accounts") { renderXhsAccounts(); renderScheduledTasks(); }
    if (a.dataset.page === "page-accounts") renderAccounts();
    if (a.dataset.page === "page-logs") renderLogs();
  });
});

$("#sidebarSettings")?.addEventListener("click", openSettings);

// ===== Accounts (merged with Follow) =====
function renderAccounts() {
  const list = $("#accountsList");
  if (!state.accounts.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">👥</div><p>还没有竞品账号，点击"添加账号"开始</p></div>';
    return;
  }
  const followed = state.followedAccounts || [];
  const followedByUserId = {};
  for (const f of followed) followedByUserId[f.user_id] = f;

  list.innerHTML = state.accounts.map((a) => {
    const userId = a.account_url ? extractUserIdFromUrl(a.account_url) : "";
    const f = userId ? followedByUserId[userId] : null;
    const totalFound = f?.noteCount || f?.total_found || 0;
    const checks = f?.checks || [];
    const miniChart = buildMiniChart(checks);
    const lastCheck = f?.last_check_at ? fmtBJ(f.last_check_at) : "—";
    const avatarHtml = f?.avatar_url ? `<img class="account-avatar-img" src="${esc(f.avatar_url)}" alt="" />` : `<span class="account-avatar-letter">${esc((a.brand || "?")[0])}</span>`;
    return `<div class="account-item">
      <div class="account-avatar">${avatarHtml}</div>
      <div class="account-info">
        <div class="account-name"><strong>${esc(a.brand)}</strong> · ${esc(a.account_name || "未命名")}</div>
        <div class="account-meta">${esc(a.industry || "未填写行业")} / ${esc(a.tone || "未填写调性")}</div>
      </div>
      <div class="account-follow-stats">
        ${f ? `<span class="tag green" title="已发现笔记总数">${totalFound} 篇</span>` : ""}
        ${f ? `<span class="tag" style="background:#dbeafe;color:#1d4ed8">上次 ${lastCheck}</span>` : ""}
        ${miniChart}
      </div>
      <div class="account-actions">
        <button class="ghost sm" data-account-edit="${esc(a.id)}">编辑</button>
        ${userId ? `
          <button class="ghost sm" data-follow-crawl="${esc(userId)}" data-follow-brand="${esc(a.brand || "")}">抓取</button>
          <button class="ghost sm" data-account-follow="${esc(a.id)}" data-follow-user="${esc(userId)}">${f ? "✅ 跟随中" : "跟随"}</button>
        ` : ""}
        <button class="ghost sm" style="color:var(--red)" data-account-delete="${esc(a.id)}">删除</button>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll(".account-avatar-img").forEach((img) => {
    img.addEventListener("error", () => { img.hidden = true; }, { once: true });
  });
  bindAccountEvents();
}

function bindAccountEvents() {
  // Follow toggle
  document.querySelectorAll("[data-account-follow]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.accountFollow;
      btn.disabled = true;
      try {
        if (btn.textContent.includes("跟随中")) {
          await api(`/api/accounts/${id}/follow`, { method: "DELETE" });
        } else {
          await api(`/api/accounts/${id}/follow`, { method: "POST" });
        }
        await refresh();
      } catch (e) { alert("操作失败：" + e.message); btn.disabled = false; }
    });
  });
  // Instant crawl
  document.querySelectorAll("[data-follow-crawl]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "抓取中…（如弹出验证码请手动滑动）";
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 180000);
      try {
        const r = await api("/api/follow/crawl", { method: "POST", signal: ac.signal, body: JSON.stringify({ userId: btn.dataset.followCrawl, brand: btn.dataset.followBrand }) });
        clearTimeout(timeout);
        btn.textContent = `✅ ${r.newNotes} 篇新`;
        if (r.avatarUrl) {
          const idx = state.followedAccounts.findIndex(f => f.user_id === btn.dataset.followCrawl);
          if (idx >= 0) state.followedAccounts[idx].avatar_url = r.avatarUrl;
        }
      } catch (e) {
        clearTimeout(timeout);
        const msg = e.message || "";
        btn.textContent = `❌ ${msg.includes("abort") ? "超时（3分钟）" : msg.includes("风控") || msg.includes("验证码") ? "风控，请稍后重试" : msg.includes("登录") || msg.includes("Cookie") ? msg.slice(0, 50) + "…" : "失败"}`;
        btn.title = msg;
      }
      setTimeout(() => { btn.textContent = "抓取"; btn.disabled = false; refresh(); }, 4000);
    });
  });
  // Edit account
  document.querySelectorAll("[data-account-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.accountEdit;
      const account = state.accounts.find((a) => a.id === id);
      if (!account) return;
      showEditAccountModal(account);
    });
  });
  // Delete account
  document.querySelectorAll("[data-account-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.accountDelete;
      if (!confirm("确认删除此账号？关联笔记不会删除。")) return;
      btn.disabled = true;
      try {
        await api(`/api/accounts/${id}`, { method: "DELETE" });
        await refresh();
      } catch (e) { alert("删除失败：" + e.message); btn.disabled = false; }
    });
  });
}

function showEditAccountModal(account) {
  const existing = document.getElementById("editAccountOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "editAccountOverlay";
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="overlay-panel" style="max-width:480px">
    <div class="overlay-head"><h2>编辑账号</h2><button class="btn-icon close-edit-account">✕</button></div>
    <div style="padding:12px 0">
      <div class="form-row"><input id="editBrand" value="${esc(account.brand || "")}" placeholder="品牌名称" /></div>
      <div class="form-row" style="margin-top:6px"><input id="editName" value="${esc(account.account_name || "")}" placeholder="账号名称" /></div>
      <div class="form-group" style="margin-top:6px"><input id="editUrl" value="${esc(account.account_url || "")}" placeholder="小红书主页链接" /></div>
      <div class="form-row three" style="margin-top:6px">
        <input id="editTone" value="${esc(account.tone || "")}" placeholder="调性" />
        <input id="editIndustry" value="${esc(account.industry || "")}" placeholder="行业/品类" />
        <select id="editPriority">
          <option value="高" ${account.priority === "高" ? "selected" : ""}>高优先级</option>
          <option value="中" ${!account.priority || account.priority === "中" ? "selected" : ""}>中优先级</option>
          <option value="低" ${account.priority === "低" ? "selected" : ""}>低优先级</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="saveEditAccountBtn" class="ghost sm">保存</button>
        <button class="ghost sm close-edit-account" style="color:var(--red)">取消</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll(".close-edit-account").forEach((el) => el.addEventListener("click", () => overlay.remove()));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("editUrl").addEventListener("blur", async () => {
    const url = document.getElementById("editUrl").value.trim();
    if (!url || document.getElementById("editName").value.trim()) return;
    try {
      const r = await api("/api/accounts/detect-name", { method: "POST", body: JSON.stringify({ url }) });
      if (r.name) document.getElementById("editName").value = r.name;
      if (r.avatarUrl) document.getElementById("editUrl").dataset.avatarUrl = r.avatarUrl;
    } catch {}
  });
  document.getElementById("saveEditAccountBtn").addEventListener("click", async () => {
    const data = {
      brand: document.getElementById("editBrand").value.trim(),
      accountName: document.getElementById("editName").value.trim(),
      accountUrl: document.getElementById("editUrl").value.trim(),
      tone: document.getElementById("editTone").value.trim(),
      industry: document.getElementById("editIndustry").value.trim(),
      priority: document.getElementById("editPriority").value
    };
    if (!data.brand) { alert("请填写品牌名称"); return; }
    try {
      await api(`/api/accounts/${account.id}`, { method: "PUT", body: JSON.stringify(data) });
      overlay.remove();
      // If URL changed, re-sync follow
      if (data.accountUrl && data.accountUrl !== account.account_url) {
        const avatarUrl = document.getElementById("editUrl").dataset.avatarUrl || "";
        delete document.getElementById("editUrl").dataset.avatarUrl;
        await api(`/api/accounts/${account.id}/follow`, { method: "POST", body: JSON.stringify({ avatarUrl }) }).catch(() => {});
      }
      await refresh();
    } catch (e) { alert("保存失败：" + e.message); }
  });
}

function extractUserIdFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts[0] === "user" && parts[1] === "profile") return parts[3] || parts[2] || "";
  } catch {}
  return "";
}

function buildMiniChart(checks) {
  if (!checks || checks.length < 2) return "";
  const maxNew = Math.max(...checks.map((c) => c.new_notes), 1);
  const bars = checks.slice(-10).map((c) => {
    const pct = Math.max((c.new_notes / maxNew) * 40, 3);
    return `<div style="width:6px;background:var(--blue);height:${pct}px;border-radius:1px" title="${fmtBJ(c.check_at)}: ${c.new_notes} 篇新"></div>`;
  }).join("");
  return `<div style="display:flex;gap:1px;align-items:end;height:40px">${bars}</div>`;
}

$("#accUrl").addEventListener("blur", async () => {
  const url = $("#accUrl").value.trim();
  if (!url || $("#accName").value.trim()) return;
  const btn = $("#detectNameBtn");
  if (btn) { btn.textContent = "检测中…"; btn.disabled = true; }
  try {
    const r = await api("/api/accounts/detect-name", { method: "POST", body: JSON.stringify({ url }) });
    if (r.name) $("#accName").value = r.name;
    if (r.avatarUrl) $("#accUrl").dataset.avatarUrl = r.avatarUrl;
  } catch {}
  if (btn) { btn.textContent = "自动识别"; btn.disabled = false; }
});

$("#addAccountBtn").addEventListener("click", () => {
  const form = document.getElementById("newAccountForm");
  form.style.display = form.style.display === "none" ? "block" : "none";
});

$("#cancelAccountBtn").addEventListener("click", () => {
  document.getElementById("newAccountForm").style.display = "none";
});

$("#saveAccountBtn").addEventListener("click", async () => {
  try {
    const data = { brand: $("#accBrand").value, accountName: $("#accName").value, accountUrl: $("#accUrl").value, tone: $("#accTone").value, industry: $("#accIndustry").value, priority: $("#accPriority").value };
    if (!data.brand) { alert("请填写品牌名称"); return; }
    const avatarUrl = $("#accUrl").dataset.avatarUrl || "";
    delete $("#accUrl").dataset.avatarUrl;
    const created = await api("/api/accounts", { method: "POST", body: JSON.stringify(data) });
    if (data.accountUrl && created?.id) {
      await api(`/api/accounts/${created.id}/follow`, { method: "POST", body: JSON.stringify({ avatarUrl }) }).catch(() => {});
    }
    ["accBrand", "accName", "accUrl", "accTone", "accIndustry"].forEach((id) => $(`#${id}`).value = "");
    $("#accPriority").value = "中";
    document.getElementById("newAccountForm").style.display = "none";
    await refresh();
  } catch (e) { alert(`添加失败：${e.message}`); }
});

// ===== Crawl =====
function setCrawlBusy(busy) {
  const btn = $("#startCrawlBtn");
  btn.disabled = busy;
  btn.textContent = busy ? "采集中…" : "开始采集";
}

function showCrawlResult(result) {
  const box = $("#crawlResult");
  if (!result) { box.innerHTML = ""; return; }
  const items = result.notes?.length ? result.notes.map((n) =>
    `<div class="crawl-item"><span class="tag ${tagColor(n.contentType === "视频笔记" ? "video" : n.contentType === "Live图文" ? "livePhoto" : "image")}">${esc(n.contentType || "笔记")}</span> ${esc(n.title || "未命名")}</div>`
  ).join("") : result.skipped?.length
    ? `<p class="muted">跳过 ${result.skipped.length} 条已存在的笔记</p>`
    : `<p class="muted">无结果</p>`;
  box.innerHTML = `<div class="crawl-items">${items}</div>`;
}

$("#startCrawlBtn").addEventListener("click", async () => {
  const url = $("#crawlUrl").value.trim();
  if (!url) return;
  const data = { url, brand: $("#crawlBrand").value.trim(), tags: $("#crawlTags").value.split(",").map((s) => s.trim()).filter(Boolean), maxNotes: Number($("#crawlMaxNotes").value || 12) };
  setCrawlBusy(true);
  const status = $("#crawlStatus");
  status.className = "crawl-status-idle running";
  status.textContent = "采集中，请稍候…";
  showCrawlResult(null);
  try {
    const result = await api("/api/crawl", { method: "POST", body: JSON.stringify(data) });
    status.className = "crawl-status-idle success";
    status.textContent = `采集完成：入库 ${result.notes.length} 条，跳过 ${result.skipped?.length || 0} 条`;
    showCrawlResult(result);
    await refresh();
    await loadRecentBrands();
    await renderCrawlJobs();
  } catch (e) {
    status.className = "crawl-status-idle error";
    status.textContent = `✗ 采集失败：${e.message}`;
  }
  finally { setCrawlBusy(false); }
});

async function renderCrawlJobs() {
  const container = $("#crawlJobs");
  try {
    const jobs = await api("/api/jobs");
    if (!jobs.length) {
      container.innerHTML = '<div class="empty-state" style="min-height:60px"><p>暂无采集记录</p></div>';
      return;
    }
    container.innerHTML = jobs.map((j) => {
      const label = j.status === "成功" ? "success" : j.status === "失败" ? "error" : "running";
      return `<div class="job-item">
        <span class="tag ${label}">${esc(j.status)}</span>
        <span class="job-url">${esc(j.input_url)}</span>
        <span class="job-meta">${j.result_count || 0} 条 · ${fmtBJ(j.created_at)}</span>
      </div>`;
    }).join("");
  } catch { /* ignore */ }
}

// ===== Brand Suggestions =====
let _recentBrands = [];
async function loadRecentBrands() {
  try { _recentBrands = await api("/api/brands/recent"); } catch { _recentBrands = []; }
}
function showBrandSuggestions() {
  const input = $("#crawlBrand");
  const container = $("#brandSuggestions");
  const val = input.value.trim().toLowerCase();
  const filtered = val ? _recentBrands.filter((b) => b.toLowerCase().includes(val)) : _recentBrands;
  if (!filtered.length) { container.classList.remove("show"); return; }
  container.innerHTML = filtered.map((b) => `<div class="brand-suggestion-item">${esc(b)}</div>`).join("");
  container.classList.add("show");
  container.querySelectorAll(".brand-suggestion-item").forEach((el) => {
    el.addEventListener("click", () => { input.value = el.textContent; container.classList.remove("show"); });
  });
}
$("#crawlBrand").addEventListener("focus", showBrandSuggestions);
$("#crawlBrand").addEventListener("input", showBrandSuggestions);
document.addEventListener("click", (e) => {
  if (!e.target.closest(".brand-wrapper")) $("#brandSuggestions").classList.remove("show");
});

// ===== Search (发现) =====
let _searching = false;
$("#searchBtn").addEventListener("click", async () => {
  const kw = $("#searchKeyword").value.trim();
  if (!kw || _searching) return;
  _searching = true;
  $("#searchBtn").textContent = "搜索中…";
  const container = $("#searchResults");
  container.innerHTML = '<p class="muted" style="text-align:center">搜索中…</p>';
  try {
    const result = await api("/api/search", { method: "POST", body: JSON.stringify({ keyword: kw }) });
    if (!result.items?.length) {
      container.innerHTML = '<p class="muted" style="text-align:center;color:var(--text-secondary)">未找到结果。如被风控拦截，请在设置中关闭「无头浏览器」重试</p>';
      return;
    }
    container.innerHTML = `<div class="search-grid">${result.items.map((item) =>
      `<div class="search-card" data-url="${esc(item.url)}">
        ${item.image ? `<img src="${esc(item.image)}" alt="" />` : ""}
        <div class="search-card-body">
          <div class="search-card-title">${esc(item.title || "未命名")}</div>
          ${item.author ? `<div class="search-card-meta">${esc(item.author)}</div>` : ""}
          ${item.likes ? `<div class="search-card-meta">❤ ${esc(item.likes)}</div>` : ""}
        </div>
      </div>`
    ).join("")}</div>`;
    container.querySelectorAll(".search-card").forEach((card) => {
      card.addEventListener("click", () => {
        const url = card.dataset.url;
        if (url) {
          $("#crawlUrl").value = url;
          $("#crawlUrl").scrollIntoView({ behavior: "smooth" });
        }
      });
    });
    container.querySelectorAll(".search-card img").forEach((img) => {
      img.addEventListener("error", () => { img.hidden = true; }, { once: true });
    });
  } catch (e) {
    container.innerHTML = `<p class="muted" style="text-align:center;color:var(--red)">搜索失败：${esc(e.message)}</p>`;
  } finally {
    _searching = false;
    $("#searchBtn").textContent = "搜索";
  }
});

$("#searchKeyword").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#searchBtn").click(); });

// ===== Notes =====
function renderFilters() {
  const brands = [...new Set(state.notes.map((n) => n.brand).filter(Boolean))].sort();
  const types = [...new Set(state.notes.map((n) => n.contentType).filter(Boolean))].sort();
  const setOpt = (sel, opts, label) => {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${label}</option>` + opts.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    sel.value = opts.includes(cur) ? cur : "";
  };
  setOpt($("#brandFilter"), brands, "全部品牌");
  setOpt($("#contentTypeFilter"), types, "全部类型");
}

function noteMatches(n) {
  const q = $("#searchInput").value.trim().toLowerCase();
  if (q) {
    const hay = [n.title, n.description, n.brand, n.authorName, n.contentType, ...(n.tags || [])].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if ($("#brandFilter").value && n.brand !== $("#brandFilter").value) return false;
  if ($("#contentTypeFilter").value && n.contentType !== $("#contentTypeFilter").value) return false;
  if (state.activeLibTab && n.libraryType !== state.activeLibTab) return false;
  return true;
}

function updateLibStats() {
  const notes = state.notes;
  const brands = new Set(notes.map(n => n.brand).filter(Boolean));
  const assets = notes.reduce((s, n) => s + (n.assets?.length || 0), 0);
  const elNotes = $("#libStatNotes");
  const elBrands = $("#libStatBrands");
  const elAssets = $("#libStatAssets");
  if (elNotes) elNotes.textContent = notes.length;
  if (elBrands) elBrands.textContent = brands.size;
  if (elAssets) elAssets.textContent = assets;
}

function renderNotes() {
  updateLibStats();
  const filtered = state.notes.filter(noteMatches);
  if (state.viewMode === "table") {
    renderNoteTable(filtered);
    return;
  }
  const container = $("#notesList");
  if (!filtered.length) {
    container.className = "lib-grid empty-state";
    container.innerHTML = '<div class="icon">📚</div><p>案例库暂无内容，先去采集吧</p>';
    return;
  }
  container.className = "lib-grid";
  const slice = filtered.slice(0, state.renderLimit);
  container.innerHTML = slice.map((n) => {
    const checked = state.selectedIds.has(n.id) ? "checked" : "";
    const uniqueAssets = [];
    const seenPaths = new Set();
    for (const a of (n.assets || [])) {
      const key = a.localPath || a.sourceUrl || "";
      if (!key || seenPaths.has(key)) continue;
      seenPaths.add(key);
      uniqueAssets.push(a);
    }
    const images = uniqueAssets.filter(a => a.kind === "image" && a.localPath);
    const videos = uniqueAssets.filter(a => a.kind === "video" && a.localPath);
    const first = images[0];
    const isVideo = n.contentType === "视频笔记" || videos.length > 0;
    const isLive = n.contentType === "Live图文";
    const hasMulti = images.length > 1 && !isVideo;
    const tags = (n.tags || []).filter(Boolean);
    const tagHtml = tags.slice(0, 2).map(t => `<span>${esc(t)}</span>`).join("");
    const extraTag = tags.length > 2 ? `<span class="lib-tag-more">+${tags.length - 2}</span>` : "";
    const imgSrc = first ? esc(fileUrl(first)) : "";
    return `<div class="lib-card" data-id="${esc(n.id)}">
      <div class="lib-card-cover">
        ${imgSrc ? `<img class="lib-card-img" src="${imgSrc}" alt="" loading="lazy" />` : `<div class="lib-card-placeholder">📄</div>`}
        ${isVideo ? `<span class="lib-card-play"><svg width="12" height="12" viewBox="0 0 10 12" fill="#fff"><path d="M2.002.515 9.345 4.85a1.335 1.335 0 0 1 0 2.297L2.002 11.48A1.326 1.326 0 0 1 0 10.332V1.664A1.33 1.33 0 0 1 2.002.515"/></svg></span>` : ""}
        ${isLive ? `<span class="lib-card-badge live">Live</span>` : ""}
        ${hasMulti ? `<span class="lib-card-multi">${images.length}图</span>` : ""}
        ${state.selectMode ? `<label class="lib-card-cb"><input type="checkbox" class="note-checkbox" data-id="${esc(n.id)}" ${checked} /></label>` : ""}
        <div class="lib-card-actions">
          <button class="lib-card-action" data-analyze="${esc(n.id)}" title="AI 拆解"><span class="lca-icon">🧠</span><span class="lca-label">AI 拆解</span></button>
          <button class="lib-card-action" data-library="${esc(n.id)}" data-lib="${esc(n.libraryType || "")}" title="${n.libraryType ? '切换分类' : '添加分类'}"><span class="lca-icon">📂</span><span class="lca-label">${n.libraryType ? '切换分类' : '添加分类'}</span></button>
          <button class="lib-card-action" data-delete="${esc(n.id)}" title="删除"><span class="lca-icon">🗑️</span><span class="lca-label">删除</span></button>
        </div>
      </div>
      <div class="lib-card-body">
        <div class="lib-card-title">${esc(n.title || "未命名")}</div>
        <div class="lib-card-footer">
          <span class="lib-card-author">${esc(n.authorName || n.brand || "未知")}</span>
          <span class="lib-card-likes">❤ ${n.metrics?.likedCount || n.metrics?.likes || 0}</span>
        </div>
        ${tagHtml || extraTag ? `<div class="lib-card-tags">${tagHtml}${extraTag}</div>` : ""}
      </div>
    </div>`;
  }).join("");
  // Sentinel for infinite scroll (after container, since lib-grid uses column-count)
  const existing = document.getElementById("scrollSentinel");
  if (filtered.length > state.renderLimit) {
    if (!existing) {
      const s = document.createElement("div");
      s.id = "scrollSentinel";
      s.style.height = "1px";
      container.parentNode.insertBefore(s, container.nextSibling);
    }
    setupScrollObserver();
  } else {
    if (existing) existing.remove();
    if (state._observer) { state._observer.disconnect(); state._observer = null; }
  }
  bindCheckboxEvents();
  updateBatchBar();
}

function renderNoteTable(filtered) {
  const container = $("#notesTable");
  const cardContainer = $("#notesList");
  cardContainer.style.display = "none";
  container.style.display = "block";
  const tbody = $("#tableBody");
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state" style="border:none;padding:40px"><div class="icon">📚</div><p>案例库暂无内容</p></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map((n) => {
    const checked = state.selectedIds.has(n.id) ? "checked" : "";
    const analysisStatus = n.analysis ? "✅ 已拆解" : "—";
    const time = fmtBJ(n.collectedAt);
    return `<tr data-id="${esc(n.id)}">
      <td><input type="checkbox" class="note-checkbox" data-id="${esc(n.id)}" ${checked} /></td>
      <td>${esc(n.brand || "未分组")}</td>
      <td><span class="tag ${tagColor(n.contentType === "视频笔记" ? "video" : n.contentType === "Live图文" ? "livePhoto" : "image")}">${esc(n.contentType || "—")}</span></td>
      <td>${n.libraryType ? `<span class="tag" style="background:#dbeafe;color:#1d4ed8">${esc(n.libraryType)}</span>` : "—"}</td>
      <td class="cell-muted">${esc(time)}</td>
      <td class="cell-muted">${analysisStatus}</td>
      <td><button class="ghost sm" style="color:var(--red)" data-delete="${esc(n.id)}">删除</button></td>
    </tr>`;
  }).join("");
  bindCheckboxEvents();
  updateBatchBar();
}

function bindCheckboxEvents() {
  document.querySelectorAll(".note-checkbox").forEach((cb) => {
    cb.removeEventListener("change", onCheckboxChange);
    cb.addEventListener("change", onCheckboxChange);
  });
  const selectAll = $("#selectAllCheckbox");
  const selectAllTable = $("#selectAllTableCheckbox");
  [selectAll, selectAllTable].forEach((el) => {
    if (!el) return;
    el.removeEventListener("change", onSelectAllChange);
    el.addEventListener("change", onSelectAllChange);
  });
}

function setupScrollObserver() {
  if (state._observer) state._observer.disconnect();
  const sentinel = document.getElementById("scrollSentinel");
  if (!sentinel) return;
  state._observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      state.renderLimit += state.renderStep;
      state._observer.disconnect();
      state._observer = null;
      renderNotes();
    }
  }, { rootMargin: "200px" });
  state._observer.observe(sentinel);
}

function resetRenderLimit() { state.renderLimit = state.renderStep; if (state._observer) { state._observer.disconnect(); state._observer = null; } }

function onCheckboxChange(e) {
  const id = e.target.dataset.id;
  if (e.target.checked) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  syncSelectAllCheckboxes();
  updateBatchBar();
}

function onSelectAllChange(e) {
  const checked = e.target.checked;
  const filtered = state.notes.filter(noteMatches);
  filtered.forEach((n) => {
    if (checked) state.selectedIds.add(n.id);
    else state.selectedIds.delete(n.id);
  });
  // Sync all checkboxes
  document.querySelectorAll(".note-checkbox").forEach((cb) => { cb.checked = checked; });
  updateBatchBar();
}

function syncSelectAllCheckboxes() {
  const filtered = state.notes.filter(noteMatches);
  const allSelected = filtered.length > 0 && filtered.every((n) => state.selectedIds.has(n.id));
  const someSelected = filtered.some((n) => state.selectedIds.has(n.id));
  [$("#selectAllCheckbox"), $("#selectAllTableCheckbox")].forEach((el) => {
    if (!el) return;
    el.checked = allSelected;
    el.indeterminate = someSelected && !allSelected;
  });
}

function updateBatchBar() {
  const bar = $("#batchBar");
  const count = $("#batchCount");
  const deleteBtn = $("#batchDeleteBtn");
  const exportBtn = $("#batchExportBtn");
  const tagBtn = $("#batchTagBtn");
  const brandBtn = $("#batchBrandBtn");
  const libBtn = $("#batchLibraryBtn");
  const selectAllLabel = $("#selectAllLabel");
  const filtered = state.notes.filter(noteMatches);
  const selectedCount = state.selectedIds.size;
  if (selectedCount > 0 && state.selectMode) {
    bar.style.display = "flex";
    count.textContent = `已选 ${selectedCount} 条`;
    deleteBtn.disabled = false;
    exportBtn.disabled = false;
    if (tagBtn) tagBtn.disabled = false;
    if (brandBtn) brandBtn.disabled = false;
    if (libBtn) libBtn.disabled = false;
    selectAllLabel.textContent = filtered.length > 0 && filtered.every((n) => state.selectedIds.has(n.id))
      ? `全选（${filtered.length} 条）`
      : `全选当前（${filtered.length} 条）`;
  } else {
    bar.style.display = "none";
    deleteBtn.disabled = true;
    exportBtn.disabled = true;
    if (tagBtn) tagBtn.disabled = true;
    if (brandBtn) brandBtn.disabled = true;
    if (libBtn) libBtn.disabled = true;
  }
}

function clearSelection() {
  state.selectedIds.clear();
  document.querySelectorAll(".note-checkbox").forEach((cb) => { cb.checked = false; });
  [$("#selectAllCheckbox"), $("#selectAllTableCheckbox")].forEach((el) => { if (el) { el.checked = false; el.indeterminate = false; } });
  updateBatchBar();
}

// ===== Notes event delegation =====
async function handleNoteClick(e) {
  const analyze = e.target.closest("[data-analyze]");
  if (analyze) {
    analyze.disabled = true;
    analyze.textContent = "…";
    try {
      await api(`/api/notes/${analyze.dataset.analyze}/analyze`, { method: "POST", body: "{}" });
      await refresh();
    } finally { analyze.textContent = "AI 拆解"; analyze.disabled = false; }
    return;
  }
  const del = e.target.closest("[data-delete]");
  if (del) {
    if (!confirm("确认删除这条笔记及其素材？")) return;
    del.disabled = true;
    del.textContent = "…";
    try {
      await api(`/api/notes/${del.dataset.delete}`, { method: "DELETE" });
      await refresh();
    } catch (err) { alert(`删除失败：${err.message}`); del.textContent = "删除"; del.disabled = false; }
    return;
  }
  const commentsBtn = e.target.closest("[data-comments]");
  if (commentsBtn) {
    const noteId = commentsBtn.dataset.comments;
    const div = document.getElementById(`comments-${noteId}`);
    if (div) div.style.display = div.style.display === "none" ? "block" : "none";
    return;
  }
  const fetchComments = e.target.closest("[data-fetch-comments]");
  if (fetchComments) {
    const noteId = fetchComments.dataset.fetchComments;
    fetchComments.disabled = true;
    fetchComments.textContent = "获取中…";
    try {
      const result = await api(`/api/notes/${noteId}/comments`, { method: "POST", body: "{}" });
      const list = document.querySelector(`#comments-${esc(noteId)} .comments-list`);
      if (list) {
        if (!result.comments?.length) {
          list.innerHTML = '<p class="muted">暂无评论</p>';
        } else {
          list.innerHTML = result.comments.map((c) => `
            <div class="comment-item">
              <strong>${esc(c.authorName || c.author || "用户")}</strong>
              <div>${esc(c.content || "")}</div>
              <div class="comment-meta">❤ ${c.likes || 0}${c.time ? ` · ${esc(c.time)}` : ""}</div>
              ${c.replies?.length ? `<div class="comment-replies">${c.replies.slice(0, 5).map((r) =>
                `<div class="comment-reply"><strong>${esc(r.author || r.authorName || "用户")}</strong> ${esc(r.content || "")}</div>`
              ).join("")}${c.replies.length > 5 ? `<div class="muted">还有 ${c.replies.length - 5} 条回复</div>` : ""}</div>` : ""}
            </div>
          `).join("");
        }
      }
    } catch (err) {
      const list = document.querySelector(`#comments-${esc(noteId)} .comments-list`);
      if (list) list.innerHTML = `<p class="muted" style="color:var(--red)">获取失败：${esc(err.message)}</p>`;
    } finally { fetchComments.disabled = false; fetchComments.textContent = "获取评论"; }
  }
  const libBtn = e.target.closest("[data-library]");
  if (libBtn) {
    const noteId = libBtn.dataset.library;
    const currentLib = libBtn.dataset.lib;
    const libs = ["", "选题库", "脚本模板库", "视觉参考库", "营销话术库"];
    const nextIdx = (libs.indexOf(currentLib) + 1) % libs.length;
    const nextLib = libs[nextIdx];
    try {
      await api(`/api/notes/${noteId}/library`, { method: "POST", body: JSON.stringify({ libraryType: nextLib || null }) });
      await refresh();
    } catch (err) { alert(`分类失败：${err.message}`); }
    return;
  }
  // 卡片点击打开详情（排除按钮和checkbox）
  const card = e.target.closest(".lib-card");
  if (!card || e.target.closest(".lib-card-action") || e.target.closest(".lib-card-cb")) return;
  e.preventDefault();
  if (state.selectMode) {
    const cb = card.querySelector(".note-checkbox");
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
    return;
  }
  const note = state.notes.find(n => n.id === card.dataset.id);
  if (note) showNoteDetail(note);
}
// 绑定事件委托（卡片视图+表格视图）
$("#notesList")?.addEventListener("click", handleNoteClick);
$("#notesTable")?.addEventListener("click", handleNoteClick);

function showNoteDetail(note) {
  const existing = document.getElementById("noteDetailPanel");
  if (existing) { fillNotePanel(existing, note); return; }

  document.body.style.overflow = "hidden";

  const overlay = document.createElement("div");
  overlay.id = "noteDetailPanel";
  overlay.className = "ndp-overlay";
  overlay.innerHTML = `<div class="ndp-panel">
    <div class="ndp-left" id="ndpLeft"></div>
    <div class="ndp-right" id="ndpRight"></div>
  </div>`;
  document.body.appendChild(overlay);
  fillNotePanel(overlay, note);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) removeNotePanel();
  });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape" && document.getElementById("noteDetailPanel")) {
      removeNotePanel();
      document.removeEventListener("keydown", onEsc);
    }
  });
}

function removeNotePanel() {
  const p = document.getElementById("noteDetailPanel");
  if (p) p.remove();
  document.body.style.overflow = "";
}

function fillNotePanel(overlay, note) {
  const uniqueAssets = [];
  const seen = new Set();
  for (const a of (note.assets || [])) {
    const key = a.localPath || a.sourceUrl || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueAssets.push(a);
  }
  const m = note.metrics || {};
  const tags = (note.tags || []).filter(Boolean);
  const a = note.analysis || {};

  // Left: media (images + videos mixed in original order)
  const leftEl = overlay.querySelector("#ndpLeft");
  const mediaItems = uniqueAssets.filter(a => (a.kind === "image" || a.kind === "video") && a.localPath);
  let leftHtml;
  if (mediaItems.length > 0) {
    const hasMulti = mediaItems.length > 1;
    // 使用统一的轮播容器结构：每个 item 都是绝对定位，通过 opacity 切换
    leftHtml = `<div class="ndp-carousel">${mediaItems.map((item, i) => {
      const url = esc(fileUrl(item));
      const isActive = i === 0;
      if (item.kind === "image") {
        return `<div class="ndp-slide${isActive ? " active" : ""}" data-nd-slide="${i}">
          <div class="ndp-slide-bg"><img src="${url}" /></div>
          <img class="ndp-slide-img" src="${url}" data-nd-img="${i}" />
        </div>`;
      } else {
        return `<div class="ndp-slide${isActive ? " active" : ""}" data-nd-slide="${i}">
          <div class="ndp-slide-bg ndp-slide-video-bg"></div>
          <video class="ndp-slide-video" src="${url}" controls data-nd-img="${i}"></video>
        </div>`;
      }
    }).join("")}${hasMulti ? `
      <div class="ndp-dots">${mediaItems.map((_, i) => `<span class="ndp-dot${i === 0 ? " active" : ""}" data-nd-dot="${i}"></span>`).join("")}</div>
      <button class="ndp-nav ndp-prev" data-nd-prev>‹</button>
      <button class="ndp-nav ndp-next" data-nd-next>›</button>
      <span class="ndp-counter">${mediaItems.length}</span>` : ""}
    </div>`;
  } else {
    leftHtml = `<div class="ndp-empty">暂无预览图</div>`;
  }
  leftEl.innerHTML = `<button class="ndp-close-btn" id="ndpClose">✕</button>${leftHtml}`;

  // Right: info
  const rightEl = overlay.querySelector("#ndpRight");
  const analysisHtml = a.topicLogic ? `<div style="margin-top:14px;padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #f0f1f3">
    <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--text)">AI 拆解</div>
    <div style="font-size:12px;line-height:1.6;color:var(--text-secondary)"><span style="font-weight:500;color:var(--text-muted)">选题</span> ${esc(a.topicLogic)}<br><span style="font-weight:500;color:var(--text-muted)">开头</span> ${esc(a.openingHook)}${a.howWeCanUse ? `<br><span style="font-weight:500;color:var(--text-muted)">借鉴</span> ${esc(a.howWeCanUse)}` : ""}</div></div>` : "";
  rightEl.innerHTML = `
    <h2 style="font-size:15px;font-weight:700;margin:0 0 8px;line-height:1.45">${esc(note.title || "未命名")}</h2>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:12px;color:var(--text-muted);margin-bottom:8px">
      ${note.brand ? `<span style="font-weight:500;color:var(--text)">${esc(note.brand)}</span><span>·</span>` : ""}
      <span>${esc(note.authorName || "未知")}</span><span>·</span>
      <span>${esc(note.contentType || "")}</span>
      <span style="margin-left:2px">❤ ${m.likedCount || m.likes || 0}</span>
      <span>💬 ${m.commentCount || m.comments || 0}</span>
      <span>📌 ${m.collectedCount || m.collects || 0}</span>
    </div>
    ${note.libraryType || tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${note.libraryType ? `<span class="tag lib-tag">${esc(note.libraryType)}</span>` : ""}${tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    ${note.description ? `<div style="font-size:13px;color:var(--text-secondary);line-height:1.8;white-space:pre-wrap;margin-bottom:10px">${esc(note.description.slice(0, 2000))}</div>` : ""}
    ${analysisHtml}
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <a class="ndp-source-link" href="${esc(note.sourceUrl)}" target="_blank">🔗 原文</a>
      <button data-ndp-comments="${esc(note.id)}" style="display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 12px;border:1px solid var(--line);border-radius:6px;background:transparent;font-size:12px;color:var(--text-secondary);cursor:pointer">💬 评论</button>
    </div>
    <div id="ndpComments-${esc(note.id)}" style="display:none;margin-top:10px;max-height:260px;overflow-y:auto;font-size:12px;border-top:1px solid var(--line);padding-top:10px"></div>`;

  // Re-bind carousel
  const slides = overlay.querySelectorAll("[data-nd-slide]");
  const carouselImgs = overlay.querySelectorAll("[data-nd-img]");
  const carouselDots = overlay.querySelectorAll("[data-nd-dot]");
  let ndIdx = 0;
  function ndShow(i) {
    if (!slides.length) return;
    ndIdx = i;
    slides.forEach((slide, idx) => slide.classList.toggle("active", idx === i));
    carouselDots.forEach((dot, idx) => dot.classList.toggle("active", idx === i));
  }
  overlay.querySelector("[data-nd-prev]")?.addEventListener("click", () => ndShow((ndIdx - 1 + slides.length) % slides.length));
  overlay.querySelector("[data-nd-next]")?.addEventListener("click", () => ndShow((ndIdx + 1) % slides.length));
  carouselDots.forEach((dot, i) => dot.addEventListener("click", () => ndShow(i)));
  carouselImgs.forEach((item) => {
    if (item.tagName === "IMG") item.addEventListener("click", () => item.requestFullscreen?.());
  });
  // Keyboard nav
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") ndShow((ndIdx - 1 + slides.length) % slides.length);
    if (e.key === "ArrowRight") ndShow((ndIdx + 1) % slides.length);
  });

  // Comments toggle
  const cmtBtn = overlay.querySelector(`[data-ndp-comments="${esc(note.id)}"]`);
  if (cmtBtn) {
    cmtBtn.addEventListener("click", async () => {
      const container = document.getElementById(`ndpComments-${esc(note.id)}`);
      if (!container) return;
      if (container.style.display !== "none") { container.style.display = "none"; return; }
      container.style.display = "block";
      if (container.dataset.loaded) return;
      container.dataset.loaded = "1";
      container.innerHTML = '<p class="muted" style="font-size:12px">加载中…</p>';
      try {
        const result = await api(`/api/notes/${note.id}/comments`, { method: "POST", body: "{}" });
        if (!result.comments?.length) {
          container.innerHTML = '<p class="muted" style="font-size:12px">暂无评论</p>';
        } else {
          container.innerHTML = result.comments.map(c => `
            <div style="padding:6px 0;border-bottom:1px solid var(--line);font-size:12px">
              <strong>${esc(c.authorName || c.author || "用户")}</strong>
              <div style="margin:2px 0;color:var(--text-secondary)">${esc(c.content || "")}</div>
              <div style="font-size:11px;color:var(--text-muted)">❤ ${c.likes || 0}${c.time ? ` · ${esc(c.time)}` : ""}</div>
            </div>
          `).join("");
        }
      } catch (err) {
        container.innerHTML = `<p style="color:var(--red);font-size:12px">获取失败：${esc(err.message)}</p>`;
      }
    });
  }

  // Close button
  overlay.querySelector("#ndpClose")?.addEventListener("click", () => removeNotePanel());
}

// ===== XHS Accounts =====
let qrPollTimer = null;

function showQrModal(accountName) {
  $("#qrOverlay").style.display = "flex";
  $("#qrCodeContainer").innerHTML = '<p class="muted">正在加载二维码…</p>';
  $("#qrStatus").textContent = "请使用小红书 App 扫码";
  startQrLoginFlow(accountName);
}

function hideQrModal() {
  $("#qrOverlay").style.display = "none";
  if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
  const name = $("#qrOverlay").dataset.accountName || "default";
  api("/api/auth/qr/cancel", { method: "POST", body: JSON.stringify({ accountName: name }) }).catch(() => {});
}

async function startQrLoginFlow(accountName) {
  try {
    const result = await api("/api/auth/qr/start", { method: "POST", body: JSON.stringify({ accountName }) });
    $("#qrOverlay").dataset.accountName = accountName;
    $("#qrCodeContainer").innerHTML = `<img src="${result.qrBase64}" style="max-width:240px;border-radius:8px" alt="QR Code" />`;
    $("#qrStatus").textContent = `扫码绑定「${esc(accountName)}」`;
    startQrPolling(accountName);
  } catch (e) {
    $("#qrCodeContainer").innerHTML = `<p style="color:var(--red)">加载失败：${esc(e.message)}</p>`;
  }
}

function startQrPolling(accountName) {
  if (qrPollTimer) clearInterval(qrPollTimer);
  qrPollTimer = setInterval(async () => {
    try {
      const status = await api(`/api/auth/qr/status?accountName=${encodeURIComponent(accountName)}`);
      if (status.status === "logged_in") {
        clearInterval(qrPollTimer); qrPollTimer = null;
        $("#qrStatus").textContent = "登录成功！正在保存…";
        const final = await api("/api/auth/qr/finalize", { method: "POST", body: JSON.stringify({ accountName }) });
        if (final.ok) {
          $("#qrStatus").textContent = "✅ 账号绑定成功";
          setTimeout(() => { hideQrModal(); renderXhsAccounts(); }, 1500);
        } else {
          $("#qrStatus").textContent = `保存失败：${esc(final.error)}`;
        }
      } else if (status.status === "pending" && status.refreshedQr) {
        $("#qrCodeContainer").innerHTML = `<img src="${status.refreshedQr}" style="max-width:240px;border-radius:8px" alt="QR Code" />`;
        $("#qrStatus").textContent = "二维码已刷新，请使用小红书扫码";
      } else if (status.status === "timeout") {
        clearInterval(qrPollTimer); qrPollTimer = null;
        $("#qrStatus").textContent = "⏰ 二维码已过期";
        $("#qrCodeContainer").innerHTML = '<button class="ghost" id="retryQrBtn">重新获取</button>';
        $("#retryQrBtn").addEventListener("click", () => startQrLoginFlow(accountName));
      }
    } catch {}
  }, 2000);
}

$("#closeQrBtn").addEventListener("click", hideQrModal);
$("#cancelQrBtn").addEventListener("click", hideQrModal);

function renderXhsAccounts() {
  api("/api/xhs-accounts").then((accounts) => {
    state.xhsAccounts = accounts;
    const list = $("#xhsAccountsList");
    if (!accounts.length) {
      list.innerHTML = '<div class="empty-state" style="min-height:60px"><p>暂无已绑定账号</p></div>';
    } else {
      list.innerHTML = accounts.map((a) => `
        <div class="xhs-account-item">
          <div class="xhs-account-info">
            <strong>${esc(a.name)}</strong>
            <span class="tag ${a.status === "有效" ? "green" : a.status === "无效" ? "red" : "orange"}">${esc(a.status)}</span>
          </div>
          <div class="xhs-account-meta">${a.last_used_at ? `上次使用：${fmtBJ(a.last_used_at)}` : ""}</div>
          <div class="xhs-account-actions">
            <button class="ghost sm" data-account-check="${esc(a.id)}">检测</button>
            <button class="ghost sm" style="color:var(--red)" data-account-delete="${esc(a.id)}">删除</button>
          </div>
        </div>
      `).join("");
      // Bind events
      list.querySelectorAll("[data-account-check]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true; btn.textContent = "检测中…";
          try {
            const r = await api(`/api/xhs-accounts/check-cookie?id=${btn.dataset.accountCheck}`);
            btn.textContent = r.valid ? "✅ 有效" : "❌ 无效";
          } catch { btn.textContent = "检测失败"; }
          setTimeout(() => { btn.textContent = "检测"; btn.disabled = false; renderXhsAccounts(); }, 2000);
        });
      });
      list.querySelectorAll("[data-account-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("确认删除此账号？")) return;
          await api(`/api/xhs-accounts/${btn.dataset.accountDelete}`, { method: "DELETE" });
          renderXhsAccounts();
        });
      });
    }
    // Update schedule account dropdown
    const sel = document.getElementById("scheduleAccount");
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">所有账号</option>' + accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("");
      sel.value = cur;
    }
  }).catch(() => {});
}

$("#addAccountQrBtn")?.addEventListener("click", () => {
  const name = $("#xhsAccountName").value.trim() || "账号-" + Date.now().toString(36);
  showQrModal(name);
});

$("#addAccountPasteBtn")?.addEventListener("click", () => {
  const area = document.getElementById("pasteCookieArea");
  area.style.display = area.style.display === "none" ? "block" : "none";
});

$("#savePastedCookie")?.addEventListener("click", async () => {
  const cookie = $("#pasteCookieInput").value.trim();
  const name = $("#xhsAccountName").value.trim() || "账号-" + Date.now().toString(36);
  if (!cookie) return;
  try {
    await api("/api/xhs-accounts", { method: "POST", body: JSON.stringify({ name, cookie }) });
    $("#pasteCookieInput").value = "";
    document.getElementById("pasteCookieArea").style.display = "none";
    renderXhsAccounts();
  } catch (e) { alert("保存失败：" + e.message); }
});

// ===== Scheduled Tasks =====
function renderScheduledTasks() {
  api("/api/scheduled-tasks").then((tasks) => {
    state.scheduledTasks = tasks;
    const list = $("#scheduledTasksList");
    if (!tasks.length) {
      list.innerHTML = '<div class="empty-state" style="min-height:40px"><p>暂无定时任务</p></div>';
    } else {
      list.innerHTML = tasks.map((t) => `
        <div class="schedule-item">
          <div class="schedule-info">
            <strong>${esc(t.name)}</strong>
            <span class="tag ${t.status === "运行中" ? "running" : t.status === "失败" ? "red" : "green"}">${esc(t.status)}</span>
          </div>
          <div class="schedule-meta">${esc(t.task_type)} · ${t.interval_minutes}分钟间隔 · ${t.last_run_at ? `上次：${fmtBJ(t.last_run_at)}` : "未运行"}</div>
          <div class="schedule-actions">
            <button class="ghost sm" data-schedule-toggle="${esc(t.id)}">${t.enabled ? "暂停" : "启用"}</button>
            <button class="ghost sm" style="color:var(--red)" data-schedule-delete="${esc(t.id)}">删除</button>
          </div>
        </div>
      `).join("");
      list.querySelectorAll("[data-schedule-toggle]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const task = state.scheduledTasks.find((t) => t.id === btn.dataset.scheduleToggle);
          await api(`/api/scheduled-tasks/${btn.dataset.scheduleToggle}`, { method: "PUT", body: JSON.stringify({ enabled: !task?.enabled }) });
          renderScheduledTasks();
        });
      });
      list.querySelectorAll("[data-schedule-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("确认删除此任务？")) return;
          await api(`/api/scheduled-tasks/${btn.dataset.scheduleDelete}`, { method: "DELETE" });
          renderScheduledTasks();
        });
      });
    }
  }).catch(() => {});
  api("/api/task-logs").then((logs) => {
    const list = $("#taskLogsList");
    if (!logs.length) {
      list.innerHTML = '<div class="empty-state" style="min-height:40px"><p>暂无日志</p></div>';
    } else {
      list.innerHTML = logs.map((l) =>
        `<div class="job-item"><span class="tag ${l.status === "成功" ? "green" : l.status === "失败" ? "red" : "running"}">${esc(l.status)}</span><span class="job-url" style="flex:1">${esc(l.message || "")}</span><span class="job-meta">${fmtBJ(l.started_at)}</span></div>`
      ).join("");
    }
  }).catch(() => {});
}

$("#healthCheckBtn")?.addEventListener("click", async () => {
  const btn = $("#healthCheckBtn");
  const resultDiv = $("#healthResult");
  btn.disabled = true; btn.textContent = "检测中…";
  resultDiv.innerHTML = '<div class="muted">正在获取笔记数据…</div>';
  try {
    const r = await api("/api/xhs/health", { method: "POST" });
    if (!r.notes || !r.notes.length) {
      resultDiv.innerHTML = '<div class="empty-state"><p>未找到笔记或账号未登录</p></div>';
      btn.textContent = "检测限流状态"; btn.disabled = false;
      return;
    }
    let html = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
    for (const [key, count] of Object.entries(r.distribution)) {
      html += `<span class="tag">${esc(key)}: ${count}</span>`;
    }
    html += '</div>';
    if (r.limitedNotes.length) {
      html += '<div style="color:var(--red);font-weight:500;margin-bottom:4px">⚠ 限流风险笔记：</div>';
      for (const n of r.limitedNotes) {
        html += `<div style="font-size:12px;padding:2px 0">${n.levelMeta.emoji} ${esc(n.title || n.noteId)} — ${esc(n.levelMeta.label)}</div>`;
      }
    }
    if (r.sensitiveNotes.length) {
      html += '<div style="color:var(--orange);font-weight:500;margin-top:8px;margin-bottom:4px">⚡ 敏感因素笔记：</div>';
      for (const n of r.sensitiveNotes) {
        const hits = n.sensitiveHits.length ? `（敏感词：${n.sensitiveHits.join("、")}）` : n.tagWarning ? "（标签过多）" : "";
        html += `<div style="font-size:12px;padding:2px 0">${esc(n.title || n.noteId)} ${hits}</div>`;
      }
    }
    if (!r.limitedNotes.length && !r.sensitiveNotes.length) {
      html += '<div style="color:var(--green)">✅ 所有笔记分发正常</div>';
    }
    html += `<div class="muted" style="margin-top:8px">共检测 ${r.totalNotes} 条笔记</div>`;
    resultDiv.innerHTML = html;
  } catch (e) {
    resultDiv.innerHTML = `<div style="color:var(--red)">检测失败：${esc(e.message)}</div>`;
  }
  btn.textContent = "检测限流状态"; btn.disabled = false;
});

// ===== Diagnosis =====
$("#diagnoseBtn")?.addEventListener("click", async () => {
  const btn = $("#diagnoseBtn");
  const resultDiv = $("#diagnoseResult");
  btn.disabled = true; btn.textContent = "诊断中…";
  resultDiv.innerHTML = '<div class="muted">正在检测各通道状态…</div>';
  try {
    const r = await api("/api/diagnose");
    const ch = r.channels || {};
    let html = `<div style="margin-bottom:12px"><strong>诊断结果：${esc(r.summary || "")}</strong></div>`;
    html += '<div class="diagnose-grid">';
    const channelOrder = ["cookie", "http_fast_path", "playwright"];
    const channelLabels = { cookie: "Cookie 登录", http_fast_path: "HTTP 快速路径", playwright: "Playwright" };
    for (const key of channelOrder) {
      const c = ch[key];
      if (!c) continue;
      const statusIcon = c.status === "ok" ? "✅" : c.status === "blocked" || c.status === "invalid" ? "❌" : c.status === "not_found" ? "⚪" : "⚠️";
      const statusClass = c.status === "ok" ? "green" : c.status === "blocked" || c.status === "invalid" ? "red" : "muted";
      html += `<div class="diagnose-channel"><div class="diagnose-channel-head"><span class="diagnose-status ${statusClass}">${statusIcon} ${esc(channelLabels[key] || key)}</span><span class="tag ${statusClass}">${esc(c.status)}</span></div>`;
      html += `<div class="diagnose-detail">${esc(c.detail || "")}</div>`;
      if (c.suggestion) html += `<div class="diagnose-suggest">💡 ${esc(c.suggestion)}</div>`;
      html += '</div>';
    }
    html += '</div>';
    if (r.captchaDetected) {
      html += '<div class="diagnose-warning" style="margin-top:12px">⚠️ 检测到风控验证码拦截</div>';
    }
    if (r.suggestions && r.suggestions.length) {
      html += '<div style="margin-top:12px"><strong>建议：</strong><ul style="margin:6px 0 0;padding-left:20px;font-size:13px;color:var(--text-secondary)">';
      for (const s of r.suggestions) html += `<li style="margin:3px 0">${esc(s)}</li>`;
      html += '</ul></div>';
    }
    resultDiv.innerHTML = html;
  } catch (e) {
    resultDiv.innerHTML = `<div style="color:var(--red)">诊断失败：${esc(e.message)}</div>`;
  }
  btn.textContent = "运行诊断"; btn.disabled = false;
});

$("#addScheduleBtn")?.addEventListener("click", () => {
  const form = document.getElementById("scheduleForm");
  form.style.display = form.style.display === "none" ? "block" : "none";
});

$("#saveScheduleBtn")?.addEventListener("click", async () => {
  const name = $("#scheduleName").value.trim();
  const url = $("#scheduleUrl").value.trim();
  const type = $("#scheduleType").value;
  const accountId = $("#scheduleAccount").value;
  const interval = Number($("#scheduleInterval").value) || 60;
  if (!name || !url) return;
  try {
    let config;
    if (type === "search") config = { keyword: url };
    else if (type === "follow") config = { authorUrl: url, brand: "" };
    else config = { url };
    await api("/api/scheduled-tasks", { method: "POST", body: JSON.stringify({ name, taskType: type, config, accountId: accountId || null, intervalMinutes: interval }) });
    $("#scheduleName").value = ""; $("#scheduleUrl").value = "";
    document.getElementById("scheduleForm").style.display = "none";
    renderScheduledTasks();
  } catch (e) { alert("创建失败：" + e.message); }
});

// ===== Monitors =====
function renderMonitors() {}

// ===== Dashboard =====
let _dashboardRange = "7";

function chartAvailable() { return typeof Chart !== "undefined"; }

async function renderDashboard() {
  const range = $("#dashboardRange")?.value || "7";
  _dashboardRange = range;
  try {
    const [stats, interaction, topNotes, tagCloud] = await Promise.all([
      api(`/api/stats?range=${range}`),
      api(`/api/stats/interaction?range=${range}`),
      api(`/api/stats/top-notes?range=${range}&limit=20`),
      api(`/api/stats/tag-cloud?limit=30`)
    ]);
    state.stats = stats;
    $("#statNotes").textContent = stats.overview.totalNotes;
    $("#statAssets").textContent = stats.overview.totalAssets;
    $("#statAccounts").textContent = stats.overview.totalAccounts;
    $("#statXhsAccounts").textContent = stats.overview.totalXhsAccounts;
    $("#statJobs").textContent = stats.overview.totalJobs;
    $("#statAnalysis").textContent = stats.overview.totalAnalysis;
    renderDashboardLists(topNotes, tagCloud);
    renderBrandCompare();
    if (!chartAvailable()) {
      console.warn("Chart.js 未加载，图表无法渲染");
      document.querySelectorAll(".charts-grid canvas").forEach(c => {
        c.parentElement.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><p>图表库加载失败</p><p style="font-size:12px;margin-top:4px">请刷新页面或检查网络连接</p></div>';
      });
      return;
    }
    renderCharts(stats, interaction);
  } catch (e) { console.warn("仪表盘渲染异常:", e.message); }
}

$("#dashboardRange")?.addEventListener("change", renderDashboard);

function renderCharts(s, interaction) {
  const chartOpts = (type, labels, data, colors, label) => ({
    type, data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: colors.map(() => "transparent"), borderWidth: 0, label: label || "" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type === "pie", position: "bottom", labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } }, scales: type === "bar" ? { y: { beginAtZero: true, ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 11 } } } } : {} }
  });
  const COLORS = ["#6b8f8a", "#c49a7a", "#9a8aaa", "#c47a6a", "#c4a07a", "#8a9a7a", "#a8b89a", "#7aa0a0", "#c0a0a0", "#9080a0"];

  if (window.trendChart) window.trendChart.destroy();
  if (window.typeChart) window.typeChart.destroy();
  if (window.brandChart) window.brandChart.destroy();
  if (window.assetKindChart) window.assetKindChart.destroy();
  if (window.statusChart) window.statusChart.destroy();
  if (window.interactionChart) window.interactionChart.destroy();

  const trendCanvas = document.getElementById("chartTrend");
  if (s.trend?.length && trendCanvas) {
    window.trendChart = new Chart(trendCanvas, chartOpts("bar", s.trend.map((d) => d.date.slice(5)), s.trend.map((d) => d.count), [COLORS[0]], "采集数"));
  }
  const typeCanvas = document.getElementById("chartType");
  if (s.byType?.length && typeCanvas) {
    window.typeChart = new Chart(typeCanvas, chartOpts("pie", s.byType.map((d) => d.content_type), s.byType.map((d) => d.count), COLORS));
  }
  const brandCanvas = document.getElementById("chartBrand");
  if (s.byBrand?.length && brandCanvas) {
    window.brandChart = new Chart(brandCanvas, chartOpts("bar", s.byBrand.map((d) => d.brand), s.byBrand.map((d) => d.count), COLORS, "笔记数"));
  }
  const assetCanvas = document.getElementById("chartAssetKind");
  if (s.byAssetKind?.length && assetCanvas) {
    const labels = { image: "图片", video: "视频", livePhoto: "Live图" };
    window.assetKindChart = new Chart(assetCanvas, chartOpts("pie", s.byAssetKind.map((d) => labels[d.kind] || d.kind), s.byAssetKind.map((d) => d.count), COLORS));
  }
  const statusCanvas = document.getElementById("chartStatus");
  if (s.byStatus?.length && statusCanvas) {
    window.statusChart = new Chart(statusCanvas, chartOpts("pie", s.byStatus.map((d) => d.status), s.byStatus.map((d) => d.count), ["#6b8f8a", "#c49a7a", "#c47a6a", "#c4a09a"]));
  }

  // Interaction trend chart
  const intCanvas = document.getElementById("chartInteraction");
  if (interaction?.length && intCanvas) {
    const labels = interaction.map((d) => d.date.slice(5));
    window.interactionChart = new Chart(intCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { data: interaction.map((d) => d.likes), borderColor: COLORS[0], backgroundColor: COLORS[0] + "20", label: "点赞", fill: true, tension: 0.3, pointRadius: 2 },
          { data: interaction.map((d) => d.comments), borderColor: COLORS[1], backgroundColor: COLORS[1] + "20", label: "评论", fill: true, tension: 0.3, pointRadius: 2 },
          { data: interaction.map((d) => d.collects), borderColor: COLORS[2], backgroundColor: COLORS[2] + "20", label: "收藏", fill: true, tension: 0.3, pointRadius: 2 },
          { data: interaction.map((d) => d.shares), borderColor: COLORS[3], backgroundColor: COLORS[3] + "20", label: "分享", fill: true, tension: 0.3, pointRadius: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 11 } } } }
      }
    });
  }

}

function renderDashboardLists(topNotes, tagCloud) {
  // Tag cloud
  const cloud = $("#tagCloud");
  if (cloud) {
    if (tagCloud?.length) {
      const maxCount = tagCloud[0]?.count || 1;
      cloud.innerHTML = '<div class="tag-cloud-items">' + tagCloud.map((t) => {
        const size = Math.round(12 + (t.count / maxCount) * 20);
        const opacity = 0.5 + (t.count / maxCount) * 0.5;
        return `<span class="tag-cloud-item" style="font-size:${size}px;opacity:${opacity}" title="${esc(t.tag)} (${t.count})">${esc(t.tag)}</span>`;
      }).join("") + '</div>';
    } else {
      cloud.innerHTML = '<p class="muted" style="text-align:center;padding:40px 0">暂无标签</p>';
    }
  }

  // Top 20 notes
  const topList = $("#topNotesList");
  if (topList) {
    if (topNotes?.length) {
      topList.innerHTML = topNotes.map((n, i) => `<div class="top-note-item">
        <span class="top-note-rank">${i + 1}</span>
        <div class="top-note-info">
          <div class="top-note-title">${esc(n.title || "未命名")}</div>
          <div class="top-note-meta">${esc(n.brand || "未分组")} · ❤ ${n.totalInteractions || 0}</div>
        </div>
      </div>`).join("");
    } else {
      topList.innerHTML = '<p class="muted" style="text-align:center;padding:40px 0">暂无数据</p>';
    }
  }
}

// ===== Brand Comparison =====
async function renderBrandCompare() {
  try {
    const data = await api("/api/stats/brand-compare");
    const el = $("#brandCompareBody");
    if (!el) return;
    if (!data.length) { el.innerHTML = '<p class="muted" style="text-align:center;padding:20px">暂无品牌数据</p>'; return; }
    const max = Math.max(...data.map(b => b.totalInteractions), 1);
    el.innerHTML = `<div style="display:grid;gap:var(--sp-3);grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${data.map(b => {
      const pct = Math.round(b.totalInteractions / max * 100);
      return `<div style="border:1px solid var(--line);border-radius:var(--radius-lg);padding:var(--sp-3);background:var(--surface)">
        <div style="font-weight:600;font-size:var(--text-base);margin-bottom:4px">${esc(b.brand)}</div>
        <div style="font-size:var(--text-xs);color:var(--text-muted)">${b.totalNotes} 篇笔记</div>
        <div style="margin:8px 0;height:6px;background:var(--line-light);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--primary);border-radius:3px"></div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:var(--text-xs);color:var(--text-secondary)">
          <span>❤ ${b.avgLike}</span><span>💬 ${b.avgComment}</span>
          <span>📌 ${b.avgCollect}</span><span>🎬 ${b.videoCount}</span>
        </div>
        ${b.authors?.length ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">作者：${esc(b.authors.join("、").slice(0, 40))}</div>` : ""}
        ${b.topTags?.length ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:2px">${b.topTags.slice(0, 5).map(t => `<span style="font-size:10px;padding:0 6px;border-radius:999px;background:var(--line-light);color:var(--text-muted)">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  } catch {}
}

// ===== Content Analysis =====
const CA_COLORS = ["#6b8f8a", "#c49a7a", "#9a8aaa", "#c47a6a", "#c4a07a", "#8a9a7a", "#a8b89a", "#7aa0a0", "#c0a0a0", "#9080a0"];

async function renderContentAnalysis() {
  const range = $("#caRange")?.value || "";
  try {
    const data = await api(`/api/stats/content-analysis?range=${range}`);
    $("#caTotalNotes").textContent = data.totalNotes;
    $("#caHookRate").textContent = (data.titleStats?.hookRate || 0) + "%";
    $("#caAvgTitle").textContent = data.titleStats?.avgTitleLength || 0;
    $("#caAvgBody").textContent = data.bodyStats?.avgBodyLength || 0;
    $("#caAvgLikes").textContent = data.engagementStats?.avgLikes || 0;
    $("#caMaxTotal").textContent = data.engagementStats?.maxTotal || 0;
    renderCaTopicCloud(data.bodyStats?.topics || []);
    if (!chartAvailable()) {
      document.querySelectorAll("#page-content-analysis canvas").forEach(c => {
        c.parentElement.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><p>图表库加载失败，请刷新页面</p></div>';
      });
      return;
    }
    renderCaCharts(data);
  } catch (e) { console.warn("内容分析渲染异常:", e.message); }
}

$("#caRange")?.addEventListener("change", renderContentAnalysis);

function renderCaCharts(data) {
  if (window.caHookChart) window.caHookChart.destroy();
  if (window.caPatternChart) window.caPatternChart.destroy();
  if (window.caTypeChart) window.caTypeChart.destroy();
  if (window.caGoalChart) window.caGoalChart.destroy();
  if (window.caVisualChart) window.caVisualChart.destroy();
  if (window.caLibChart) window.caLibChart.destroy();

  const pieOpts = (labels, dataValues) => ({
    type: "pie",
    data: { labels, datasets: [{ data: dataValues, backgroundColor: CA_COLORS }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } } }
  });
  const barOpts = (labels, dataValues, label) => ({
    type: "bar",
    data: { labels, datasets: [{ data: dataValues, backgroundColor: CA_COLORS[0], label: label || "数量" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 10 } } } } }
  });

  const hooks = data.titleStats?.hookDistribution || {};
  const hookEl = document.getElementById("caHookChart");
  if (hookEl && Object.keys(hooks).length) {
    window.caHookChart = new Chart(hookEl, barOpts(Object.keys(hooks), Object.values(hooks), "笔记数"));
  }

  const patterns = data.titleStats?.patternDistribution || {};
  const patEl = document.getElementById("caPatternChart");
  if (patEl && Object.keys(patterns).length) {
    window.caPatternChart = new Chart(patEl, barOpts(Object.keys(patterns), Object.values(patterns), "笔记数"));
  }

  const types = data.contentTypes || [];
  const typeEl = document.getElementById("caTypeChart");
  if (typeEl && types.length) {
    window.caTypeChart = new Chart(typeEl, pieOpts(types.map((d) => d.type), types.map((d) => d.count)));
  }

  const goals = data.marketingGoals || [];
  const goalEl = document.getElementById("caGoalChart");
  if (goalEl && goals.length) {
    window.caGoalChart = new Chart(goalEl, pieOpts(goals.map((d) => d.goal), goals.map((d) => d.count)));
  }

  const visuals = data.visualStyle || [];
  const visEl = document.getElementById("caVisualChart");
  if (visEl && visuals.length) {
    window.caVisualChart = new Chart(visEl, barOpts(visuals.map((d) => d.style), visuals.map((d) => d.count), "笔记数"));
  }

  const libs = data.libraries || {};
  const libEl = document.getElementById("caLibChart");
  if (libEl && Object.keys(libs).length) {
    window.caLibChart = new Chart(libEl, barOpts(Object.keys(libs), Object.values(libs), "笔记数"));
  }
}

function renderCaTopicCloud(topics) {
  const el = $("#caTopicCloud");
  if (!el) return;
  if (!topics || !topics.length) {
    el.innerHTML = '<p class="muted" style="text-align:center;padding:40px 0">暂无数据</p>';
    return;
  }
  const maxCount = Math.max(...topics.map((t) => t.count));
  el.innerHTML = '<div class="tag-cloud-items">' + topics.map((t) => {
    const ratio = t.count / maxCount;
    const size = 12 + Math.round(ratio * 20);
    const opacity = 0.5 + ratio * 0.5;
    return `<span class="tag-cloud-item" style="font-size:${size}px;opacity:${opacity}">${esc(t.phrase)}</span>`;
  }).join("") + '</div>';
}

// ===== Reports =====
let _currentReport = null;

async function renderReports() {
  _currentReport = null;
  const jsonBtn = document.getElementById("exportReportJsonBtn");
  const mdBtn = document.getElementById("exportReportMdBtn");
  if (jsonBtn) jsonBtn.style.display = "none";
  if (mdBtn) mdBtn.style.display = "none";
  const rc = document.getElementById("reportContent");
  if (rc) rc.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>点击"生成报告"查看分析结果</p></div>';
}

async function generateReport() {
  const type = document.getElementById("reportTypeSelect")?.value || "weekly";
  const btn = document.getElementById("generateReportBtn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    const report = await api(`/api/reports/${type === "weekly" ? "weekly-brief" : "monthly-review"}`);
    _currentReport = report;
    renderReportContent(report);
    const jsonBtn = document.getElementById("exportReportJsonBtn");
    const mdBtn = document.getElementById("exportReportMdBtn");
    if (jsonBtn) jsonBtn.style.display = "";
    if (mdBtn) mdBtn.style.display = "";
  } catch (e) {
    const rc = document.getElementById("reportContent");
    if (rc) rc.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>生成失败：${esc(e.message)}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "生成报告";
  }
}

document.getElementById("generateReportBtn")?.addEventListener("click", generateReport);

function renderReportContent(r) {
  const el = document.getElementById("reportContent");
  if (!el) return;
  const s = r.summary;
  const hookKeys = Object.keys(r.hookPatternSummary?.distribution || {});
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        <div class="stat-card"><div class="stat-value">${s.totalNotes}</div><div class="stat-label">笔记数</div></div>
        <div class="stat-card"><div class="stat-value">${s.totalAssets}</div><div class="stat-label">素材数</div></div>
        <div class="stat-card"><div class="stat-value">${s.activeAuthors}</div><div class="stat-label">活跃作者</div></div>
        <div class="stat-card"><div class="stat-value">${s.activeBrands}</div><div class="stat-label">活跃品牌</div></div>
        <div class="stat-card"><div class="stat-value">${s.hookRate}%</div><div class="stat-label">标题钩子率</div></div>
        <div class="stat-card"><div class="stat-value" style="font-size:18px">${r.comparison.noteChange > 0 ? "+" : ""}${r.comparison.noteChange}%</div><div class="stat-label">环比变化</div></div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between">
        <div class="card" style="flex:1;min-width:280px">
          <div class="card-header"><h3>Top 10 笔记</h3></div>
          ${r.topNotes.length ? r.topNotes.map((n) => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px">
              <span><strong>#${n.rank}</strong> ${esc(n.title || "未命名")} <span class="tag">${esc(n.brand)}</span></span>
              <span style="color:var(--muted)">❤ ${n.totalInteractions}</span>
            </div>
          `).join("") : '<p class="muted" style="padding:16px;text-align:center">暂无数据</p>'}
        </div>
        <div class="card" style="flex:1;min-width:200px">
          <div class="card-header"><h3>作者排行</h3></div>
          ${r.authorRanking.length ? r.authorRanking.map((a) => `
            <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--line)">
              <span>${esc(a.author)}</span><span style="color:var(--muted)">${a.count} 篇</span>
            </div>
          `).join("") : '<p class="muted" style="padding:16px;text-align:center">暂无数据</p>'}
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="card" style="flex:1;min-width:180px">
          <div class="card-header"><h3>品牌分布</h3></div>
          ${r.brandDistribution.slice(0, 8).map((b) => `
            <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
              <span>${esc(b.brand)}</span><span style="color:var(--muted)">${b.count} (${b.percentage}%)</span>
            </div>
          `).join("")}
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="card-header"><h3>内容类型</h3></div>
          ${r.contentTypeBreakdown.map((c) => `
            <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
              <span>${esc(c.type)}</span><span style="color:var(--muted)">${c.count} (${c.percentage}%)</span>
            </div>
          `).join("")}
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="card-header"><h3>营销目的</h3></div>
          ${r.marketingGoalBreakdown.map((m) => `
            <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
              <span>${esc(m.goal)}</span><span style="color:var(--muted)">${m.count} (${m.percentage}%)</span>
            </div>
          `).join("")}
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="card-header"><h3>内容分类</h3></div>
          ${r.libraryDistribution.map((l) => `
            <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
              <span>${esc(l.library)}</span><span style="color:var(--muted)">${l.count} (${l.percentage}%)</span>
            </div>
          `).join("")}
        </div>
        ${hookKeys.length ? `<div class="card" style="flex:1;min-width:180px">
          <div class="card-header"><h3>标题钩子</h3></div>
          ${hookKeys.map((k) => `
            <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
              <span>${esc(k)}</span><span style="color:var(--muted)">${r.hookPatternSummary.distribution[k]}</span>
            </div>
          `).join("")}
        </div>` : ""}
      </div>
    </div>
  `;
}

document.getElementById("exportReportJsonBtn")?.addEventListener("click", () => {
  if (!_currentReport) return;
  const blob = new Blob([JSON.stringify(_currentReport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `content-report-${_currentReport.type}-${dateBJ()}.json`;
  a.click(); URL.revokeObjectURL(url);
});

document.getElementById("exportReportMdBtn")?.addEventListener("click", () => {
  if (!_currentReport) return;
  const r = _currentReport;
  const s = r.summary;
  let md = `# 内容报告：${r.period.label}\n\n`;
  md += `**生成时间：** ${r.generatedAt.slice(0, 10)}\n\n`;
  md += `## 概览\n\n`;
  md += `| 指标 | 数值 |\n|---|---|\n`;
  md += `| 笔记数 | ${s.totalNotes} |\n| 素材数 | ${s.totalAssets} |\n| 活跃作者 | ${s.activeAuthors} |\n| 活跃品牌 | ${s.activeBrands} |\n| 标题钩子率 | ${s.hookRate}% |\n| 环比变化 | ${r.comparison.noteChange}% |\n\n`;
  if (s.bestNote) md += `**最佳笔记：** ${s.bestNote.title}（${s.bestNote.brand}）— ${s.bestNote.totalInteractions} 互动\n\n`;
  md += `## Top 10 笔记\n\n`;
  md += `| # | 标题 | 品牌 | 互动 |\n|---|---|---|---|\n`;
  for (const n of r.topNotes) md += `| ${n.rank} | ${n.title} | ${n.brand} | ${n.totalInteractions} |\n`;
  md += `\n## 品牌分布\n\n| 品牌 | 笔记数 | 占比 |\n|---|---|---|\n`;
  for (const b of r.brandDistribution) md += `| ${b.brand} | ${b.count} | ${b.percentage}% |\n`;
  md += `\n## 内容类型\n\n| 类型 | 笔记数 | 占比 |\n|---|---|---|\n`;
  for (const c of r.contentTypeBreakdown) md += `| ${c.type} | ${c.count} | ${c.percentage}% |\n`;
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `content-report-${r.type}-${dateBJ()}.md`;
  a.click(); URL.revokeObjectURL(url);
});

// ===== Settings =====
const SETTINGS_TABS = [
  { id: "tab-ai", label: "AI 分析" },
  { id: "tab-crawl", label: "采集" },
  { id: "tab-download", label: "下载" },
  { id: "tab-mapping", label: "作者别名" },
  { id: "tab-notification", label: "通知" }
];

let AI_PRESETS = [];

const NAME_TOKENS = ["{index}", "{kind}", "{title}", "{author}", "{brand}", "{date}"];

function tokenLabel(t) {
  return { "{index}": "序号", "{kind}": "类型", "{title}": "标题", "{author}": "作者", "{brand}": "品牌", "{date}": "日期" }[t] || t;
}

let _settingsCache = null;

async function openSettings() {
  try {
    const [settings, presets] = await Promise.all([api("/api/settings"), api("/api/settings/ai-presets")]);
    _settingsCache = settings;
    AI_PRESETS = presets;
    renderSettingsTabs();
    showSettingsTab("tab-ai");
    $("#settingsOverlay").style.display = "flex";
  } catch (e) { alert(`加载设置失败：${e.message}`); }
}

function renderSettingsTabs() {
  const panel = $("#settingsForm");
  panel.innerHTML = `<div class="settings-layout">
    <div class="settings-nav">${SETTINGS_TABS.map((t) =>
      `<a class="settings-tab" data-tab="${t.id}">${esc(t.label)}</a>`
    ).join("")}</div>
    <div class="settings-panels">${SETTINGS_TABS.map((t) =>
      `<div class="settings-panel" id="${t.id}"></div>`
    ).join("")}</div>
  </div>
  <div class="form-footer"><button type="button" id="cancelSettings" class="ghost">取消</button><button type="submit">保存</button></div>`;

  document.querySelectorAll(".settings-tab").forEach((a) => {
    a.addEventListener("click", () => showSettingsTab(a.dataset.tab));
  });

  renderAiTab();
  renderCrawlTab();
  renderDownloadTab();
  renderMappingTab();
  renderNotificationTab();

  $("#cancelSettings").addEventListener("click", () => $("#settingsOverlay").style.display = "none");
}

function showSettingsTab(tabId) {
  document.querySelectorAll(".settings-tab").forEach((a) => a.classList.toggle("active", a.dataset.tab === tabId));
  document.querySelectorAll(".settings-panel").forEach((p) => p.classList.toggle("active", p.id === tabId));
}

// ---- AI tab ----
function renderAiTab() {
  const s = _settingsCache.ai;
  const panel = $(`#tab-ai`);
  const currentProvider = _settingsCache.ai.provider || "OpenAI";
  const preset = AI_PRESETS.find((p) => p.label === currentProvider) || AI_PRESETS[0];
  const providerOpts = AI_PRESETS.map((p) =>
    `<option value="${esc(p.label)}"${p.label === currentProvider ? " selected" : ""}>${esc(p.label)}</option>`
  ).join("");
  const modelOpts = (preset.models.length ? preset.models : ["gpt-5.4-mini", "deepseek-v4-flash"]).map((m) =>
    `<option value="${esc(m)}"${m === (s.model || "") ? " selected" : ""}>${esc(m)}</option>`
  ).join("");
  panel.innerHTML = `<div class="settings-group">
    <div class="settings-group-title">AI 提供商</div>
    <div class="settings-group-desc">选择后自动填入接口地址和可选模型</div>
    <div class="setting-item">
      <div class="setting-info"><span>服务商</span></div>
      <div class="setting-input"><select id="aiProvider" data-key="ai.provider">${providerOpts}</select></div>
    </div>
    <div class="setting-item">
      <div class="setting-info"><span>API 密钥</span></div>
      <div class="setting-input"><input type="password" id="aiApiKey" data-key="ai.apiKey" value="${esc(s.apiKey || "")}" /></div>
    </div>
    <div class="setting-item">
      <div class="setting-info"><span>接口地址</span><small>兼容 OpenAI 格式</small></div>
      <div class="setting-input"><input type="text" id="aiBaseUrl" data-key="ai.baseUrl" value="${esc(s.baseUrl || preset.baseUrl)}" /></div>
    </div>
    <div class="setting-item">
      <div class="setting-info"><span>模型</span></div>
      <div class="setting-input"><select id="aiModel" data-key="ai.model">${modelOpts}</select></div>
    </div>
  </div>
  <div class="settings-group">
    <button type="button" id="testAiBtn" class="ghost" style="margin-top:4px">测试连接</button>
    <span id="testAiResult" style="margin-left:12px;font-size:13px"></span>
  </div>`;

  document.getElementById("aiProvider")?.addEventListener("change", function () {
    const p = AI_PRESETS.find((x) => x.label === this.value);
    if (!p) return;
    const baseUrlInput = document.getElementById("aiBaseUrl");
    if (baseUrlInput && p.baseUrl) baseUrlInput.value = p.baseUrl;
    const modelSelect = document.getElementById("aiModel");
    if (modelSelect) {
      modelSelect.innerHTML = p.models.length
        ? p.models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")
        : '<option value="">自定义</option>';
    }
  });

  document.getElementById("testAiBtn")?.addEventListener("click", async function () {
    const resultEl = $("#testAiResult");
    resultEl.textContent = "测试中...";
    resultEl.style.color = "var(--text-secondary)";
    this.disabled = true;
    try {
      const res = await api("/api/settings/ai/test", { method: "POST" });
      resultEl.textContent = `✓ ${res.model}：${res.reply}`;
      resultEl.style.color = "var(--accent)";
    } catch (e) {
      resultEl.textContent = `✗ ${e.message}`;
      resultEl.style.color = "var(--red)";
    } finally { this.disabled = false; }
  });
}

// ---- Crawl tab ----
function renderCrawlTab() {
  const s = _settingsCache.xhs;
  const panel = $(`#tab-crawl`);
  panel.innerHTML = `<div class="settings-group">
    <div class="settings-group-title">浏览器与采集</div>
    ${renderBool("xhs.headless", "无头浏览器", "采集时不显示浏览器窗口", s.headless)}
    ${renderNum("xhs.maxAccountNotes", "账号最大作品数", s.maxAccountNotes)}
    ${renderNum("xhs.accountScrollPages", "滚动加载轮数", s.accountScrollPages)}
    ${renderNum("xhs.accountScrollDelayMs", "滚动等待(ms)", s.accountScrollDelayMs)}
    ${renderText("xhs.proxy", "代理地址", "如 http://127.0.0.1:10808", s.proxy)}
    ${renderText("xhs.userAgent", "User-Agent（用户代理）", "", s.userAgent)}
    ${renderText("xhs.browserExecutable", "浏览器路径", "留空自动寻找", s.browserExecutable)}
  </div>`;
}

// ---- Download tab ----
function renderDownloadTab() {
  const s = _settingsCache.download;
  const panel = $(`#tab-download`);

  function chipEditor(id, label, currentFormat, dataKey) {
    const tokenRegex = /\{[^}]+\}/g;
    const parts = [];
    let lastIdx = 0;
    let match;
    while ((match = tokenRegex.exec(currentFormat)) !== null) {
      if (match.index > lastIdx) parts.push({ type: "text", value: currentFormat.slice(lastIdx, match.index) });
      parts.push({ type: "token", value: match[0] });
      lastIdx = tokenRegex.lastIndex;
    }
    if (lastIdx < currentFormat.length) parts.push({ type: "text", value: currentFormat.slice(lastIdx) });

    const chipHtml = parts.map((p) =>
      p.type === "token"
        ? `<span class="name-chip" data-token="${esc(p.value)}">${esc(tokenLabel(p.value))}<span class="chip-remove" data-token="${esc(p.value)}">✕</span></span>`
        : `<span class="name-text">${esc(p.value)}</span>`
    ).join("");

    const addTokenOpts = NAME_TOKENS.map((t) =>
      `<option value="${esc(t)}">${esc(tokenLabel(t))} ${esc(t)}</option>`
    ).join("");

    return `
<div class="setting-item">
  <div class="setting-info"><span>${esc(label)}</span><small>${esc(dataKey === "download.folderNameFormat" ? "决定每条笔记的文件夹名" : "决定文件夹内每个文件的文件名")}</small></div>
  <div class="name-preview" id="${id}Preview">${chipHtml}</div>
</div>
<div class="setting-item">
  <div class="setting-input" style="display:flex;gap:4px;flex-wrap:wrap">
    <select id="${id}AddSelect" style="width:120px">${addTokenOpts}</select>
    <button type="button" class="ghost sm" data-template-add="${id}">＋ 添加</button>
  </div>
</div>
<input type="hidden" id="${id}Hidden" data-key="${esc(dataKey)}" value="${esc(currentFormat)}" />
`;
  }

  function updateChipEditor(id, dataKey) {
    const hidden = document.getElementById(`${id}Hidden`);
    if (!hidden) return;
    const next = hidden.value;
    const tokenRegex = /\{[^}]+\}/g;
    const parts = [];
    let lastIdx = 0;
    let match;
    while ((match = tokenRegex.exec(next)) !== null) {
      if (match.index > lastIdx) parts.push({ type: "text", value: next.slice(lastIdx, match.index) });
      parts.push({ type: "token", value: match[0] });
      lastIdx = tokenRegex.lastIndex;
    }
    if (lastIdx < next.length) parts.push({ type: "text", value: next.slice(lastIdx) });
    const preview = document.getElementById(`${id}Preview`);
    if (preview) {
      preview.innerHTML = parts.map((p) =>
        p.type === "token"
          ? `<span class="name-chip" data-token="${esc(p.value)}">${esc(tokenLabel(p.value))}<span class="chip-remove" data-token="${esc(p.value)}">✕</span></span>`
          : `<span class="name-text">${esc(p.value)}</span>`
      ).join("");
      preview.querySelectorAll(".chip-remove").forEach((btn) => {
        btn.addEventListener("click", function () {
          const hid = document.getElementById(`${id}Hidden`);
          if (!hid) return;
          hid.value = hid.value.replace(this.dataset.token, "").replace(/\s+/g, " ").trim();
          updateChipEditor(id, dataKey);
        });
      });
    }
  }

  const folderFmt = s.folderNameFormat || "{noteId}";
  const fileFmt = s.nameFormat || "{index}-{kind}";

  panel.innerHTML = `<div class="settings-group">
    <div class="settings-group-title">素材目录</div>
    <div class="setting-item">
      <div class="setting-info"><span>保存路径</span><small>相对路径保存到 data/ 下，绝对路径如 D:\\素材</small></div>
      <div class="setting-input" style="display:flex;gap:4px">
        <input type="text" data-key="download.folderName" value="${esc(s.folderName)}" style="flex:1" />
        <button type="button" class="ghost sm" id="folderBrowseBtn">浏览…</button>
        <input type="file" id="folderPicker" webkitdirectory style="display:none" />
      </div>
    </div>
  </div>

  <div class="settings-group">
    <div class="settings-group-title">文件夹命名</div>
    ${chipEditor("folderName", "文件夹字段", folderFmt, "download.folderNameFormat")}
  </div>

  <div class="settings-group">
    <div class="settings-group-title">文件命名</div>
    ${chipEditor("fileName", "文件字段", fileFmt, "download.nameFormat")}
  </div>

  <div class="settings-group">
    <div class="settings-group-title">下载开关</div>
    ${renderBool("download.imageDownload", "下载图片", "", s.imageDownload)}
    ${renderBool("download.videoDownload", "下载视频", "", s.videoDownload)}
    ${renderBool("download.liveDownload", "下载 Live 图", "", s.liveDownload)}
    ${renderBool("download.skipExistingFiles", "跳过已有文件", "", s.skipExistingFiles)}
    ${renderBool("download.writeMtime", "修改时间 → 发布时间", "", s.writeMtime)}
  </div>

  <div class="settings-group">
    <div class="settings-group-title">图片</div>
    ${renderSelect("download.imageFormat", "保存格式", ["AUTO", "JPEG", "PNG", "WEBP"], s.imageFormat)}
    ${renderNum("download.imageQuality", "图片质量 (1-100)", s.imageQuality)}
  </div>

  <div class="settings-group">
    <div class="settings-group-title">视频</div>
    ${renderSelect("download.videoPreference", "择优策略", ["resolution", "bitrate", "size"], s.videoPreference, { "resolution": "分辨率优先（同分辨率选高码率）", "bitrate": "码率优先", "size": "文件大小优先" })}
    ${renderSelect("download.videoMinHeight", "最低分辨率", ["0", "480", "720", "1080", "2160"], String(s.videoMinHeight || 0))}
  </div>

  <div class="settings-group">
    <div class="settings-group-title">重试与超时</div>
    ${renderNum("download.maxRetry", "重试次数", s.maxRetry)}
    ${renderNum("download.intervalMs", "下载间隔(ms)", s.intervalMs)}
    ${renderNum("download.timeoutMs", "超时(ms)", s.timeoutMs)}
  </div>`;

  ["folderName", "fileName"].forEach((id) => {
    // Wire add buttons
    document.querySelectorAll(`[data-template-add="${id}"]`).forEach((btn) => {
      btn.addEventListener("click", () => {
        const sel = document.getElementById(`${id}AddSelect`);
        if (!sel || !sel.value) return;
        const hid = document.getElementById(`${id}Hidden`);
        if (!hid) return;
        const sep = hid.value && !hid.value.endsWith("-") && !hid.value.endsWith(" ") ? "-" : "";
        hid.value = hid.value + sep + sel.value;
        updateChipEditor(id, hid.dataset.key);
      });
    });
    // Wire chip remove (initial render)
    document.querySelectorAll(`#${id}Preview .chip-remove`).forEach((btn) => {
      btn.addEventListener("click", function () {
        const hid = document.getElementById(`${id}Hidden`);
        if (!hid) return;
        hid.value = hid.value.replace(this.dataset.token, "").replace(/\s+/g, " ").trim();
        updateChipEditor(id, hid.dataset.key);
      });
    });
  });

  document.getElementById("folderBrowseBtn")?.addEventListener("click", () => {
    document.getElementById("folderPicker")?.click();
  });
  document.getElementById("folderPicker")?.addEventListener("change", function () {
    if (this.files?.[0]?.path) {
      const dir = this.files[0].path.replace(/\\[^\\]+$/, "");
      const input = document.querySelector('[data-key="download.folderName"]');
      if (input) { input.value = dir; input.dispatchEvent(new Event("input", { bubbles: true })); }
    }
  });
}

// ---- Mapping tab ----
function renderMappingTab() {
  const s = _settingsCache.xhs?.mappingData || {};
  const lines = Object.entries(s).map(([k, v]) => `${k} = ${v}`).join("\n");
  const panel = $(`#tab-mapping`);
  panel.innerHTML = `<div class="settings-group">
    <div class="settings-group-title">作者别名映射</div>
    <div class="settings-group-desc">每行一条：作者ID = 别名。设置后下载时文件夹命名自动使用别名</div>
    <div class="setting-item">
      <div class="setting-info"><span>映射表</span></div>
      <div class="setting-input" style="width:100%">
        <textarea data-key="xhs.mappingData" rows="6" style="width:100%;min-width:280px;font-family:monospace">${esc(lines)}</textarea>
      </div>
    </div>
  </div>`;
}

// ---- Notification tab ----
function renderNotificationTab() {
  const s = _settingsCache.notification || {};
  const panel = $("#tab-notification");
  const platforms = [
    { value: "feishu", label: "飞书" },
    { value: "dingtalk", label: "钉钉" },
    { value: "wecom", label: "企业微信" }
  ];
  const opts = platforms.map(p => `<option value="${p.value}"${p.value === (s.webhookPlatform || "feishu") ? " selected" : ""}>${p.label}</option>`).join("");
  panel.innerHTML = `<div class="settings-group">
    <div class="settings-group-title">采集通知</div>
    <div class="settings-group-desc">采集/追踪完成后发送通知到 webhook</div>
    <div class="setting-item" style="flex-wrap:wrap"> 
      <div class="setting-info" style="flex:auto;min-width:200px"><span>Webhook URL <small style="display:inline;font-size:11px;color:var(--text-muted);margin-left:4px">飞书/钉钉/企微机器人 webhook 地址</small></span></div>
      <div class="setting-input" style="flex:1;min-width:280px"><input type="text" data-key="notification.webhookUrl" style="width:100%;font-size:12px;font-family:monospace" value="${esc(s.webhookUrl || "")}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." /></div>
    </div>
    <div class="setting-item">
      <div class="setting-info"><span>平台</span></div>
      <div class="setting-input"><select data-key="notification.webhookPlatform">${opts}</select></div>
    </div>
    <div class="setting-item">
      <div class="setting-info"><span>测试</span></div>
      <div class="setting-input"><button type="button" id="testWebhookBtn" class="ghost sm">发送测试通知</button><span id="testWebhookResult" style="margin-left:8px;font-size:12px"></span></div>
    </div>
  </div>`;
  document.getElementById("testWebhookBtn")?.addEventListener("click", async () => {
    const el = $("#testWebhookResult");
    el.textContent = "发送中...";
    try {
      const r = await api("/api/webhook/test", { method: "POST", body: JSON.stringify({ url: document.querySelector('[data-key="notification.webhookUrl"]')?.value, platform: document.querySelector('[data-key="notification.webhookPlatform"]')?.value }) });
      el.textContent = r.ok ? "✅ 发送成功" : "❌ 发送失败";
    } catch (e) { el.textContent = "❌ " + e.message; }
  });
}

// ---- Helpers ----
function renderBool(key, label, desc, val) {
  return `<div class="setting-item">
    <div class="setting-info"><span>${esc(label)}</span>${desc ? `<small>${esc(desc)}</small>` : ""}</div>
    <div class="setting-input"><input type="checkbox" data-key="${esc(key)}" ${val ? "checked" : ""} /></div>
  </div>`;
}

function renderNum(key, label, val) {
  return `<div class="setting-item">
    <div class="setting-info"><span>${esc(label)}</span></div>
    <div class="setting-input"><input type="number" data-key="${esc(key)}" value="${esc(String(val ?? ""))}" /></div>
  </div>`;
}

function renderText(key, label, desc, val) {
  return `<div class="setting-item">
    <div class="setting-info"><span>${esc(label)}</span>${desc ? `<small>${esc(desc)}</small>` : ""}</div>
    <div class="setting-input"><input type="text" data-key="${esc(key)}" value="${esc(String(val ?? ""))}" /></div>
  </div>`;
}

function renderSelect(key, label, opts, val, labels) {
  const o = opts.map((v) => `<option value="${esc(v)}"${String(v) === String(val) ? " selected" : ""}>${esc(labels?.[v] || v)}</option>`).join("");
  return `<div class="setting-item">
    <div class="setting-info"><span>${esc(label)}</span></div>
    <div class="setting-input"><select data-key="${esc(key)}">${o}</select></div>
  </div>`;
}

// ---- Read form and submit ----
function readSettingsForm() {
  const r = { xhs: {}, download: {}, ai: {}, notification: {} };
  document.querySelectorAll("[data-key]").forEach((el) => {
    const parts = el.dataset.key.split(".");
    const section = parts[0];
    const field = parts.slice(1).join(".");
    const t = section === "xhs" ? r.xhs : section === "ai" ? r.ai : section === "notification" ? r.notification : r.download;
    if (el.type === "checkbox") t[field] = el.checked;
    else if (el.tagName === "TEXTAREA" && field === "mappingData") {
      const map = {};
      el.value.split("\n").forEach((line) => {
        const s = line.trim();
        if (!s) return;
        const idx = s.indexOf("=");
        if (idx > 0) map[s.slice(0, idx).trim()] = s.slice(idx + 1).trim();
      });
      t[field] = map;
    } else if (el.tagName === "SELECT") t[field] = el.value;
    else t[field] = el.type === "number" ? Number(el.value) : el.value;
  });
  delete r.xhs.cookie;
  return r;
}

  $("#closeSettingsBtn").addEventListener("click", () => $("#settingsOverlay").style.display = "none");
  $("#settingsOverlay").addEventListener("click", (e) => { if (e.target === $("#settingsOverlay")) $("#settingsOverlay").style.display = "none"; });
$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(readSettingsForm()) });
    $("#settingsOverlay").style.display = "none";
  } catch (err) { alert(`保存失败：${err.message}`); }
});

// ===== Notifications =====
let notifPollTimer = null;

async function loadNotifications() {
  try {
    const { items, unread } = await api("/api/notifications");
    const badge = $("#notifBadge");
    if (badge) {
      if (unread > 0) { badge.style.display = "inline"; badge.textContent = unread > 99 ? "99+" : unread; }
      else { badge.style.display = "none"; }
    }
    const list = $("#notifList");
    if (list && list.closest(".notif-panel")?.style.display === "block") {
      if (!items.length) {
        list.innerHTML = '<p class="muted" style="text-align:center;padding:20px">暂无通知</p>';
      } else {
        list.innerHTML = items.map((n) => `<div class="notif-item ${n.read ? "" : "unread"}" data-id="${esc(n.id)}">
          <div class="notif-item-dot ${n.level === "error" ? "red" : n.level === "warning" ? "orange" : "green"}"></div>
          <div class="notif-item-body">
            <div class="notif-item-title">${esc(n.title)}</div>
            ${n.message ? `<div class="notif-item-msg">${esc(n.message)}</div>` : ""}
            <div class="notif-item-time">${fmtBJ(n.created_at)}</div>
          </div>
          ${n.read ? "" : `<button class="notif-item-mark" data-notif-read="${esc(n.id)}">✓</button>`}
        </div>`).join("");
        list.querySelectorAll("[data-notif-read]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await api(`/api/notifications/${btn.dataset.notifRead}/read`, { method: "POST", body: "{}" });
            loadNotifications();
          });
        });
      }
    }
  } catch { /* ignore */ }
}

function startNotifPolling() {
  if (notifPollTimer) return;
  loadNotifications();
  notifPollTimer = setInterval(loadNotifications, 30000);
}

$("#sidebarNotifications")?.addEventListener("click", (e) => {
  e.preventDefault();
  const panel = $("#notifPanel");
  panel.style.display = panel.style.display === "block" ? "none" : "block";
  if (panel.style.display === "block") loadNotifications();
});

$("#notifClose")?.addEventListener("click", () => { $("#notifPanel").style.display = "none"; });
$("#notifMarkAllRead")?.addEventListener("click", async () => {
  await api("/api/notifications/read-all", { method: "POST", body: "{}" });
  loadNotifications();
});

// Start polling on page load
startNotifPolling();

// ===== Export =====
// ===== Export (removed Eagle) =====

// ===== View Toggle & Batch Operations =====
// Sync viewMode with select on initial load
if ($("#viewModeSelect")) {
  $("#viewModeSelect").value = state.viewMode;
}

function showToast(msg, type = "success") {
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;top:16px;right:16px;z-index:9999;padding:12px 20px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15);background:${type === "error" ? "#fef2f2" : "#f0fdf4"};color:${type === "error" ? "#991b1b" : "#166534"};transition:opacity 0.3s`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3000);
}

$("#batchDeleteBtn")?.addEventListener("click", async () => {
  const ids = [...state.selectedIds];
  if (!ids.length || !confirm(`确认删除 ${ids.length} 条笔记及其素材？`)) return;
  try {
    const r = await api("/api/notes/batch-delete", { method: "POST", body: JSON.stringify({ ids }) });
    clearSelection();
    await refresh();
    showToast(`✅ 已删除 ${r.deleted} 条笔记`);
  } catch (e) { showToast(`❌ ${e.message}`, "error"); }
});

$("#batchExportBtn")?.addEventListener("click", renderBatchExportModal);

$("#batchClearBtn")?.addEventListener("click", clearSelection);
$("#batchTagBtn")?.addEventListener("click", renderBatchTagModal);
$("#batchBrandBtn")?.addEventListener("click", renderBatchBrandModal);
$("#batchLibraryBtn")?.addEventListener("click", renderBatchLibraryModal);

// ===== Batch Tag / Brand =====
function renderBatchTagModal() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const existing = document.getElementById("batchTagOverlay");
  if (existing) existing.remove();
  // Collect frequent tags from all notes
  const freq = {};
  for (const n of state.notes) {
    for (const t of (n.tags || [])) { if (t) freq[t] = (freq[t] || 0) + 1; }
  }
  const topTags = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const freqHtml = topTags.length ? `<div style="margin:8px 0 4px;font-size:12px;color:var(--text-muted)">常用标签（点击添加）：</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${topTags.map(([tag]) => `<span class="freq-tag" data-tag="${esc(tag)}" style="cursor:pointer;padding:2px 8px;border-radius:999px;font-size:11px;background:var(--line-light);color:var(--text-secondary);transition:all 0.15s">${esc(tag)}</span>`).join("")}</div>` : "";
  const div = document.createElement("div");
  div.id = "batchTagOverlay";
  div.className = "overlay";
  div.innerHTML = `<div class="overlay-panel" style="max-width:440px">
    <div class="overlay-head"><h2>批量打标签（${ids.length} 条）</h2><button class="btn-icon" id="closeBatchTag">✕</button></div>
    <div class="form-group"><label>标签（逗号分隔）</label><input id="batchTagInput" placeholder="如：爆款、美妆、2025" /></div>
    ${freqHtml}
    <div class="form-footer"><button class="ghost" id="cancelBatchTag">取消</button><button id="saveBatchTag">保存</button></div>
  </div>`;
  document.body.appendChild(div);
  div.addEventListener("click", (e) => { if (e.target === div) div.remove(); });
  div.querySelectorAll(".freq-tag").forEach(el => {
    el.addEventListener("click", () => {
      const input = document.getElementById("batchTagInput");
      const existing = input.value.split(",").map(s => s.trim()).filter(Boolean);
      if (!existing.includes(el.dataset.tag)) {
        input.value = [...existing, el.dataset.tag].join(", ");
      }
      input.focus();
    });
  });
  document.getElementById("closeBatchTag").addEventListener("click", () => div.remove());
  document.getElementById("cancelBatchTag").addEventListener("click", () => div.remove());
  document.getElementById("saveBatchTag").addEventListener("click", async () => {
    const input = document.getElementById("batchTagInput");
    const tags = input.value.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      const tagBtn = document.getElementById("batchTagBtn");
      if (tagBtn) { tagBtn.disabled = true; tagBtn.textContent = "保存中…"; }
      const r = await api("/api/notes/batch/tags", { method: "POST", body: JSON.stringify({ ids, tags }) });
      div.remove();
      clearSelection();
      await refresh();
      showToast(`✅ 已更新 ${r.updated} 条标签`);
    } catch (e) { showToast(`❌ ${e.message}`, "error"); }
  });
}

function renderBatchBrandModal() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const existing = document.getElementById("batchBrandOverlay");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "batchBrandOverlay";
  div.className = "overlay";
  div.innerHTML = `<div class="overlay-panel" style="max-width:440px">
    <div class="overlay-head"><h2>批量移动品牌（${ids.length} 条）</h2><button class="btn-icon" id="closeBatchBrand">✕</button></div>
    <div class="form-group"><label>目标品牌</label><input id="batchBrandInput" placeholder="输入品牌名称" /></div>
    <div class="form-footer"><button class="ghost" id="cancelBatchBrand">取消</button><button id="saveBatchBrand">保存</button></div>
  </div>`;
  document.body.appendChild(div);
  div.addEventListener("click", (e) => { if (e.target === div) div.remove(); });
  document.getElementById("closeBatchBrand").addEventListener("click", () => div.remove());
  document.getElementById("cancelBatchBrand").addEventListener("click", () => div.remove());
  document.getElementById("saveBatchBrand").addEventListener("click", async () => {
    const brand = document.getElementById("batchBrandInput").value.trim();
    if (!brand) return;
    try {
      const r = await api("/api/notes/batch/brand", { method: "POST", body: JSON.stringify({ ids, brand }) });
      div.remove();
      clearSelection();
      await refresh();
      showToast(`✅ 已移动 ${r.updated} 条笔记到「${brand}」`);
    } catch (e) { showToast(`❌ ${e.message}`, "error"); }
  });
}

function renderBatchLibraryModal() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const existing = document.getElementById("batchLibOverlay");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "batchLibOverlay";
  div.className = "overlay";
  div.innerHTML = `<div class="overlay-panel" style="max-width:440px">
    <div class="overlay-head"><h2>批量分类（${ids.length} 条）</h2><button class="btn-icon" id="closeBatchLib">✕</button></div>
    <div class="form-group"><label>内容分类</label>
      <select id="batchLibSelect">
        <option value="">清除分类</option>
        <option value="选题库">选题库</option>
        <option value="脚本模板库">脚本模板库</option>
        <option value="视觉参考库">视觉参考库</option>
        <option value="营销话术库">营销话术库</option>
      </select>
    </div>
    <div class="form-footer"><button class="ghost" id="cancelBatchLib">取消</button><button id="saveBatchLib">保存</button></div>
  </div>`;
  document.body.appendChild(div);
  div.addEventListener("click", (e) => { if (e.target === div) div.remove(); });
  document.getElementById("closeBatchLib").addEventListener("click", () => div.remove());
  document.getElementById("cancelBatchLib").addEventListener("click", () => div.remove());
  document.getElementById("saveBatchLib").addEventListener("click", async () => {
    const libraryType = document.getElementById("batchLibSelect").value;
    try {
      const r = await api("/api/notes/batch/library", { method: "POST", body: JSON.stringify({ ids, libraryType }) });
      div.remove();
      clearSelection();
      await refresh();
      showToast(`✅ 已分类 ${r.updated} 条笔记`);
    } catch (e) { showToast(`❌ ${e.message}`, "error"); }
  });
}

// Enhanced export with format selection
async function renderBatchExportModal() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const existing = document.getElementById("batchExportOverlay");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "batchExportOverlay";
  div.className = "overlay";
  div.innerHTML = `<div class="overlay-panel" style="max-width:440px">
    <div class="overlay-head"><h2>导出选中（${ids.length} 条）</h2><button class="btn-icon" id="closeBatchExport">✕</button></div>
    <div class="form-group"><label>导出格式</label>
      <select id="exportFormat">
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
      </select>
    </div>
    <div class="form-footer"><button class="ghost" id="cancelBatchExport">取消</button><button id="saveBatchExport">导出</button></div>
  </div>`;
  document.body.appendChild(div);
  div.addEventListener("click", (e) => { if (e.target === div) div.remove(); });
  document.getElementById("closeBatchExport").addEventListener("click", () => div.remove());
  document.getElementById("cancelBatchExport").addEventListener("click", () => div.remove());
  document.getElementById("saveBatchExport").addEventListener("click", async () => {
    const format = document.getElementById("exportFormat").value;
    const exportBtn = document.getElementById("saveBatchExport");
    exportBtn.disabled = true;
    exportBtn.textContent = "导出中…";
    try {
      if (format === "csv") {
        const r = await fetch("/api/notes/batch/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, format: "csv" })
        });
        if (!r.ok) throw new Error("导出失败");
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `笔记导出_${dateBJ()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await api("/api/notes/batch/export", { method: "POST", body: JSON.stringify({ ids, format: "json" }) });
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `笔记导出_${dateBJ()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      div.remove();
    } catch (e) { showToast(`❌ ${e.message}`, "error"); exportBtn.disabled = false; exportBtn.textContent = "导出"; }
  });
}

// ===== Logs =====
async function renderLogs() {
  const list = $("#logList");
  try {
    const data = await api("/api/logs");
    if (!data.lines || !data.lines.length) {
      list.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>暂无日志</p></div>';
      return;
    }
    list.innerHTML = data.lines.map((line) => {
      const match = line.match(/^\[(.+?)\]\s*\[(\w+)\]\s*(.+)$/);
      if (!match) return `<div class="log-line log-level-info">${esc(line)}</div>`;
      const [, time, level, msg] = match;
      const levelClass = `log-level-${level.toLowerCase()}`;
      return `<div class="log-line ${levelClass}"><span class="log-time">${esc(time)}</span> <span class="log-level-tag">${esc(level)}</span> <span class="log-msg">${esc(msg)}</span></div>`;
    }).join("");
  } catch { list.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>加载日志失败</p></div>'; }
}

$("#logRefreshBtn").addEventListener("click", renderLogs);
$("#logClearBtn").addEventListener("click", async () => {
  if (!confirm("确定清空日志？此操作不可恢复")) return;
  try {
    await api("/api/logs", { method: "DELETE" });
    renderLogs();
  } catch (e) { alert(`清空失败：${e.message}`); }
});
let _logSearchTimer = null;
$("#logSearch").addEventListener("input", function () {
  clearTimeout(_logSearchTimer);
  _logSearchTimer = setTimeout(async () => {
    const q = this.value.trim();
    if (!q) return renderLogs();
    try {
      const data = await api(`/api/logs/search?q=${encodeURIComponent(q)}`);
      const list = $("#logList");
      if (!data.lines || !data.lines.length) {
        list.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>未找到匹配日志</p></div>';
        return;
      }
      list.innerHTML = data.lines.map((line) => {
        const match = line.match(/^\[(.+?)\]\s*\[(\w+)\]\s*(.+)$/);
        if (!match) return `<div class="log-line log-level-info">${esc(line)}</div>`;
        const [, time, level, msg] = match;
        return `<div class="log-line log-level-${level.toLowerCase()}"><span class="log-time">${esc(time)}</span> <span class="log-level-tag">${esc(level)}</span> <span class="log-msg">${esc(msg)}</span></div>`;
      }).join("");
    } catch { /* ignore */ }
  }, 300);
});

// ===== Search & Filter =====
$("#searchInput").addEventListener("input", () => { resetRenderLimit(); clearSelection(); renderNotes(); });
$("#brandFilter").addEventListener("change", () => { resetRenderLimit(); clearSelection(); renderNotes(); });
$("#contentTypeFilter").addEventListener("change", () => { resetRenderLimit(); clearSelection(); renderNotes(); });

// ===== Library Tab =====
document.querySelectorAll(".lib-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".lib-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.activeLibTab = tab.dataset.libTab;
    resetRenderLimit();
    clearSelection();
    renderNotes();
  });
});

// ===== View Mode =====
$("#viewModeSelect")?.addEventListener("change", () => {
  state.viewMode = $("#viewModeSelect").value;
  resetRenderLimit();
  renderNotes();
});

// ===== Select Mode =====
$("#selectModeBtn")?.addEventListener("click", () => {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) clearSelection();
  renderNotes();
  const btn = $("#selectModeBtn");
  if (btn) btn.textContent = state.selectMode ? "☑ 取消选择" : "☐ 选择";
});

// ===== Refresh =====
async function refresh() {
  const [accounts, notes, followed] = await Promise.all([api("/api/accounts"), api("/api/notes"), api("/api/follow/accounts")]);
  state.accounts = accounts;
  state.notes = notes;
  state.followedAccounts = followed;
  renderAccounts();
  renderFilters();
  resetRenderLimit();
  renderNotes();
}

loadRecentBrands();
refresh().catch((e) => { $("#crawlStatus").textContent = `初始化失败：${e.message}`; });

// ===== Image Lightbox =====
document.addEventListener("click", (e) => {
  const thumb = e.target.closest(".nc-thumb");
  if (!thumb || !thumb.src) return;
  const existing = document.getElementById("lightbox");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "lightbox";
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `<div class="lightbox-bg"></div><img class="lightbox-img" src="${esc(thumb.src)}" alt="" /><button class="lightbox-close">✕</button>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".lightbox-bg").addEventListener("click", () => overlay.remove());
  overlay.querySelector(".lightbox-close").addEventListener("click", () => overlay.remove());
  document.addEventListener("keydown", function onEsc(e2) { if (e2.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onEsc); } });
});

// ===== Skeleton for Notes Grid =====
function showSkeleton(container, count = 6) {
  container.className = "lib-grid";
  container.innerHTML = Array(count).fill(`
    <div class="lib-card sk">
      <div class="lib-card-cover sk-cover"></div>
      <div class="lib-card-body">
        <div class="sk-line sk-title"></div>
        <div class="sk-line sk-meta"></div>
        <div class="sk-line sk-tags"></div>
      </div>
    </div>
  `).join("");
}

// ===== Floating Batch Bar (already inline, add float behavior via CSS) =====
