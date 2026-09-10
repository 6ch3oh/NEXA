"use strict";

const TOKEN = document.querySelector('meta[name="creator-ops-token"]').content;
const API = "/api/v1";
const state = { bootstrap: null, pageData: null, route: null, worksGrid: 9, selectedMedia: null };
const pageTitles = {
  dashboard: "总览", works: "作品", queue: "工作队列", content: "内容",
  accounts: "账号", assets: "素材", reviews: "审核",
  publishing: "发布", research: "研究", health: "运行状态",
};
const navIcons = { dashboard: "▦", works: "▦", queue: "☷", content: "▤", accounts: "◎", assets: "◇", reviews: "✓", publishing: "↗", research: "⌕", health: "＋" };

const DISPLAY_LABELS = {
  PENDING: "待处理", READY: "已就绪", BLOCKED: "已阻塞", PASS: "已通过", FAIL: "失败",
  HEALTHY: "正常", UNHEALTHY: "异常", SUCCESS: "成功", SUCCEEDED: "已完成", VERIFIED: "已验证",
  PUBLISHED: "已发布", APPROVE: "批准", APPROVED: "已批准", REJECT: "拒绝", REJECTED: "已拒绝",
  REQUEST_CHANGE: "请求修改", REQUEST_CHANGES: "请求修改", VALIDATION_FAILED: "验证失败",
  RECOVERY_REQUIRED: "需要恢复", UNKNOWN: "未知", DEGRADED: "运行降级", NOT_READY: "未就绪",
  ACTIVE: "进行中", OPEN: "待处理", RUNNING: "运行中", STOPPED: "已停止", CREATED: "已创建",
  STARTING: "正在启动", STOPPING: "正在停止", ERROR: "异常", IDEA: "构思中", DRAFT: "草稿",
  ASSET_PREPARATION: "素材准备", IN_REVIEW: "审核中", READY_TO_PUBLISH: "待发布", REVIEWED: "已复盘",
  NONE: "无", NOT_AVAILABLE: "暂不可用", COMPATIBLE: "兼容", INCOMPATIBLE: "不兼容",
  REQUIRED: "必需", OPTIONAL: "可选", TODO: "待处理", IN_PROGRESS: "处理中", DONE: "已完成",
  CANCELLED: "已取消", CONTENT: "内容", ASSET: "素材", VISUAL: "视觉", PACKAGE: "发布包",
  PUBLISH_PREP: "发布准备", IMAGE: "图片", VIDEO: "视频", MANAGED: "已归档", EXTERNAL: "外部文件",
  MISSING: "原文件位置已变化", PENDING_HUMAN_VISUAL_REVIEW: "等待人工视觉审核",
  LOCAL_FILE: "本地文件", USER_NOTE: "用户笔记", IMPORTED_RESEARCH: "导入研究",
  LEGACY_RESEARCH: "历史研究", FUTURE_RADAR_HANDOFF: "信息雷达交接",
  AUTOMATIC_PUBLISHING_DISABLED: "自动发布已关闭", NETWORK_DISABLED: "网络能力已关闭",
  URGENT: "紧急", HIGH: "高", NORMAL: "普通", LOW: "低",
  WRITE_DRAFT: "撰写草稿", PREPARE_ASSETS: "准备素材", GENERATE_ASSET: "生成素材",
  SUBMIT_ASSET: "提交素材", VERIFY_ASSET: "验证素材", VISUAL_REVIEW: "视觉审核",
  REVIEW_CONTENT: "审核内容", REVISE_DRAFT: "修改草稿", MANUAL_PUBLISH: "人工发布",
  BACKFILL_METRICS: "回填表现", REVIEW_PERFORMANCE: "复盘表现", RESOLVE_BLOCKER: "解除阻塞",
  RESEARCH: "研究", QA: "质检", PRIMARY_CARD: "主画面卡片", VIDEO_COVER: "视频封面",
  COVER: "封面", INFOGRAPHIC: "信息图", KNOWLEDGE_CARD: "知识卡片", SECONDARY_CARD: "辅助卡片",
  TOPIC: "选题", METRICS_BACKFILL: "表现回填", POST_PUBLISH_REVIEW: "发布后复盘",
  ARTICLE: "文章", SHORT_VIDEO: "短视频", IMAGE_POST: "图文内容", LONG_VIDEO: "长视频", OTHER: "其他",
  SCREENSHOT: "截图", RAW_MATERIAL: "原始素材", GENERATED_VISUAL: "生成视觉素材",
  REFERENCE_MATERIAL: "参考素材", PROMPT_ARTIFACT: "提示词资料", INACTIVE: "未启用",
  PAUSED: "已暂停", ARCHIVED: "已归档", CHANGES_REQUESTED: "请求修改", NOT_REQUIRED: "无需审核",
  NEEDS_REVIEW: "需要审核", PLANNED: "已计划", AVAILABLE: "可用", REFERENCE_ONLY: "仅供参考",
  HUMAN_CREATED: "人工创作", AI_ASSISTED: "AI 辅助", IMPORTED: "已导入", CAPTURED: "已采集",
  FAILED_MANUAL: "人工发布失败", MANUAL: "人工", COMPLETE: "已完成", NEEDED: "需要准备",
  READY_FOR_GENERATION: "可以生成", WAITING_FOR_ASSET: "等待素材", SUBMITTED: "已提交",
  VALID: "有效", METADATA_PARTIAL: "元数据不完整", INVALID: "无效", ACTIVATED: "已启用",
};
const ACTION_LABELS = {
  "Open Editorial Decision": "进行人工业务审核",
  "Run Content QA": "运行内容质检",
  "Run Asset QA": "运行素材质检",
  "Record Manual Publish": "记录人工发布",
  "Metrics Backfill": "回填表现数据",
  "Post-publish Review": "完成发布后复盘",
  "Generate required visual assets": "生成所需视觉素材",
  "Review content": "审核内容",
  "Revise rejected content": "修改被退回的内容",
  "Backfill metrics": "回填表现数据",
  "Review performance": "复盘内容表现",
};
const ENUM_PATTERN = /^[A-Z][A-Z0-9_.\/-]*$/;

const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const text = (value, fallback = "—") => value === null || value === undefined || value === "" ? fallback : esc(value);
const arr = value => Array.isArray(value) ? value : [];
const formatTime = value => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const pretty = value => JSON.stringify(value, null, 2);
const enumFallback = value => {
  if (/PENDING|WAIT|TODO/.test(value)) return "待处理";
  if (/READY|PASS|SUCCESS|VERIFIED|APPROV|COMPATIBLE|HEALTHY/.test(value)) return "正常";
  if (/BLOCK|FAIL|ERROR|INVALID|INCOMPATIBLE|UNHEALTHY/.test(value)) return "异常";
  if (/RUNNING|ACTIVE|OPEN|IN_PROGRESS/.test(value)) return "进行中";
  if (/REVIEW/.test(value)) return "审核中";
  if (/PUBLISH/.test(value)) return "发布处理中";
  if (/ASSET|MEDIA/.test(value)) return "素材处理";
  if (/NONE|DISABLED/.test(value)) return "无";
  return "已记录";
};
const displayLabel = value => {
  const raw = String(value ?? "");
  if (!raw) return "—";
  if (/^[AB][1-3]$/.test(raw) || /^P[0-3]$/.test(raw)) return raw;
  if (DISPLAY_LABELS[raw]) return DISPLAY_LABELS[raw];
  if (ENUM_PATTERN.test(raw)) return enumFallback(raw);
  return raw;
};
const actionLabel = value => {
  const raw = String(value ?? "");
  return ACTION_LABELS[raw] || (ENUM_PATTERN.test(raw) ? displayLabel(raw) : raw || "查看下一步");
};
const safeReason = value => {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  if (DISPLAY_LABELS[raw] || ENUM_PATTERN.test(raw)) return displayLabel(raw);
  return /[\u3400-\u9fff]/.test(raw) ? raw : "存在业务阻塞，请查看相关内容与审核状态";
};
const friendlyError = error => {
  const raw = String(error?.message || "");
  if (/Failed to fetch|NetworkError|fetch/i.test(raw)) return "无法连接本机服务，请确认高级管理仍在运行";
  if (/not found|missing/i.test(raw)) return "目标记录或本地文件不存在";
  if (/forbidden|invalid.*token|origin/i.test(raw)) return "本次操作未通过本机安全校验，请刷新页面后重试";
  if (/conflict|already exists|collision/i.test(raw)) return "目标位置存在同名内容，操作已安全停止";
  return /[\u3400-\u9fff]/.test(raw) ? raw : "操作未完成，请刷新后重试";
};
const statusClass = value => {
  const normalized = String(value || "neutral").toLowerCase();
  if (["pass", "healthy", "ready", "success", "succeeded", "verified", "published", "approve", "approved"].includes(normalized)) return "success";
  if (["fail", "unhealthy", "blocked", "rejected", "validation_failed", "recovery_required"].includes(normalized)) return "danger";
  if (["pending", "unknown", "degraded", "not_ready", "request_change", "request_changes"].includes(normalized)) return "warning";
  if (["active", "open", "running", "asset_preparation", "draft", "in_review"].includes(normalized)) return "info";
  return "neutral";
};
const chip = value => `<span class="status-chip ${statusClass(value)}">${esc(displayLabel(value))}</span>`;
const tag = value => `<span class="tag ${statusClass(value)}">${esc(displayLabel(value))}</span>`;
const empty = (title = "当前没有数据", detail = "这里会在产生相应业务事实后显示。") => `<section class="state-panel"><div><strong>${esc(title)}</strong><p>${esc(detail)}</p></div></section>`;
const loading = label => `<section class="state-panel loading-state" role="status"><span class="spinner" aria-hidden="true"></span><div><strong>正在加载${esc(label)}</strong><p>正在读取本机业务数据。</p></div></section>`;
const panel = (title, body, extra = "") => `<section class="panel"><header class="panel-head"><h2>${esc(title)}</h2>${extra}</header><div class="panel-body">${body}</div></section>`;
const field = (label, value, wide = false) => `<div class="field ${wide ? "span-2" : ""}"><label>${esc(label)}</label>${value}</div>`;
const input = (name, label, value = "", type = "text", wide = false, required = false) => field(label, `<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${required ? "required" : ""}>`, wide);
const textarea = (name, label, value = "", wide = true) => field(label, `<textarea name="${esc(name)}">${esc(value)}</textarea>`, wide);
const select = (name, label, options, selected = "", wide = false) => field(label, `<select name="${esc(name)}">${options.map(option => `<option value="${esc(option)}" ${option === selected ? "selected" : ""}>${esc(displayLabel(option))}</option>`).join("")}</select>`, wide);

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  let payload;
  try { payload = await response.json(); } catch { payload = { error: { message: `HTTP ${response.status}` } }; }
  if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
  return payload;
}

async function action(name, payload) {
  return request(`/actions/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Creator-Ops-Token": TOKEN },
    body: JSON.stringify(payload),
  });
}

function routeFromHash() {
  const parts = (location.hash.replace(/^#\/?/, "") || "dashboard").split("/").filter(Boolean);
  return { page: parts[0] in pageTitles ? parts[0] : "dashboard", id: parts[1] ? decodeURIComponent(parts.slice(1).join("/")) : null };
}

function renderNav() {
  const nav = document.getElementById("primary-nav");
  nav.innerHTML = state.bootstrap.navigation.map(item => `<a class="nav-link ${state.route.page === item.id ? "active" : ""}" data-icon="${navIcons[item.id]}" href="#/${item.id}">${esc(item.label)}</a>`).join("");
}

async function boot() {
  try {
    state.bootstrap = await request("/bootstrap");
    document.getElementById("runtime-badge").textContent = `本机运行 · API ${state.bootstrap.runtime.api_version}`;
    updateHealth(state.bootstrap.health);
    await navigate();
  } catch (error) {
    renderError(error, "无法启动自媒体运营高级管理");
  }
}

async function navigate() {
  state.route = routeFromHash();
  renderNav();
  const worksViews = ["all", "recent", "portfolio"];
  const routeTitle = state.route.page === "works"
    ? (state.route.id && !worksViews.includes(state.route.id) ? "作品详情" : "作品")
    : (state.route.id ? `${pageTitles[state.route.page]} · ${state.route.id}` : pageTitles[state.route.page]);
  document.getElementById("page-title").textContent = routeTitle;
  const main = document.getElementById("main-content");
  main.innerHTML = loading(pageTitles[state.route.page]);
  main.focus();
  try {
    const renderers = { dashboard: renderDashboard, works: renderWorks, queue: renderQueue, content: renderContent, accounts: renderAccounts, assets: renderAssets, reviews: renderReviews, publishing: renderPublishing, research: renderResearch, health: renderHealth };
    await renderers[state.route.page](state.route.id);
  } catch (error) {
    renderError(error, `${pageTitles[state.route.page]} 加载失败`);
  }
}

function worksTabs(active) {
  return `<nav class="works-tabs" aria-label="作品视图">${[["all","全部"],["recent","最近"],["portfolio","作品集"]].map(([id,label]) => `<a class="${active === id ? "active" : ""}" href="#/works/${id}">${label}</a>`).join("")}</nav>`;
}

function locationLabel(value) {
  return ({ MANAGED: "已归档", EXTERNAL: "外部文件", MISSING: "原文件位置已变化" })[value] || value;
}

async function renderWorks(id) {
  if (id && !["all", "recent", "portfolio"].includes(id)) return renderWorkDetail(id);
  const view = id || "recent";
  const data = await request(`/works?view=${encodeURIComponent(view)}`); state.pageData = data;
  const cards = data.items.map(work => {
    const cover = work.media.find(item => item.media_id === work.cover_media_id) || work.media[0];
    const missing = work.media.some(item => item.location_state === "MISSING");
    return `<article class="work-card ${missing ? "is-missing" : ""}" data-work-id="${esc(work.work_id)}"><a href="#/works/${encodeURIComponent(work.work_id)}" class="work-cover"><img loading="lazy" src="${API}/works/media/${encodeURIComponent(cover.media_id)}/thumbnail" alt="${esc(work.title)}"><span class="work-count">${work.media.length} 项</span>${cover.media_type === "VIDEO" ? `<span class="work-video">▶</span>` : ""}</a><div class="work-card-meta"><div><strong>${esc(work.title)}</strong><small>${formatTime(work.created_at)}</small></div><button class="portfolio-toggle ${work.portfolio ? "active" : ""}" type="button" data-work-portfolio="${esc(work.work_id)}" data-included="${work.portfolio ? "false" : "true"}" aria-label="${work.portfolio ? "移出作品集" : "加入作品集"}">★</button></div><span class="location-label ${String(cover.location_state).toLowerCase()}">${locationLabel(cover.location_state)}</span></article>`;
  }).join("");
  const grid = [4,9,16].map(value => `<button type="button" class="grid-choice ${state.worksGrid === value ? "active" : ""}" data-grid="${value}">${value}宫格</button>`).join("");
  document.getElementById("main-content").innerHTML = `<div class="works-page">${worksTabs(view)}<section class="works-intake" tabindex="0"><strong>拖入图片、视频或文件夹</strong><span>或在 NEXA Desktop 的自媒体运营面板点击这里选择本地内容</span><small>收录只保存路径与作品关系，不复制原文件。</small></section><div class="works-toolbar"><div><strong>${view === "recent" ? "最近 7 天" : view === "portfolio" ? "我的作品集" : "全部作品"}</strong><span>${data.items.length} 个作品</span></div><div class="grid-choices" role="group" aria-label="作品墙密度">${grid}</div></div><section class="works-wall grid-${state.worksGrid}">${cards || empty("当前没有作品", view === "recent" ? "最近 7 天没有按创建时期归入的本地作品。" : "使用 NEXA Desktop 的本地内容加入框开始收录。")}</section></div>`;
}

async function renderWorkDetail(workId) {
  const data = await request(`/works/${encodeURIComponent(workId)}`); state.pageData = data;
  const work = data.work;
  const selected = work.media.find(item => item.media_id === state.selectedMedia) || work.media.find(item => item.media_id === work.cover_media_id) || work.media[0];
  state.selectedMedia = selected.media_id;
  const main = selected.media_type === "VIDEO" && selected.location_state !== "MISSING"
    ? `<video class="work-main-media" controls preload="metadata" src="${API}/works/media/${encodeURIComponent(selected.media_id)}/content"></video>`
    : selected.location_state === "MISSING" ? `<div class="work-missing-state"><strong>原文件位置已变化</strong><p>请从 NEXA Desktop 使用“重新定位”。作品身份、顺序和作品集状态会保留。</p></div>`
    : `<img class="work-main-media" src="${API}/works/media/${encodeURIComponent(selected.media_id)}/content" alt="${esc(work.title)}">`;
  const thumbs = work.media.map(item => `<button class="work-thumb ${item.media_id === selected.media_id ? "active" : ""}" type="button" data-work-thumb="${esc(item.media_id)}"><img loading="lazy" src="${API}/works/media/${encodeURIComponent(item.media_id)}/thumbnail" alt="${esc(work.title)} ${item.order_index + 1}"><span>${item.order_index + 1}</span></button>`).join("");
  const localActions = selected.location_state === "MISSING"
    ? `<span class="muted">请在 NEXA Desktop 使用“重新定位”恢复本地文件关联。</span>`
    : `<button class="button secondary" data-work-open="${esc(selected.media_id)}">打开原文件</button><button class="button secondary" data-work-location="${esc(selected.media_id)}">打开所在位置</button>${selected.media_type === "VIDEO" ? `<button class="button secondary" data-work-potplayer="${esc(selected.media_id)}">PotPlayer 观看</button>` : ""}`;
  const actions = `${localActions}<button class="button primary" data-work-portfolio="${esc(work.work_id)}" data-included="${work.portfolio ? "false" : "true"}">${work.portfolio ? "移出作品集" : "加入作品集"}</button>`;
  const canMove = work.media.some(item => item.location_state === "EXTERNAL");
  const move = `<label class="move-permission"><input type="checkbox" data-move-permission ${data.capabilities.move_permission ? "checked" : ""}> 作品文件移动权限 <small>本次运行有效；启动默认关闭</small></label><button class="button secondary" data-move-work="${esc(work.work_id)}" ${!data.capabilities.move_permission || !canMove ? "disabled" : ""}>移动到自媒体作品</button>`;
  document.getElementById("main-content").innerHTML = `<div class="work-detail"><a href="#/works/recent" class="back-link">← 返回作品墙</a><header class="work-detail-head"><div><h2>${esc(work.title)}</h2><p>${formatTime(work.created_at)} · ${work.media.length} 项 · ${work.portfolio ? "作品集" : "普通作品"}</p></div><span class="location-label ${String(selected.location_state).toLowerCase()}">${locationLabel(selected.location_state)}</span></header><section class="work-stage" data-selected-media="${esc(selected.media_id)}">${main}</section><div class="work-thumbnails">${thumbs}</div><div class="work-actions">${actions}</div><section class="work-file-controls">${move}<p class="muted mono">统一目录：${esc(data.capabilities.managed_root.absolute_path)}</p></section></div>`;
}

function updateHealth(health) {
  const node = document.getElementById("health-chip");
  node.textContent = displayLabel(health.status);
  node.className = `status-chip ${statusClass(health.status)}`;
  node.title = `业务状态：${displayLabel(health.business_state)}`;
}

function renderError(error, title = "页面加载失败") {
  document.getElementById("main-content").innerHTML = `<section class="state-panel"><div><strong>${esc(title)}</strong><p>本机业务数据暂时无法读取，请稍后重试。</p><details><summary>技术详情</summary><pre class="prompt">${esc(error.message || "未知错误")}</pre></details><button class="button secondary" type="button" data-retry>重新加载</button></div></section>`;
}

async function renderDashboard() {
  const data = await request("/dashboard");
  state.pageData = data;
  updateHealth(data.health);
  const dashboard = data.dashboard;
  const creator = data.creators?.[0];
  const stats = [
    ["活跃内容", dashboard.summary.total_active, "当前生产内容"], ["需要处理", dashboard.summary.needs_action, "需要运营处理"],
    ["待发布", dashboard.summary.ready_to_publish, "等待人工发布"], ["已阻塞", dashboard.summary.blocked, "存在明确阻塞"],
    ["待回填表现", dashboard.summary.metrics_pending, "待回填数据"], ["待复盘", dashboard.summary.review_pending, "待发布后复盘"],
  ].map(item => `<article class="stat-card"><span class="label">${item[0]}</span><strong>${item[1]}</strong><small>${item[2]}</small></article>`).join("");
  const queue = renderQueueTable(dashboard.work_queue, 6);
  const workloads = dashboard.account_workload.map(item => `<tr><td><a class="cell-title" href="#/accounts/${encodeURIComponent(item.account_id)}">${esc(item.account_id)}</a><span class="cell-subtitle">${text(item.legacy_account_code)}</span></td><td>${item.active_content_count}</td><td>${item.blocked_count}</td><td>${item.ready_to_publish_count}</td><td>${item.metrics_pending}</td><td>${item.review_pending}</td></tr>`).join("");
  const system = `<dl class="definition-grid"><dt>运营主体</dt><dd><strong>${text(creator?.name)}</strong> ${chip(creator?.status || "UNKNOWN")}</dd><dt>任务运行</dt><dd>${chip(data.health.task_runtime_status)}</dd><dt>业务状态</dt><dd>${chip(data.health.business_state)}</dd><dt>需要恢复</dt><dd>${data.health.recovery_required_count}</dd><dt>过期锁</dt><dd>${data.health.stale_lock_count}</dd><dt>质检阻塞</dt><dd>${data.health.qa_failure_count}</dd><dt>导入状态</dt><dd>${chip(data.health.import_authorization_state)}</dd><dt>自动发布</dt><dd>${chip(data.health.automatic_publishing)}</dd></dl>`;
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="grid stats">${stats}</div>${panel("当前工作", queue, `<a href="#/queue">查看全部 →</a>`)}<div class="grid two">${panel("账号概览", `<table class="data-table"><thead><tr><th>账号</th><th>活跃</th><th>阻塞</th><th>待发布</th><th>待回填</th><th>待复盘</th></tr></thead><tbody>${workloads}</tbody></table>`)}${panel("运行概况", system)}</div></div>`;
}

async function renderQueue() {
  const data = await request("/work-queue");
  state.pageData = data;
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="page-heading"><div><h2>工作队列</h2><p>集中查看需要处理的事项、当前状态和下一步操作。</p></div><span class="muted">更新时间：${formatTime(data.as_of)}</span></div>${data.items.length ? panel("待办事项", renderQueueTable(data.items)) : empty("当前没有待处理工作", "新的待办事项会在这里出现。")}</div>`;
}

function renderQueueTable(items, limit = null) {
  const rows = (limit ? items.slice(0, limit) : items).map(item => `<tr><td class="priority-${String(item.priority).toLowerCase()}">${esc(displayLabel(item.priority))}</td><td>${arr(item.account_ids).map(tag).join(" ")}</td><td><a class="cell-title" href="#/content/${encodeURIComponent(item.content_id)}">${esc(item.content_id)}</a><span class="cell-subtitle">${esc(displayLabel(item.work_type))}</span></td><td>${chip(item.status)}</td><td class="wrap"><strong>${esc(actionLabel(item.next_action?.next_action_label))}</strong><span class="cell-subtitle">${esc(displayLabel(item.next_action?.next_action_type))}</span></td><td>${formatTime(item.due_at)}</td><td class="wrap ${item.blocked_reason ? "text-danger" : "muted"}">${esc(safeReason(item.blocked_reason))}</td><td><button class="button secondary small" type="button" data-overlay="${esc(item.work_item_id)}">处理</button></td></tr>`).join("");
  return `<div style="overflow:auto"><table class="data-table"><thead><tr><th>优先级</th><th>账号</th><th>内容 / 类型</th><th>状态</th><th>下一步</th><th>截止时间</th><th>阻塞原因</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function renderContent(id) {
  if (id) return renderContentDetail(id);
  const query = new URLSearchParams();
  const filters = state.contentFilters || {};
  Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
  const data = await request(`/contents${query.size ? `?${query}` : ""}`);
  state.pageData = data;
  const rows = data.items.map(row => {
    const content = row.content, work = row.work_item, qa = latestQA(row.qa);
    return `<tr><td><a class="cell-title" href="#/content/${encodeURIComponent(content.content_id)}">${text(content.title, content.content_id)}</a><span class="cell-subtitle mono">${esc(content.content_id)}</span></td><td>${arr(content.target_accounts).map(tag).join(" ")}</td><td>${chip(content.current_state)}</td><td>${esc(actionLabel(work?.next_action?.next_action_label))}</td><td>${row.asset_intake ? `${row.asset_intake.verified_requirements}/${row.asset_intake.total_requirements}` : "—"}</td><td>${qa ? chip(qa.status) : chip("PENDING")}</td><td>${chip(content.review_state)}</td><td>${chip(content.publish_readiness)}</td><td>${formatTime(content.updated_at)}</td></tr>`;
  }).join("");
  const filtersHtml = `<form id="content-filters" class="filters"><div class="field"><label for="filter-state">状态</label><select id="filter-state" name="state"><option value="">全部</option>${["IDEA","DRAFT","ASSET_PREPARATION","IN_REVIEW","READY_TO_PUBLISH","PUBLISHED","BLOCKED","REVIEWED"].map(value => `<option value="${value}" ${filters.state === value ? "selected" : ""}>${esc(displayLabel(value))}</option>`).join("")}</select></div><div class="field"><label for="filter-account">账号</label><select id="filter-account" name="account"><option value="">全部</option>${["A1","A2","B1","B2","B3"].map(value => `<option ${filters.account === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><label class="checkbox-line"><input type="checkbox" name="blocked" ${filters.blocked === "true" ? "checked" : ""}> 仅阻塞</label><label class="checkbox-line"><input type="checkbox" name="needs_action" ${filters.needs_action === "true" ? "checked" : ""}> 需要处理</label><button class="button primary" type="submit">应用筛选</button></form>`;
  document.getElementById("main-content").innerHTML = `<div class="page-stack">${filtersHtml}${data.items.length ? panel("内容流程", `<div style="overflow:auto"><table class="data-table"><thead><tr><th>内容</th><th>账号</th><th>状态</th><th>下一步</th><th>素材</th><th>质检</th><th>审核</th><th>发布准备</th><th>更新时间</th></tr></thead><tbody>${rows}</tbody></table></div>`) : empty("当前筛选条件下没有内容", "可以调整筛选条件，或等待新的正式内容进入流程。")}</div>`;
}

async function renderContentDetail(id) {
  const data = await request(`/contents/${encodeURIComponent(id)}`);
  state.pageData = data;
  const detail = data.detail, content = detail.content, work = data.work_item;
  const provenance = content.provenance || {};
  const overview = `<dl class="definition-grid"><dt>内容 ID</dt><dd class="mono">${esc(content.content_id)}</dd><dt>目标账号</dt><dd>${arr(content.target_accounts).map(tag).join(" ")}</dd><dt>状态</dt><dd>${chip(content.current_state)}</dd><dt>审核</dt><dd>${chip(content.review_state)}</dd><dt>发布准备</dt><dd>${chip(content.publish_readiness)}</dd><dt>下一步</dt><dd>${esc(actionLabel(work?.next_action?.next_action_label))}</dd><dt>阻塞原因</dt><dd class="${work?.blocked_reason ? "text-danger" : "muted"}">${esc(safeReason(work?.blocked_reason))}</dd><dt>来源</dt><dd>${text(provenance.source_system || content.source)}</dd><dt>来源引用</dt><dd class="mono">${text(provenance.source_reference)}</dd><dt>更新时间</dt><dd>${formatTime(content.updated_at)}</dd></dl>`;
  const contentBody = `<dl class="definition-grid"><dt>标题</dt><dd>${text(content.title)}</dd><dt>主题</dt><dd>${text(content.topic)}</dd><dt>类型</dt><dd>${tag(content.content_type)}</dd><dt>正文</dt><dd class="wrap">${text(content.body)}</dd><dt>脚本引用</dt><dd class="mono wrap">${text(content.script_reference)}</dd></dl>`;
  const requirements = renderRequirements(data.requirements, content.content_id);
  const qa = renderQA(data.qa, content.content_id);
  const publishing = arr(data.publishing).map(item => item.available ? renderWorkbench(item.data, content) : `<div class="notice">发布工作台暂不可用，请检查发布准备状态。</div>`).join("");
  const activity = data.activity.length ? `<ol class="timeline">${data.activity.map(item => `<li><strong>${esc(safeReason(item.summary).replace("存在业务阻塞，请查看相关内容与审核状态", "业务状态已更新"))}</strong><time>${formatTime(item.occurred_at)} · ${esc(displayLabel(item.event_type))}</time></li>`).join("")}</ol>` : empty("还没有活动记录", "新的业务动态会在这里出现。");
  const rail = `${panel("生产状态", `<dl class="definition-grid"><dt>素材</dt><dd>${data.asset_intake ? `${data.asset_intake.verified_requirements}/${data.asset_intake.total_requirements}` : "—"}</dd><dt>视觉审核</dt><dd>${data.asset_intake ? chip(data.asset_intake.visual_reviews_pending ? "PENDING" : "NONE") : "—"}</dd><dt>发布包</dt><dd>${chip(packageStatus(data.qa))}</dd><dt>质检</dt><dd>${chip(overallQA(data.qa))}</dd></dl>`)}${panel("可用操作", `<div class="grid"><button class="button secondary" data-run-qa="CONTENT" data-content-id="${esc(id)}">运行内容质检</button><button class="button secondary" data-run-qa="ASSET" data-content-id="${esc(id)}">运行素材质检</button><button class="button primary" data-editorial="${esc(id)}">人工业务审核</button></div>`)}${panel("来源信息", `<div class="mono wrap">${text(provenance.source_reference)}<br>${text(provenance.confidence)}<br>${formatTime(provenance.captured_at)}</div>`)}`;
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="page-heading"><div><h2>${text(content.title, content.content_id)}</h2><p class="mono">${esc(content.content_id)}</p></div>${chip(content.current_state)}</div><div class="detail-layout"><div class="detail-main">${panel("概览", overview)}${panel("内容", contentBody)}${panel("素材", renderContentAssets(data, content))}${panel("发布包", renderPackageSection(data, content))}${panel("质检", qa)}${panel("人工业务审核", `<p>技术质检与人工业务审核保持分离。</p>${chip(content.review_state)}`)}${panel("发布管理", publishing || empty("尚无可用发布工作台"))}${panel("最近动态", activity)}</div><aside class="detail-rail">${rail}</aside></div></div>`;
}

function renderRequirements(requirements, contentId) {
  if (!requirements.length) return empty("当前没有素材要求", "不会用占位素材冒充真实素材。");
  return requirements.map(item => `<article class="requirement-card"><div class="page-heading"><div><h4>${esc(displayLabel(item.asset_role))}</h4><span class="mono muted">${esc(item.requirement_id)}</span></div>${chip(item.status)}</div><div class="requirement-meta">${tag(item.asset_type)} ${tag(item.aspect_ratio)} ${tag(`${item.preferred_dimensions?.[0]}×${item.preferred_dimensions?.[1]}`)} ${item.required ? tag("REQUIRED") : tag("OPTIONAL")}</div><p>${text(item.purpose)}</p><strong>视觉要求</strong><p>${text(item.visual_subject)} · ${text(item.composition)}</p><button class="button secondary small" data-submit-asset="${esc(item.requirement_id)}" data-content-id="${esc(contentId)}">提交本地素材</button></article>`).join("");
}

function renderContentAssets(data, content) {
  const canonical = arr(data.detail.assets);
  const submissions = arr(data.submissions);
  const reviews = arr(data.visual_reviews);
  const canonicalRows = canonical.map(item => `<tr><td class="mono">${esc(item.asset_id)}</td><td>${tag(item.asset_type)}</td><td>${chip(item.status)}</td><td class="wrap">${text(item.location)}</td></tr>`).join("");
  const submissionRows = submissions.map(item => `<tr><td class="mono">${esc(item.submission_id)}</td><td>${chip(item.status)}</td><td>${esc(displayLabel(item.media?.detected_type))}</td><td>${item.media?.dimensions ? item.media.dimensions.join("×") : "—"}</td><td><button class="button secondary small" data-visual-review="${esc(item.submission_id)}" ${item.status !== "PENDING_HUMAN_VISUAL_REVIEW" ? "disabled" : ""}>视觉审核</button></td></tr>`).join("");
  return `${renderRequirements(data.requirements, content.content_id)}<h3>素材提交与视觉审核</h3>${submissionRows ? `<table class="data-table"><thead><tr><th>提交记录</th><th>状态</th><th>类型</th><th>尺寸</th><th></th></tr></thead><tbody>${submissionRows}</tbody></table>` : `<p class="muted">尚无素材提交；不会用占位素材冒充真实提交。</p>`}<p class="muted">视觉审核记录：${reviews.length}</p><h3>正式素材</h3>${canonicalRows ? `<table class="data-table"><thead><tr><th>素材</th><th>类型</th><th>状态</th><th>管理位置</th></tr></thead><tbody>${canonicalRows}</tbody></table>` : `<p class="muted">尚无已验证的正式素材。</p>`}`;
}

function renderPackageSection(data, content) {
  const availableWorkbench = arr(data.publishing).find(item => item.available)?.data;
  const currentPackage = availableWorkbench?.content_package;
  const manifest = currentPackage?.manifest;
  const summary = currentPackage ? `<dl class="definition-grid"><dt>版本</dt><dd>${text(currentPackage.version)}</dd><dt>发布准备</dt><dd>${chip(currentPackage.publish_readiness)}</dd><dt>审核准备</dt><dd>${chip(currentPackage.review_readiness)}</dd><dt>素材数量</dt><dd>${arr(currentPackage.assets).length}</dd><dt>提醒</dt><dd>${arr(currentPackage.warnings).length ? arr(currentPackage.warnings).map(item => esc(safeReason(item))).join("；") : "无"}</dd><dt>清单</dt><dd>${manifest ? `<span class="mono">${text(manifest.package_identity)}</span> ${chip(manifest.compatibility)}` : chip("PENDING")}</dd></dl>` : `<p class="muted">当前业务流程尚未产生可发布内容包。</p>`;
  return `${summary}<button class="button secondary" data-build-package="${esc(content.content_id)}" data-account-id="${esc(arr(content.target_accounts)[0] || "")}">构建本地发布包</button>`;
}

function latestQA(receipts, type = null) {
  const rows = arr(receipts).filter(item => !type || item.qa_type === type);
  return rows.length ? rows[rows.length - 1] : null;
}
function overallQA(receipts) {
  const rows = arr(receipts); if (!rows.length) return "PENDING";
  return rows.some(item => item.status !== "PASS") ? "FAIL" : "PASS";
}
function packageStatus(receipts) { const row = latestQA(receipts, "PACKAGE"); return row?.status || "PENDING"; }
function renderQA(receipts, contentId) {
  const types = ["CONTENT", "ASSET", "VISUAL", "PACKAGE", "PUBLISH_PREP"];
  return `<div class="grid two">${types.map(type => { const row = latestQA(receipts, type); return `<article class="requirement-card"><div class="page-heading"><h4>${esc(displayLabel(type))}质检</h4>${chip(row?.status || "PENDING")}</div>${row ? `<ul class="bullet-list">${arr(row.checks).map(check => `<li><strong>${esc(displayLabel(check.check_id))}</strong> · ${chip(check.status)}<br><span class="muted">${esc(safeReason(check.message || check.reason))}</span></li>`).join("")}</ul>` : `<p class="muted">尚无质检记录。</p>`}<button class="button secondary small" data-run-qa="${type}" data-content-id="${esc(contentId)}">运行${esc(displayLabel(type))}质检</button></article>`; }).join("")}</div>`;
}
function renderWorkbench(workbench, content) {
  return `<div><dl class="definition-grid"><dt>平台</dt><dd>${text(workbench.platform)}</dd><dt>账号</dt><dd>${text(workbench.target_account?.account_id)}</dd><dt>发布准备</dt><dd>${chip(workbench.ready ? "READY" : "BLOCKED")}</dd><dt>需要人工确认</dt><dd>${chip(workbench.manual_publish_confirmation_required ? "REQUIRED" : "NONE")}</dd></dl><ul class="bullet-list">${arr(workbench.readiness_checks).map(check => `<li>${chip(check.status)} <strong>${esc(displayLabel(check.check_id))}</strong> · ${esc(safeReason(check.reason))}</li>`).join("")}</ul><div class="notice">这里不会代替你在平台发布内容，只记录已经人工完成的发布。</div><button class="button primary" data-manual-publish="${esc(content.content_id)}" data-account-id="${esc(workbench.target_account?.account_id || "")}" ${workbench.ready ? "" : "disabled"}>记录人工发布</button></div>`;
}

async function renderAccounts(id) {
  if (id) return renderAccountDetail(id);
  const data = await request("/accounts"); state.pageData = data;
  const rows = data.items.map(row => `<tr><td><a class="cell-title" href="#/accounts/${encodeURIComponent(row.account.account_id)}">${esc(row.account.account_id)} · ${esc(row.account.display_name)}</a><span class="cell-subtitle">${esc(row.account.platform)}</span></td><td>${chip(row.account.status)}</td><td>${text(row.account.content_direction)}</td><td>${row.workload.active_content_count}</td><td>${row.workload.blocked_count}</td><td>${row.workload.ready_to_publish_count}</td><td>${row.workload.published_recently}</td><td>${row.workload.metrics_pending}</td><td>${row.workload.review_pending}</td></tr>`).join("");
  document.getElementById("main-content").innerHTML = `<div class="page-stack">${panel("账号矩阵 A1 / A2 / B1 / B2 / B3", `<table class="data-table"><thead><tr><th>账号</th><th>状态</th><th>内容方向</th><th>活跃</th><th>阻塞</th><th>待发布</th><th>近期发布</th><th>待回填</th><th>待复盘</th></tr></thead><tbody>${rows}</tbody></table>`)}</div>`;
}

async function renderAccountDetail(id) {
  const data = await request(`/accounts/${encodeURIComponent(id)}`); state.pageData = data;
  const account = data.account, provenance = account.provenance || {};
  const definition = `<dl class="definition-grid"><dt>ID</dt><dd>${tag(account.account_id)}</dd><dt>历史账号代码</dt><dd>${text(account.legacy_account_code)}</dd><dt>平台</dt><dd>${text(account.platform)}</dd><dt>状态</dt><dd>${chip(account.status)}</dd><dt>内容方向</dt><dd>${text(account.content_direction)}</dd><dt>来源</dt><dd>${text(provenance.source_system || account.source)}</dd><dt>来源引用</dt><dd class="mono wrap">${text(provenance.source_reference)}</dd></dl>`;
  const contents = data.contents.length ? data.contents.map(item => `<tr><td><a class="cell-title" href="#/content/${encodeURIComponent(item.content_id)}">${text(item.title, item.content_id)}</a></td><td>${chip(item.current_state)}</td><td>${chip(item.publish_readiness)}</td><td>${formatTime(item.updated_at)}</td></tr>`).join("") : "";
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="page-heading"><div><h2>${esc(account.display_name)}</h2><p>${esc(account.content_direction)}</p></div>${chip(account.status)}</div><div class="grid two">${panel("账号信息", definition)}${panel("当前工作量", `<dl class="definition-grid"><dt>活跃内容</dt><dd>${data.workload.active_content_count}</dd><dt>已阻塞</dt><dd>${data.workload.blocked_count}</dd><dt>待发布</dt><dd>${data.workload.ready_to_publish_count}</dd><dt>待回填表现</dt><dd>${data.workload.metrics_pending}</dd><dt>待复盘</dt><dd>${data.workload.review_pending}</dd></dl>`)}</div>${data.contents.length ? panel("内容流程", `<table class="data-table"><thead><tr><th>内容</th><th>状态</th><th>发布准备</th><th>更新时间</th></tr></thead><tbody>${contents}</tbody></table>`) : empty("当前没有内容", `${account.account_id} 暂无正式内容。`)}${panel("最近动态", data.activity.length ? `<ol class="timeline">${data.activity.map(item => `<li><strong>${esc(safeReason(item.summary).replace("存在业务阻塞，请查看相关内容与审核状态", "业务状态已更新"))}</strong><time>${formatTime(item.occurred_at)}</time></li>`).join("")}</ol>` : `<p class="muted">当前没有活动。</p>`)}</div>`;
}

async function renderAssets() {
  const data = await request("/assets"); state.pageData = data;
  const sections = data.items.map(row => {
    const packet = row.packet?.available ? row.packet.data : null;
    const submissions = arr(row.submissions).map(item => `<tr><td class="mono">${esc(item.submission_id)}</td><td>${chip(item.status)}</td><td>${esc(displayLabel(item.media?.detected_type))}</td><td>${item.media?.dimensions ? item.media.dimensions.join("×") : "—"}</td><td><button class="button secondary small" data-visual-review="${esc(item.submission_id)}" ${item.status !== "PENDING_HUMAN_VISUAL_REVIEW" ? "disabled" : ""}>视觉审核</button></td></tr>`).join("");
    const prompts = packet ? `<details><summary>制作提示与说明</summary>${arr(packet.handoffs).map(item => `<h4>${esc(item.asset_requirement_id)}</h4><pre class="prompt">${esc(item.image_prompt)}</pre>`).join("")}</details>` : `<p class="muted">制作资料包暂不可用。</p>`;
    return `<section class="panel"><header class="panel-head"><div><h2>${text(row.content.title, row.content.content_id)} · ${arr(row.content.target_accounts).map(esc).join("/")}</h2><span class="muted mono">${esc(row.content.content_id)}</span></div>${chip(row.intake?.next_action || "PENDING")}</header><div class="panel-body"><div class="grid two"><div>${renderRequirements(row.requirements, row.content.content_id)}</div><div><h3>制作资料包</h3>${prompts}<h3>素材提交</h3>${submissions ? `<table class="data-table"><thead><tr><th>ID</th><th>状态</th><th>类型</th><th>尺寸</th><th></th></tr></thead><tbody>${submissions}</tbody></table>` : empty("还没有素材提交", "通过素材要求中的“提交本地素材”进入验证流程。")}</div></div></div></section>`;
  }).join("");
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="page-heading"><div><h2>素材管理</h2><p>素材要求 → 素材提交 → 人工视觉审核 → 正式素材</p></div></div>${sections || empty("当前没有素材要求")}</div>`;
}

async function renderReviews() {
  const data = await request("/reviews"); state.pageData = data;
  const workbenches = data.items.map(row => {
    const packet = row.production_packet?.available ? row.production_packet.data : null;
    const publishWorkbench = arr(row.publishing).find(item => item.available)?.data;
    const packageProjection = publishWorkbench?.content_package;
    const qaEvidence = ["CONTENT","ASSET","VISUAL","PACKAGE","PUBLISH_PREP"].map(type => `${tag(type)} ${chip(latestQA(row.qa, type)?.status || "PENDING")}`).join(" ");
    const warnings = [...arr(packageProjection?.warnings), ...arr(publishWorkbench?.warnings)];
    return `<section class="panel"><header class="panel-head"><div><h2><a href="#/content/${encodeURIComponent(row.content.content_id)}">${text(row.content.title, row.content.content_id)}</a></h2><span class="muted mono">${esc(row.content.content_id)} · ${arr(row.content.target_accounts).join("/")}</span></div>${chip(row.content.review_state)}</header><div class="panel-body"><div class="grid two"><dl class="definition-grid"><dt>发布包</dt><dd>${packageProjection ? chip(packageProjection.publish_readiness) : chip("PENDING")}</dd><dt>正式素材</dt><dd>${row.assets.length}</dd><dt>提示引用</dt><dd>${packet ? arr(packet.handoffs).length : 0}</dd><dt>研究记录</dt><dd>${arr(row.research).length}</dd><dt>发布记录</dt><dd>${row.publish_records.length}</dd><dt>发布后复盘</dt><dd>${row.post_publish_workbenches.length ? chip("PENDING") : chip("NOT_AVAILABLE")}</dd></dl><div><h3>质检证据</h3><p>${qaEvidence}</p><h3>提醒</h3>${warnings.length ? `<ul class="bullet-list">${warnings.map(item => `<li>${esc(safeReason(item))}</li>`).join("")}</ul>` : `<p class="muted">当前没有发布包或工作台提醒。</p>`}</div></div><details><summary>提示与研究背景</summary><p>视觉资料包：${packet ? chip(packet.status) : chip("NOT_AVAILABLE")}</p><pre class="prompt">${esc(pretty({prompt_references: packet ? arr(packet.handoffs).map(item => item.asset_requirement_id) : [], research: row.research}))}</pre></details><button class="button primary" data-editorial="${esc(row.content.content_id)}">进行人工业务审核</button></div></section>`;
  }).join("");
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="notice">质检是客观发布前检查；人工业务审核用于业务判断；发布后复盘用于总结表现。三者保持分离。</div>${workbenches || empty("当前没有审核工作")}</div>`;
}

async function renderPublishing() {
  const data = await request("/publishing"); state.pageData = data;
  const sections = data.items.map(row => `<section class="panel"><header class="panel-head"><div><h2>${text(row.content.title, row.content.content_id)}</h2><span class="muted">${esc(row.account.account_id)} · ${esc(row.account.platform)}</span></div>${chip(row.content.publish_readiness)}</header><div class="panel-body">${row.workbench.available ? renderWorkbench(row.workbench.data, row.content) : `<div class="notice">发布工作台暂不可用，请检查发布准备状态。</div>`}${row.publish_records.length ? `<h3>发布记录</h3><table class="data-table"><tbody>${row.publish_records.map(record => `<tr><td class="mono">${esc(record.publish_record_id)}</td><td>${chip(record.publish_status)}</td><td>${formatTime(record.actual_publish_time)}</td><td><button class="button secondary small" data-metrics="${esc(record.publish_record_id)}" data-content-id="${esc(row.content.content_id)}">回填表现</button></td><td><button class="button secondary small" data-post-review="${esc(record.publish_record_id)}" data-content-id="${esc(row.content.content_id)}">发布后复盘</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted">尚无发布记录，不会自动发布。</p>`}</div></section>`).join("");
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="notice">这里不会代替你在平台发布内容，只记录已经人工完成的发布。</div>${sections || empty("当前没有可用发布工作台")}</div>`;
}

async function renderResearch() {
  const data = await request("/research"); state.pageData = data;
  const rows = data.items.map(item => `<section class="panel"><header class="panel-head"><div><h2>${text(item.topic)}</h2><span class="mono muted">${esc(item.research_id)} · ${esc(item.account_id)}</span></div>${chip(item.status)}</header><div class="panel-body"><dl class="definition-grid"><dt>研究意图</dt><dd>${text(item.content_intent)}</dd><dt>研究发现</dt><dd>${arr(item.findings).map(esc).join("；") || "—"}</dd><dt>待回答问题</dt><dd>${arr(item.open_questions).map(esc).join("；") || "—"}</dd><dt>资料来源</dt><dd>${arr(item.sources).length}</dd></dl><div class="topbar-actions" style="margin-top:12px"><button class="button secondary small" data-research-source="${esc(item.research_id)}">添加资料</button><button class="button secondary small" data-research-synthesize="${esc(item.research_id)}">综合研究</button><button class="button primary small" data-research-topics="${esc(item.research_id)}">规划选题</button></div></div></section>`).join("");
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="page-heading"><div><h2>本地研究</h2><p>全程离线、本机运行，不会声称提供实时热点。</p></div><button class="button primary" data-create-research>新建研究</button></div>${rows || empty("当前没有研究记录", "可以创建完全离线的本地研究。")}</div>`;
}

async function renderHealth() {
  const data = await request("/health"); state.pageData = data; updateHealth(data.health);
  const h = data.health;
  const overview = `<dl class="definition-grid"><dt>整体状态</dt><dd>${chip(h.status)}</dd><dt>业务状态</dt><dd>${chip(h.business_state)}</dd><dt>数据库</dt><dd>${chip(h.database_state)}</dd><dt>数据结构兼容性</dt><dd>${chip(h.schema_compatible ? "COMPATIBLE" : "INCOMPATIBLE")}</dd><dt>任务运行</dt><dd>${chip(h.task_runtime_status)}</dd><dt>过期锁</dt><dd>${h.stale_lock_count}</dd><dt>需要恢复</dt><dd>${h.recovery_required_count}</dd><dt>未完成发布包</dt><dd>${h.incomplete_package_count}</dd><dt>质检失败或阻塞</dt><dd>${h.qa_failure_count}</dd><dt>待视觉审核</dt><dd>${h.visual_reviews_pending}</dd><dt>导入状态</dt><dd>${chip(h.import_authorization_state)}</dd><dt>自动发布</dt><dd>${chip(h.automatic_publishing)}</dd><dt>网络能力</dt><dd>${chip(h.network_capability)}</dd></dl>`;
  const tasks = data.tasks.length ? `<table class="data-table"><thead><tr><th>任务</th><th>类型</th><th>状态</th><th>尝试次数</th><th>更新时间</th></tr></thead><tbody>${data.tasks.map(item => `<tr><td class="mono">${esc(item.task_id)}</td><td>${tag(item.task_type)}</td><td>${chip(item.status)}</td><td>${item.attempt ?? 0}</td><td>${formatTime(item.updated_at)}</td></tr>`).join("")}</tbody></table>` : empty("当前没有持久任务");
  document.getElementById("main-content").innerHTML = `<div class="page-stack"><div class="grid two">${panel("系统运行状态", overview)}${panel("安全恢复", `<p>安全恢复只处理可恢复的本机任务状态，不会修改业务内容。</p><button class="button primary" data-recover ${h.recovery_required_count ? "" : "disabled"}>执行安全恢复</button><p class="muted">${h.recovery_required_count ? "检测到需要恢复的任务。" : "当前无需恢复。"}</p>`)}</div>${panel("持久任务", tasks)}${panel("恢复记录", data.recovery.length ? `<details><summary>查看技术详情</summary><pre class="prompt">${esc(pretty(data.recovery))}</pre></details>` : `<p class="muted">当前没有新增恢复记录。</p>`)}</div>`;
}

function findQueueItem(workItemId) {
  const source = state.pageData?.items || state.pageData?.dashboard?.work_queue || [];
  return source.find(item => item.work_item_id === workItemId);
}

const dialog = document.getElementById("action-dialog");
const actionForm = document.getElementById("action-form");
let dialogAction = null;

function openDialog(config) {
  dialogAction = config;
  document.getElementById("dialog-title").textContent = config.title;
  document.getElementById("dialog-body").innerHTML = config.body;
  const notice = document.getElementById("dialog-notice");
  notice.textContent = config.notice || "";
  notice.className = config.notice ? `notice ${config.danger ? "danger" : ""}` : "notice hidden";
  document.getElementById("dialog-submit").textContent = config.submit || "确认";
  dialog.showModal();
  dialog.querySelector("input, select, textarea, button")?.focus();
}

function formObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll('input[type="checkbox"]').forEach(node => data[node.name] = node.checked);
  return data;
}

async function submitDialog(event) {
  event.preventDefault();
  if (!dialogAction) return;
  const submit = document.getElementById("dialog-submit"); submit.disabled = true; submit.textContent = "处理中…";
  try {
    const result = await dialogAction.run(formObject(actionForm));
    if (result?.ok === false) throw new Error(result.result?.error?.message || "业务命令未成功");
    dialog.close(); toast("操作已由 CreatorOpsApplication 接受"); await navigate();
  } catch (error) { toast(friendlyError(error), true); }
  finally { submit.disabled = false; submit.textContent = dialogAction.submit || "确认"; }
}

function toast(message, error = false) {
  const node = document.createElement("div"); node.className = `toast ${error ? "error" : ""}`; node.textContent = message;
  document.getElementById("toast-region").append(node); setTimeout(() => node.remove(), 4500);
}

document.addEventListener("click", event => {
  const button = event.target.closest("button, a"); if (!button) return;
  if (button.matches("[data-retry]")) navigate();
  if (button.matches("[data-close-dialog]")) dialog.close();
  if (button.dataset.overlay) {
    const item = findQueueItem(button.dataset.overlay); if (!item) return toast("待办事项未找到", true);
    openDialog({ title: "处理待办事项", body: `${input("work_item_id", "待办事项 ID", item.work_item_id, "text", true, true)}${input("content_id", "内容 ID", item.content_id, "text", true, true)}${select("status", "处理状态", ["TODO","IN_PROGRESS","BLOCKED","DONE","CANCELLED"], item.status)}${input("due_at", "截止时间", item.due_at || "", "datetime-local")}${textarea("blocked_reason", "阻塞原因", item.blocked_reason || "")}${textarea("operator_notes", "处理备注", "")}`, run: data => action("update_work_item", data) });
  }
  if (button.dataset.submitAsset) openDialog({ title: "提交本地素材", body: `${input("content_id", "内容 ID", button.dataset.contentId, "text", true, true)}${input("requirement_id", "素材要求 ID", button.dataset.submitAsset, "text", true, true)}${input("asset_path", "本地绝对路径", "", "text", true, true)}`, notice: "文件将进入既有素材验证流程；界面不会自行复制、移动或改写素材。", run: data => action("submit_asset", data) });
  if (button.dataset.buildPackage) openDialog({ title: "构建本地发布包", body: `${input("content_id", "内容 ID", button.dataset.buildPackage, "text", true, true)}${input("account_id", "账号", button.dataset.accountId, "text", false, true)}${input("package_id", "发布包 ID", `package-${button.dataset.buildPackage}`, "text", true, true)}${input("target_root", "本地输出根目录（绝对路径）", "", "text", true, true)}`, notice: "构建会验证业务阶段、素材和文件冲突；界面不会绕过现有业务规则。", run: data => action("build_package", data) });
  if (button.dataset.visualReview) openVisualReview(button.dataset.visualReview);
  if (button.dataset.runQa) openQA(button.dataset.contentId, button.dataset.runQa);
  if (button.dataset.editorial) openDialog({ title: "人工业务审核", body: `${input("content_id", "内容 ID", button.dataset.editorial, "text", true, true)}${select("decision", "审核决定", ["APPROVE","REJECT","REQUEST_CHANGES"], "REQUEST_CHANGES")}${textarea("notes", "审核备注", "")}`, notice: "这是人工业务审核，不会替代技术质检；请求修改将进入明确的返工路径。", run: data => action("editorial_review", data) });
  if (button.dataset.manualPublish) openDialog({ title: "记录人工发布", body: `${input("content_id", "内容 ID", button.dataset.manualPublish, "text", true, true)}${input("account_id", "账号", button.dataset.accountId, "text", false, true)}${input("actual_publish_time", "实际发布时间", new Date().toISOString().slice(0,16), "datetime-local", false, true)}${input("external_url", "外部链接", "", "url", true)}${input("external_post_id", "外部帖子 ID", "", "text", true)}${field("明确确认", `<label class="checkbox-line"><input name="manual_confirmation" type="checkbox" required> 我确认已在真实平台人工发布</label>`, true)}`, notice: "这里不会代替你在平台发布内容，只记录已经人工完成的发布。", danger: true, submit: "确认记录", run: data => action("record_manual_publish", data) });
  if (button.dataset.metrics) openMetrics(button.dataset.contentId, button.dataset.metrics);
  if (button.dataset.postReview) openPostReview(button.dataset.contentId, button.dataset.postReview);
  if (button.matches("[data-create-research]")) openResearchCreate();
  if (button.dataset.researchSource) openResearchSource(button.dataset.researchSource);
  if (button.dataset.researchSynthesize) action("synthesize_research", { research_id: button.dataset.researchSynthesize }).then(() => { toast("研究已综合"); navigate(); }).catch(() => toast("研究综合失败，请稍后重试", true));
  if (button.dataset.researchTopics) openDialog({ title: "规划选题", body: `${input("research_id", "研究 ID", button.dataset.researchTopics, "text", true, true)}${textarea("operator_intent", "运营意图", "", true)}`, run: data => action("plan_topics", data) });
  if (button.matches("[data-recover]")) action("recover_runtime", {}).then(() => { toast("安全恢复已执行"); navigate(); }).catch(() => toast("安全恢复失败，请查看运行状态", true));
  if (button.dataset.grid) {
    state.worksGrid = Number(button.dataset.grid);
    const wall = document.querySelector(".works-wall");
    if (wall) wall.className = `works-wall grid-${state.worksGrid}`;
    document.querySelectorAll("[data-grid]").forEach(choice => choice.classList.toggle("active", choice === button));
  }
  if (button.dataset.workThumb) { state.selectedMedia = button.dataset.workThumb; renderWorkDetail(state.pageData.work.work_id); }
  if (button.dataset.workPortfolio) action("set_work_portfolio", { work_id: button.dataset.workPortfolio, included: button.dataset.included === "true" }).then(() => navigate()).catch(error => toast(friendlyError(error), true));
  if (button.dataset.workOpen) action("open_work_original", { media_id: button.dataset.workOpen }).catch(error => toast(friendlyError(error), true));
  if (button.dataset.workLocation) action("open_work_location", { media_id: button.dataset.workLocation }).catch(error => toast(friendlyError(error), true));
  if (button.dataset.workPotplayer) action("open_work_potplayer", { media_id: button.dataset.workPotplayer }).catch(error => toast(friendlyError(error), true));
  if (button.dataset.moveWork) action("move_work_to_managed", { work_id: button.dataset.moveWork, explicit_user_intent: true }).then(() => navigate()).catch(error => toast(friendlyError(error), true));
});

document.addEventListener("change", event => {
  if (!event.target.matches("[data-move-permission]")) return;
  action("set_work_move_permission", { enabled: event.target.checked }).then(() => navigate()).catch(error => toast(friendlyError(error), true));
});

function openVisualReview(submissionId) {
  const checks = ["subject_correctness","composition","visual_hierarchy","text_accuracy","text_legibility","brand_fit","platform_fit","aspect_ratio","resolution","artifact_check","safety_check"];
  openDialog({ title: "人工视觉审核", body: `${input("submission_id", "提交记录 ID", submissionId, "text", true, true)}<div class="span-2"><img class="preview" src="${API}/visual-reviews/${encodeURIComponent(submissionId)}/preview" alt="待人工审核的素材预览"></div>${select("decision", "审核决定", ["APPROVE","REJECT","REQUEST_CHANGE"], "REQUEST_CHANGE")}${textarea("notes", "审核备注", "")}${checks.map(name => select(`check_${name}`, displayLabel(name.toUpperCase()), ["PASS","FAIL"], "PASS")).join("")}${field("明确确认", `<label class="checkbox-line"><input name="human_confirmation" type="checkbox" required> 我已人工检查以上 11 项</label>`, true)}`, notice: "只有在你明确点击并确认后才会提交批准；界面不会自动批准。", run: data => { const operator_checks = Object.fromEntries(checks.map(name => [name, data[`check_${name}`]])); return action("review_visual_asset", { submission_id: data.submission_id, decision: data.decision, notes: data.notes, human_confirmation: data.human_confirmation, operator_checks }); } });
}

function openQA(contentId, qaType) {
  let extra = "";
  if (["PACKAGE","PUBLISH_PREP"].includes(qaType)) extra += input("package_id", "发布包 ID", "", "text", true, true);
  if (qaType === "PACKAGE") extra += input("manifest_path", "清单路径", "", "text", true, true);
  if (qaType === "VISUAL") extra += textarea("operator_checks_json", "检查项 JSON", "[]", true);
  openDialog({ title: `运行${displayLabel(qaType)}质检`, body: `${input("content_id", "内容 ID", contentId, "text", true, true)}${input("qa_type", "质检类型", qaType, "text", true, true)}${extra}`, notice: "质检只产生客观检查证据，不会自动执行人工业务审核。", run: data => { if (data.operator_checks_json) data.operator_checks = JSON.parse(data.operator_checks_json); delete data.operator_checks_json; return action("run_qa", data); } });
}

function openMetrics(contentId, publishRecordId) {
  const names = ["views","impressions","likes","comments","favorites","shares","followers_delta"];
  const metricLabels = { views: "播放/阅读量", impressions: "曝光量", likes: "点赞", comments: "评论", favorites: "收藏", shares: "分享", followers_delta: "粉丝变化", engagement: "互动量" };
  openDialog({ title: "回填表现数据", body: `${input("content_id", "内容 ID", contentId, "text", true, true)}${input("publish_record_id", "发布记录 ID", publishRecordId, "text", true, true)}${input("metrics_id", "表现记录 ID", `metrics-${publishRecordId}`, "text", true, true)}${input("collected_at", "采集时间", new Date().toISOString().slice(0,16), "datetime-local", false, true)}${names.map(name => input(name, metricLabels[name], "", "number")).join("")}${input("engagement", metricLabels.engagement, "", "number")}`, notice: "空输入保持为空，不会转换成 0。", run: data => action("record_metrics", data) });
}

function openPostReview(contentId, publishRecordId) {
  openDialog({ title: "发布后复盘", body: `${input("content_id", "内容 ID", contentId, "text", true, true)}${input("publish_record_id", "发布记录 ID", publishRecordId, "text", true, true)}${input("metrics_id", "表现记录 ID", "", "text", true, true)}${input("review_id", "复盘记录 ID", `review-${publishRecordId}`, "text", true, true)}${textarea("strengths", "做得好的地方")}${textarea("weaknesses", "需要改进的地方")}${textarea("reusable_patterns", "可复用经验")}${textarea("failed_patterns", "无效做法")}${textarea("next_action", "下一步")}${textarea("evidence", "依据")}`, notice: "每行一个条目；不会由 AI 自动生成复盘。", run: data => action("complete_post_publish_review", data) });
}

function openResearchCreate() {
  openDialog({ title: "新建本地研究", body: `${input("research_id", "研究 ID", `research-${Date.now()}`, "text", true, true)}${select("account_id", "账号", ["A1","A2","B1","B2","B3"], "B3")}${input("topic", "研究主题", "", "text", true, true)}${textarea("content_intent", "内容意图", "", true)}`, notice: "本次研究完全离线，不连接信息雷达。", run: data => action("create_research", data) });
}

function openResearchSource(researchId) {
  openDialog({ title: "添加研究资料", body: `${input("research_id", "研究 ID", researchId, "text", true, true)}${input("source_id", "资料来源 ID", `source-${Date.now()}`, "text", true, true)}${select("source_type", "资料类型", ["LOCAL_FILE","USER_NOTE","IMPORTED_RESEARCH","LEGACY_RESEARCH","FUTURE_RADAR_HANDOFF"], "USER_NOTE")}${input("reference", "来源引用", "local-ui-note", "text", true, true)}${textarea("summary", "摘要", "", true)}${textarea("evidence", "依据", "", true)}`, run: data => action("add_research_source", data) });
}

document.getElementById("refresh-button").addEventListener("click", navigate);
actionForm.addEventListener("submit", submitDialog);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && dialog.open) {
    event.preventDefault();
    dialog.close();
  }
});
document.getElementById("content-filters")?.addEventListener("submit", () => {});
document.addEventListener("submit", event => {
  if (event.target.id !== "content-filters") return;
  event.preventDefault();
  const values = new FormData(event.target);
  state.contentFilters = { state: values.get("state") || "", account: values.get("account") || "", blocked: event.target.elements.blocked.checked ? "true" : "", needs_action: event.target.elements.needs_action.checked ? "true" : "" };
  renderContent();
});
window.addEventListener("hashchange", navigate);
boot();
