const dom = {
  authStatus: document.getElementById("authStatus"),
  nextSlotLabel: document.getElementById("nextSlotLabel"),
  homeNextSlotLabel: document.getElementById("homeNextSlotLabel"),
  homeNotificationCount: document.getElementById("homeNotificationCount"),
  bannerNotifyText: document.getElementById("bannerNotifyText"),
  bannerAvatar: document.getElementById("bannerAvatar"),
  bannerName: document.getElementById("bannerName"),
  bannerSub: document.getElementById("bannerSub"),
  accountCard: document.getElementById("accountCard"),
  accountInfo: document.getElementById("accountInfo"),
  metricsSummary: document.getElementById("metricsSummary"),
  drafts: document.getElementById("drafts"),
  draftRangeLabel: document.getElementById("draftRangeLabel"),
  draftSummary: document.getElementById("draftSummary"),
  draftFilters: Array.from(document.querySelectorAll(".filter-chip")),
  notifications: document.getElementById("notifications"),
  postMetrics: document.getElementById("postMetrics"),
  backups: document.getElementById("backups"),
  categorySelector: document.getElementById("categorySelector"),
  topicSourceSelector: document.getElementById("topicSourceSelector"),
  imageModal: document.getElementById("imageModal"),
  modalImage: document.getElementById("modalImage"),
  scheduleEnabled: document.getElementById("scheduleEnabled"),
  publishStartHour: document.getElementById("publishStartHour"),
  publishEndHour: document.getElementById("publishEndHour"),
  generateLeadMinutes: document.getElementById("generateLeadMinutes"),
  reminderLeadMinutes: document.getElementById("reminderLeadMinutes"),
  hotSearchCount: document.getElementById("hotSearchCount"),
  notificationPushEnabled: document.getElementById("notificationPushEnabled"),
  copyMinLength: document.getElementById("copyMinLength"),
  copyMaxLength: document.getElementById("copyMaxLength"),
  llmTimeoutMs: document.getElementById("llmTimeoutMs"),
  imageWidth: document.getElementById("imageWidth"),
  imageHeight: document.getElementById("imageHeight"),
  maxImageCount: document.getElementById("maxImageCount"),
  textApiKey: document.getElementById("textApiKey"),
  textBaseUrl: document.getElementById("textBaseUrl"),
  textModel: document.getElementById("textModel"),
  imageProtocol: document.getElementById("imageProtocol"),
  imageApiKey: document.getElementById("imageApiKey"),
  imageBaseUrl: document.getElementById("imageBaseUrl"),
  imageModel: document.getElementById("imageModel"),
  modelCheckStatus: document.getElementById("modelCheckStatus"),
  btnLogin: document.getElementById("btnLogin"),
  btnSyncAccount: document.getElementById("btnSyncAccount"),
  btnGenerate: document.getElementById("btnGenerate"),
  btnGenerateDailyKindness: document.getElementById("btnGenerateDailyKindness"),
  btnSyncStats: document.getElementById("btnSyncStats"),
  btnBackup: document.getElementById("btnBackup"),
  btnTestNotify: document.getElementById("btnTestNotify"),
  btnReadAllNotifications: document.getElementById("btnReadAllNotifications"),
  btnSaveModelSettings: document.getElementById("btnSaveModelSettings"),
  btnCheckTextModel: document.getElementById("btnCheckTextModel"),
  btnCheckImageModel: document.getElementById("btnCheckImageModel"),
  btnRefreshAll: document.getElementById("btnRefreshAll"),
  btnSaveSchedule: document.getElementById("btnSaveSchedule"),
  btnCloseModal: document.getElementById("btnCloseModal"),
  btnBannerNotify: document.getElementById("btnBannerNotify"),
  navTabs: Array.from(document.querySelectorAll(".nav-tab")),
  pages: Array.from(document.querySelectorAll(".page"))
};

const state = {
  account: null,
  schedule: null,
  availableCategories: [],
  availableTopicSources: [],
  drafts: [],
  refineOpenDraftId: null,
  refiningDraftId: null,
  refineImageOptions: {},
  refineSuggestions: {},
  activeTab: "home",
  draftFilter: "today",
  draftFilterLabel: "今日微博"
};

const FALLBACK_AVATAR =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffd9b0"/><stop offset="100%" stop-color="#ffb36b"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(#g)"/><circle cx="48" cy="36" r="18" fill="#fff4e8"/><path d="M20 78c6-14 20-22 28-22s22 8 28 22" fill="#fff4e8"/></svg>'
  );

async function jsonFetch(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "request_failed");
  }
  return data;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCount(value) {
  const num = Number(value || 0);
  if (num >= 10000) {
    return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1)}万`;
  }
  return `${num}`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const current = new Date();
  const sameYear = date.getFullYear() === current.getFullYear();
  const formatter = new Intl.DateTimeFormat(
    "zh-CN",
    sameYear
      ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
  );
  return formatter.format(date);
}

function getDraftPrimaryTime(draft) {
  if (draft.updated_at && String(draft.source || "").startsWith("llm-refine:")) {
    return draft.updated_at;
  }
  return draft.created_at || draft.updated_at || draft.slot_time;
}

function sortDrafts(items) {
  return [...items].sort((left, right) => {
    if (left.__pending && !right.__pending) {
      return -1;
    }
    if (!left.__pending && right.__pending) {
      return 1;
    }
    const leftTime = new Date(getDraftPrimaryTime(left) || 0).getTime();
    const rightTime = new Date(getDraftPrimaryTime(right) || 0).getTime();
    return rightTime - leftTime;
  });
}

function switchTab(tab) {
  state.activeTab = tab;
  dom.navTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  dom.pages.forEach((page) => {
    page.classList.toggle("active", page.dataset.page === tab);
  });
}

function setDraftFilter(preset, label = null) {
  state.draftFilter = preset;
  if (label) {
    state.draftFilterLabel = label;
  }
  dom.draftFilters.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === preset);
  });
  dom.draftRangeLabel.textContent = state.draftFilterLabel;
}


function collectModelSettings() {
  return {
    textApiKey: dom.textApiKey.value.trim(),
    textBaseUrl: dom.textBaseUrl.value.trim(),
    textModel: dom.textModel.value.trim(),
    imageProtocol: dom.imageProtocol.value,
    imageApiKey: dom.imageApiKey.value.trim(),
    imageBaseUrl: dom.imageBaseUrl.value.trim(),
    imageModel: dom.imageModel.value.trim()
  };
}

function renderModelSettings(modelSettings) {
  dom.textApiKey.value = modelSettings.textApiKey || "";
  dom.textBaseUrl.value = modelSettings.textBaseUrl || "";
  dom.textModel.value = modelSettings.textModel || "";
  dom.imageProtocol.value = modelSettings.imageProtocol || "openai";
  dom.imageApiKey.value = modelSettings.imageApiKey || "";
  dom.imageBaseUrl.value = modelSettings.imageBaseUrl || "";
  dom.imageModel.value = modelSettings.imageModel || "";
}

async function loadModelSettings() {
  const data = await jsonFetch("/api/system/model-settings");
  renderModelSettings(data.modelSettings || {});
}

async function saveModelSettings() {
  const data = await jsonFetch("/api/system/model-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collectModelSettings())
  });
  renderModelSettings(data.modelSettings || {});
}

async function checkModelAvailability(type) {
  const endpoint = type === "image"
    ? "/api/system/model-settings/check-image"
    : "/api/system/model-settings/check-text";
  dom.modelCheckStatus.textContent = `模型检查状态：正在检查${type === "image" ? "图片模型" : "文本模型"}...`;
  const data = await jsonFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collectModelSettings())
  });
  dom.modelCheckStatus.textContent = `模型检查状态：${type === "image" ? "图片模型" : "文本模型"}可用 (${data.result.model})`;
}

function renderDraftSummary(filteredCount, summary) {
  const active = Number(summary?.active || 0);
  const deleted = Number(summary?.deleted || 0);
  const manualActive = Number(summary?.manualActive || 0);
  const scheduledActive = Number(summary?.scheduledActive || 0);
  dom.draftSummary.textContent = `当前筛选 ${filteredCount} 条 · 累计保存 ${active} 条 · 手动 ${manualActive} 条 · 准点 ${scheduledActive} 条 · 已删除 ${deleted} 条`;
}

function renderBannerAccount(account) {
  if (!account) {
    dom.bannerAvatar.src = FALLBACK_AVATAR;
    dom.bannerName.textContent = "未登录微博账号";
    dom.bannerSub.textContent = "请先完成微博登录";
    return;
  }

  dom.bannerAvatar.src = account.avatar_url || FALLBACK_AVATAR;
  dom.bannerName.textContent = account.screen_name || "微博账号";
  dom.bannerSub.textContent = account.description || `UID: ${account.user_id || "-"}`;
}

function renderCategorySelector(categories, selectedIds) {
  dom.categorySelector.innerHTML = categories
    .map((category) => {
      const checked = selectedIds.includes(category.id) ? "checked" : "";
      return `
        <label class="category-option">
          <input type="checkbox" name="contentCategoryIds" value="${escapeHtml(category.id)}" ${checked} />
          <span class="category-name">${escapeHtml(category.name)}</span>
          <span class="category-desc">${escapeHtml(category.description)}</span>
        </label>
      `;
    })
    .join("");
}

function renderTopicSourceSelector(availableSources, selectedSources, schedule) {
  const sourceMap = new Map((selectedSources || []).map((item) => [item.id, item]));
  dom.topicSourceSelector.innerHTML = availableSources
    .map((source) => {
      const selected = sourceMap.get(source.id) || {};
      const enabled = selected.enabled === undefined ? true : Boolean(selected.enabled);
      const priority = Number(selected.priority || source.defaultPriority || 99);
      let extraSettings = "";
      if (source.id === "weibo_hot_search") {
        extraSettings = `
            <div class="topic-source-extra">
              <div class="topic-source-extra-title">热搜范围</div>
              <div class="topic-source-range">
                <label class="topic-source-range-field">
                  <span>起始排名</span>
                  <input type="number" min="1" max="50" value="${Number(schedule?.weiboHotSearchStartRank || 1)}" data-role="weibo-hot-start-rank" />
                </label>
                <label class="topic-source-range-field">
                  <span>结束排名</span>
                  <input type="number" min="1" max="50" value="${Number(schedule?.weiboHotSearchEndRank || 20)}" data-role="weibo-hot-end-rank" />
                </label>
              </div>
              <div class="topic-source-extra-hint">例如设置 20-30，则只从微博热搜第 20 到第 30 名取候选。</div>
            </div>
          `;
      } else if (source.id === "google_news_cn") {
        extraSettings = `
            <div class="topic-source-extra">
              <div class="topic-source-extra-title">Google 热点候选数</div>
              <div class="topic-source-range">
                <label class="topic-source-range-field">
                  <span>候选条数</span>
                  <input type="number" min="1" max="30" value="${Number(schedule?.googleNewsTopicCount || 10)}" data-role="google-news-topic-count" />
                </label>
              </div>
              <div class="topic-source-extra-hint">默认 10 条，仅作用于 Google 新闻热点来源。</div>
            </div>
          `;
      }
      return `
        <label class="topic-source-option">
          <div class="topic-source-main">
            <div class="topic-source-title-row">
              <span class="topic-source-name">${escapeHtml(source.name)}</span>
              <span class="topic-source-type">${escapeHtml(source.type)}</span>
            </div>
            <div class="topic-source-desc">${escapeHtml(source.description || "")}</div>
            ${extraSettings}
          </div>
          <div class="topic-source-controls">
            <label class="topic-source-toggle">
              <input type="checkbox" data-role="topic-source-enabled" data-source-id="${escapeHtml(source.id)}" ${enabled ? "checked" : ""} />
              <span>启用</span>
            </label>
            <label class="topic-source-priority">
              <span>优先级</span>
              <input type="number" min="1" max="999" value="${priority}" data-role="topic-source-priority" data-source-id="${escapeHtml(source.id)}" />
            </label>
          </div>
        </label>
      `;
    })
    .join("");
}

function getSelectedCategoryIds() {
  return Array.from(
    dom.categorySelector.querySelectorAll('input[name="contentCategoryIds"]:checked')
  ).map((input) => input.value);
}

function getConfiguredTopicSources() {
  return state.availableTopicSources.map((source) => {
    const enabledInput = dom.topicSourceSelector.querySelector(
      `[data-role="topic-source-enabled"][data-source-id="${source.id}"]`
    );
    const priorityInput = dom.topicSourceSelector.querySelector(
      `[data-role="topic-source-priority"][data-source-id="${source.id}"]`
    );
    return {
      id: source.id,
      enabled: enabledInput ? enabledInput.checked : true,
      priority: priorityInput ? Number(priorityInput.value) : source.defaultPriority || 99
    };
  });
}

function getWeiboHotSearchRange() {
  const startInput = dom.topicSourceSelector.querySelector('[data-role="weibo-hot-start-rank"]');
  const endInput = dom.topicSourceSelector.querySelector('[data-role="weibo-hot-end-rank"]');
  return {
    weiboHotSearchStartRank: startInput ? Number(startInput.value) : 1,
    weiboHotSearchEndRank: endInput ? Number(endInput.value) : 20
  };
}

function getGoogleNewsTopicCount() {
  const countInput = dom.topicSourceSelector.querySelector('[data-role="google-news-topic-count"]');
  return countInput ? Number(countInput.value) : 10;
}

function renderAccountCard(account) {
  if (!account) {
    dom.accountCard.className = "account-card empty";
    dom.accountCard.textContent = "未登录微博账号";
    return;
  }

  const avatar = escapeHtml(account.avatar_url || FALLBACK_AVATAR);
  dom.accountCard.className = "account-card";
  dom.accountCard.innerHTML = `
    <div class="account-head">
      <img class="avatar" src="${avatar}" alt="avatar" />
      <div>
        <div class="account-name">${escapeHtml(account.screen_name || "微博账号")}</div>
        <div class="hint">UID: ${escapeHtml(account.user_id || "-")}</div>
      </div>
    </div>
    <div class="account-desc">${escapeHtml(account.description || "暂无简介")}</div>
    <div class="account-stats">
      <div class="stat-chip">
        <strong>${formatCount(account.followers_count)}</strong>
        <span>粉丝</span>
      </div>
      <div class="stat-chip">
        <strong>${formatCount(account.friends_count)}</strong>
        <span>关注</span>
      </div>
      <div class="stat-chip">
        <strong>${formatCount(account.statuses_count)}</strong>
        <span>微博</span>
      </div>
    </div>
  `;
}

function renderMetricsSummary(account) {
  if (!account) {
    dom.metricsSummary.innerHTML = `
      <div class="metric-card"><strong>-</strong><span>粉丝</span></div>
      <div class="metric-card"><strong>-</strong><span>关注</span></div>
      <div class="metric-card"><strong>-</strong><span>微博数</span></div>
    `;
    return;
  }

  dom.metricsSummary.innerHTML = `
    <div class="metric-card"><strong>${formatCount(account.followers_count)}</strong><span>粉丝总数</span></div>
    <div class="metric-card"><strong>${formatCount(account.friends_count)}</strong><span>关注总数</span></div>
    <div class="metric-card"><strong>${formatCount(account.statuses_count)}</strong><span>累计发帖</span></div>
  `;
}

function renderSchedule(schedule, nextSlot, availableCategories, availableTopicSources) {
  state.schedule = schedule;
  if (availableCategories) {
    state.availableCategories = availableCategories;
  }
  if (availableTopicSources) {
    state.availableTopicSources = availableTopicSources;
  }

  dom.scheduleEnabled.checked = Boolean(schedule.enabled);
  dom.publishStartHour.value = schedule.publishStartHour;
  dom.publishEndHour.value = schedule.publishEndHour;
  dom.generateLeadMinutes.value = schedule.generateLeadMinutes;
  dom.reminderLeadMinutes.value = schedule.reminderLeadMinutes;
  dom.hotSearchCount.value = schedule.hotSearchCount;
  dom.notificationPushEnabled.checked = Boolean(schedule.notificationPushEnabled);
  dom.copyMinLength.value = schedule.copyMinLength;
  dom.copyMaxLength.value = schedule.copyMaxLength;
  dom.llmTimeoutMs.value = schedule.llmTimeoutMs;
  dom.imageWidth.value = schedule.imageWidth;
  dom.imageHeight.value = schedule.imageHeight;
  dom.maxImageCount.value = schedule.maxImageCount;
  dom.nextSlotLabel.textContent = `下一时段：${formatDateTime(nextSlot)}`;
  dom.homeNextSlotLabel.textContent = formatDateTime(nextSlot);
  renderCategorySelector(state.availableCategories, schedule.contentCategoryIds || []);
  renderTopicSourceSelector(state.availableTopicSources, schedule.topicSources || [], schedule);
}

function buildWeiboImages(images) {
  if (!images.length) {
    return "";
  }

  return `
    <div class="weibo-images">
      ${images
        .map(
          (url) => `
            <button class="weibo-image" type="button" data-action="preview-image" data-url="${escapeHtml(url)}">
              <img src="${escapeHtml(url)}" alt="draft image" />
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function buildLoadingBody() {
  return `
    <div class="loading-copy">
      <span class="loading-line long"></span>
      <span class="loading-line"></span>
      <span class="loading-line short"></span>
    </div>
  `;
}

function buildRefineComposer(draft, isRefining) {
  const suggestion = escapeHtml(state.refineSuggestions[draft.id] || "");
  const refineImages = Boolean(state.refineImageOptions[draft.id]);
  return `
    <div class="refine-panel ${isRefining ? "is-loading" : ""}" data-draft-id="${draft.id}">
      <div class="refine-title">AI 润色</div>
      <div class="refine-hint">输入修改建议后，系统会重新生成当前这条微博内容。需要改图时，勾选“同时润色图片”。</div>
      <textarea
        class="refine-textarea"
        data-role="refine-suggestion"
        data-id="${draft.id}"
        placeholder="例如：语气更专业，减少口语化，补一个更明确的观点；首图更有科技感，第二张突出人物近景。"
        ${isRefining ? "disabled" : ""}
      >${suggestion}</textarea>
      <label class="refine-checkbox">
        <input
          type="checkbox"
          data-role="refine-images"
          data-id="${draft.id}"
          ${refineImages ? "checked" : ""}
          ${isRefining ? "disabled" : ""}
        />
        <span>同时润色图片</span>
      </label>
      <div class="refine-actions">
        <button class="secondary" data-action="cancel-refine" data-id="${draft.id}" type="button" ${isRefining ? "disabled" : ""}>取消</button>
        <button data-action="submit-refine" data-id="${draft.id}" type="button" ${isRefining ? "disabled" : ""}>${isRefining ? "润色中..." : "提交润色"}</button>
      </div>
    </div>
  `;
}

function buildCardMenu(draft) {
  return `
    <details class="card-menu">
      <summary class="card-menu-trigger" aria-label="more actions">···</summary>
      <div class="card-menu-panel">
        <button class="card-menu-item" data-action="toggle-refine" data-id="${draft.id}" type="button">AI 润色</button>
        <button class="card-menu-item" data-action="approve" data-id="${draft.id}" type="button">批准</button>
        <button class="card-menu-item" data-action="reject" data-id="${draft.id}" type="button">驳回</button>
        <button class="card-menu-item" data-action="sent" data-id="${draft.id}" type="button">标记已发送</button>
        <button class="card-menu-item danger" data-action="delete-draft" data-id="${draft.id}" type="button">删除</button>
      </div>
    </details>
  `;
}

function renderDrafts(items) {
  const drafts = sortDrafts(items);
  if (!drafts.length) {
    dom.drafts.innerHTML = `<div class="item">${escapeHtml(state.draftFilterLabel)}暂无草稿。</div>`;
    return;
  }

  const account = state.account || {};
  const avatar = escapeHtml(account.avatar_url || FALLBACK_AVATAR);
  const screenName = escapeHtml(account.screen_name || "微博草稿预览");

  dom.drafts.innerHTML = drafts
    .map((draft) => {
      const images = Array.isArray(draft.image_urls) ? draft.image_urls : [];
      const isRefining = !draft.__pending && String(state.refiningDraftId) === String(draft.id);
      const showRefine = !draft.__pending && String(state.refineOpenDraftId) === String(draft.id);
      const status = draft.__pending ? "generating" : isRefining ? "refining" : draft.status || "pending";
      const statusText = draft.__pending ? "生成中" : isRefining ? "润色中" : status;
      const primaryTime = formatDateTime(getDraftPrimaryTime(draft));
      const plannedTime = draft.planned_publish_time
        ? ` · 计划发送 ${formatDateTime(draft.planned_publish_time)}`
        : draft.generation_mode === "scheduled" && draft.slot_time
          ? ` · 槽位 ${formatDateTime(draft.slot_time)}`
          : "";
      const refineMark = !draft.__pending && String(draft.source || "").startsWith("llm-refine:") ? " · 已 AI 润色" : "";
      const metaLine = draft.__pending
        ? `${primaryTime} · ${escapeHtml(draft.__pendingMessage || "正在抓取多来源话题并生成内容")}`
        : `${primaryTime}${plannedTime} · ${escapeHtml(draft.source || "-")}${refineMark}`;

      return `
        <article class="weibo-card ${draft.__pending ? "loading-card" : ""} ${isRefining ? "refining" : ""}">
          <div class="weibo-head">
            <img class="avatar" src="${avatar}" alt="avatar" />
            <div class="weibo-user">
              <div class="weibo-name">${screenName}</div>
              <div class="weibo-meta">${metaLine}</div>
            </div>
            <span class="draft-status ${escapeHtml(status)}">${escapeHtml(statusText)}</span>
            ${draft.__pending ? "" : buildCardMenu(draft)}
          </div>
          <div class="weibo-copy">
            ${draft.__pending ? buildLoadingBody() : escapeHtml(draft.text)}
          </div>
          ${draft.__pending ? "" : buildWeiboImages(images)}
          ${showRefine ? buildRefineComposer(draft, isRefining) : ""}
          <div class="weibo-toolbar">
            <div class="toolbar-item">${draft.__pending ? "聚合中" : "转发"} <span>·</span> ${draft.__pending ? "来源" : "待发送"}</div>
            <div class="toolbar-item">${draft.__pending ? "分析中" : "评论"} <span>·</span> ${draft.__pending ? "话题" : "预览"}</div>
            <div class="toolbar-item">${draft.__pending ? "等待" : "赞"} <span>·</span> ${draft.__pending ? "完成" : "草稿"}</div>
            <div class="toolbar-item">${draft.__pending ? "即将" : "阅读"} <span>·</span> ${draft.__pending ? "展示" : "预计"}</div>
          </div>
          ${
            draft.__pending
              ? `<div class="loading-footer"><span class="pulse-dot"></span>${escapeHtml(draft.__pendingMessage || "正在生成微博草稿，请稍候...")}</div>`
              : isRefining
                ? '<div class="loading-footer"><span class="pulse-dot"></span>正在根据你的建议重写这条微博...</div>'
                : ""
          }
        </article>
      `;
    })
    .join("");
}

function prependPendingDraft(message = "正在生成微博草稿，请稍候...") {
  const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pendingDraft = {
    id: pendingId,
    __pendingRequestId: pendingId,
    text: "",
    image_urls: [],
    created_at: new Date().toISOString(),
    planned_publish_time: null,
    __pending: true,
    __pendingMessage: message
  };
  state.drafts = [pendingDraft, ...state.drafts];
  renderDrafts(state.drafts);
  return pendingId;
}

function replacePendingDraft(pendingId, draft) {
  let replaced = false;
  state.drafts = state.drafts.map((item) => {
    if (item.__pending && item.__pendingRequestId === pendingId) {
      replaced = true;
      return draft;
    }
    return item;
  });
  if (!replaced) {
    state.drafts = [draft, ...state.drafts];
  }
  renderDrafts(state.drafts);
}

function removePendingDraft(pendingId) {
  state.drafts = state.drafts.filter((item) => item.__pendingRequestId !== pendingId);
  renderDrafts(state.drafts);
}

function updateDraftInState(draft) {
  let found = false;
  state.drafts = state.drafts
    .filter((item) => !item.__pending)
    .map((item) => {
      if (String(item.id) === String(draft.id)) {
        found = true;
        return draft;
      }
      return item;
    });

  if (!found) {
    state.drafts = [draft, ...state.drafts];
  }
  renderDrafts(state.drafts);
}

function toggleRefinePanel(id) {
  state.refineOpenDraftId = String(state.refineOpenDraftId) === String(id) ? null : id;
  renderDrafts(state.drafts);
}

async function submitRefineDraft(id, suggestionInput) {
  const suggestion = String(suggestionInput || "").trim();
  const refineImages = Boolean(state.refineImageOptions[id]);
  if (suggestion.length < 2) {
    alert("请输入更明确的修改建议。");
    return;
  }

  state.refiningDraftId = id;
  renderDrafts(state.drafts);

  try {
    const data = await post(`/api/content/drafts/${id}/refine`, { suggestion, refineImages });
    delete state.refineSuggestions[id];
    delete state.refineImageOptions[id];
    state.refiningDraftId = null;
    state.refineOpenDraftId = null;
    updateDraftInState(data.draft);
    await loadNotifications();
  } catch (error) {
    state.refiningDraftId = null;
    renderDrafts(state.drafts);
    await loadNotifications();
    alert(error.message);
  }
}

function renderNotificationSummary(count) {
  dom.homeNotificationCount.textContent = String(count);
  dom.bannerNotifyText.textContent = count > 0 ? `${count} 条未读提醒` : "暂无未读提醒";
  if (dom.btnReadAllNotifications) {
    dom.btnReadAllNotifications.disabled = count === 0;
    dom.btnReadAllNotifications.textContent = count > 0 ? `全部已读 (${count})` : "全部已读";
  }
}

async function loadSchedule() {
  const data = await jsonFetch("/api/content/settings");
  renderSchedule(
    data.schedule,
    data.nextSlot,
    data.availableCategories || [],
    data.availableTopicSources || []
  );
}

async function saveSchedule() {
  const weiboRange = getWeiboHotSearchRange();
  const googleNewsTopicCount = getGoogleNewsTopicCount();
  const payload = {
    enabled: dom.scheduleEnabled.checked,
    publishStartHour: Number(dom.publishStartHour.value),
    publishEndHour: Number(dom.publishEndHour.value),
    generateLeadMinutes: Number(dom.generateLeadMinutes.value),
    reminderLeadMinutes: Number(dom.reminderLeadMinutes.value),
    hotSearchCount: Number(dom.hotSearchCount.value),
    notificationPushEnabled: dom.notificationPushEnabled.checked,
    copyMinLength: Number(dom.copyMinLength.value),
    copyMaxLength: Number(dom.copyMaxLength.value),
    googleNewsTopicCount,
    weiboHotSearchStartRank: weiboRange.weiboHotSearchStartRank,
    weiboHotSearchEndRank: weiboRange.weiboHotSearchEndRank,
    llmTimeoutMs: Number(dom.llmTimeoutMs.value),
    imageWidth: Number(dom.imageWidth.value),
    imageHeight: Number(dom.imageHeight.value),
    maxImageCount: Number(dom.maxImageCount.value),
    contentCategoryIds: getSelectedCategoryIds(),
    topicSources: getConfiguredTopicSources()
  };
  const data = await jsonFetch("/api/content/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  renderSchedule(
    data.schedule,
    data.nextSlot,
    state.availableCategories,
    data.availableTopicSources || state.availableTopicSources
  );
}

async function loadAccount() {
  const data = await jsonFetch("/api/auth/me");
  state.account = data.account || null;

  if (!data.hasToken) {
    dom.authStatus.textContent = "微博未登录，内容生成仍可用，但账号同步不可用。";
    dom.accountInfo.textContent = "请先完成微博 OAuth 登录。";
    renderBannerAccount(null);
    renderAccountCard(null);
    renderMetricsSummary(null);
    return;
  }

  dom.authStatus.textContent = `微博已登录，最近一次 token 更新时间：${formatDateTime(data.tokenUpdatedAt)}`;
  dom.accountInfo.textContent = JSON.stringify(data.account || {}, null, 2);
  renderBannerAccount(data.account);
  renderAccountCard(data.account);
  renderMetricsSummary(data.account);
}

async function loadDrafts(preset = state.draftFilter) {
  const data = await jsonFetch(`/api/content/drafts?preset=${encodeURIComponent(preset)}`);
  const pendingDrafts = state.drafts.filter((item) => item.__pending);
  state.drafts = sortDrafts([...(data.drafts || []), ...pendingDrafts]);
  setDraftFilter(data.preset || preset, data.label || state.draftFilterLabel);
  renderDraftSummary(Number(data.filteredCount || state.drafts.length), data.summary || {});
  renderDrafts(state.drafts);
}

async function loadNotifications() {
  const data = await jsonFetch("/api/content/notifications?unreadOnly=true");
  const items = data.notifications || [];
  renderNotificationSummary(items.length);

  if (!items.length) {
    dom.notifications.innerHTML = '<div class="item">暂无未读提醒。</div>';
    return;
  }

  dom.notifications.innerHTML = items
    .map(
      (item) => `
        <div class="item">
          <strong>${escapeHtml(item.type)}</strong>
          <div>${escapeHtml(item.message)}</div>
          <div class="hint">${formatDateTime(item.created_at)}</div>
          <div class="actions">
            <button class="secondary" data-action="read-notification" data-id="${item.id}">标记已读</button>
          </div>
        </div>
      `
    )
    .join("");
}

async function loadMetrics() {
  const data = await jsonFetch("/api/stats/overview");
  const account = data.account || null;
  if (account) {
    renderMetricsSummary(account);
  }

  dom.accountInfo.textContent = JSON.stringify(
    {
      account,
      latestSnapshot: data.latestSnapshot || null
    },
    null,
    2
  );

  const posts = data.posts || [];
  if (!posts.length) {
    dom.postMetrics.innerHTML = '<div class="item">暂无微博统计数据。</div>';
    return;
  }

  dom.postMetrics.innerHTML = posts
    .slice(0, 12)
    .map(
      (post) => `
        <div class="item">
          <strong>${escapeHtml(post.text_snippet || "无内容摘要")}</strong>
          <div class="hint">${formatDateTime(post.created_at_weibo || post.crawled_at)}</div>
          <div class="metric-row">
            <span>阅读 ${post.views ?? "-"}</span>
            <span>点赞 ${post.likes ?? 0}</span>
            <span>评论 ${post.comments ?? 0}</span>
            <span>转发 ${post.reposts ?? 0}</span>
          </div>
        </div>
      `
    )
    .join("");
}

async function loadBackups() {
  const data = await jsonFetch("/api/system/backups");
  const files = data.files || [];
  if (!files.length) {
    dom.backups.innerHTML = '<div class="item">暂无备份文件。</div>';
    return;
  }

  dom.backups.innerHTML = files
    .slice(0, 20)
    .map((name) => `<div class="item">${escapeHtml(name)}</div>`)
    .join("");
}

async function refreshAll() {
  const tasks = [
    loadSchedule(),
    loadModelSettings(),
    loadAccount(),
    loadDrafts(state.draftFilter),
    loadNotifications(),
    loadMetrics(),
    loadBackups()
  ];
  const settled = await Promise.allSettled(tasks);
  const failed = settled.filter((item) => item.status === "rejected");
  if (failed.length) {
    console.error("refresh errors", failed);
  }
}

async function post(url, body = {}) {
  return jsonFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function generateDraftNow() {
  switchTab("home");
  setDraftFilter("today", "今日微博");
  const pendingId = prependPendingDraft("正在抓取多来源话题并生成热点草稿...");
  try {
    const data = await post("/api/content/generate-next", { immediate: true });
    replacePendingDraft(pendingId, data.draft);
    await Promise.all([loadDrafts("today"), loadNotifications(), loadBackups()]);
  } catch (error) {
    removePendingDraft(pendingId);
    alert(error.message);
  }
}

async function generateDailyKindnessDraftNow() {
  switchTab("home");
  setDraftFilter("today", "今日微博");
  const pendingId = prependPendingDraft("正在生成每日一善超话草稿...");
  try {
    const data = await post("/api/content/generate-daily-kindness");
    replacePendingDraft(pendingId, data.draft);
    await Promise.all([loadDrafts("today"), loadNotifications(), loadBackups()]);
  } catch (error) {
    removePendingDraft(pendingId);
    alert(error.message);
  }
}

async function deleteDraft(id) {
  await jsonFetch(`/api/content/drafts/${id}`, { method: "DELETE" });
  state.drafts = state.drafts.filter((item) => String(item.id) !== String(id));
  renderDrafts(state.drafts);
  await loadDrafts(state.draftFilter);
}

function openImage(url) {
  dom.modalImage.src = url;
  dom.imageModal.classList.remove("hidden");
}

function closeImage() {
  dom.modalImage.src = "";
  dom.imageModal.classList.add("hidden");
}

dom.navTabs.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tab || "home");
  });
});

dom.draftFilters.forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      setDraftFilter(button.dataset.filter || "today", `${button.textContent.trim()}微博`);
      await loadDrafts(button.dataset.filter || "today");
    } catch (error) {
      alert(error.message);
    }
  });
});

dom.btnBannerNotify.addEventListener("click", () => {
  switchTab("home");
  dom.notifications.scrollIntoView({ behavior: "smooth", block: "start" });
});

dom.btnLogin.addEventListener("click", () => {
  window.location.href = "/api/auth/weibo/login";
});

dom.btnSyncAccount.addEventListener("click", async () => {
  try {
    await post("/api/auth/sync");
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

dom.btnGenerate.addEventListener("click", generateDraftNow);
dom.btnGenerateDailyKindness.addEventListener("click", generateDailyKindnessDraftNow);

dom.btnSaveSchedule.addEventListener("click", async () => {
  try {
    await saveSchedule();
    alert("配置已保存。");
  } catch (error) {
    alert(error.message);
  }
});

dom.btnSyncStats.addEventListener("click", async () => {
  try {
    await post("/api/stats/sync");
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

dom.btnBackup.addEventListener("click", async () => {
  try {
    await post("/api/system/backup");
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

dom.btnTestNotify.addEventListener("click", async () => {
  try {
    const data = await post("/api/system/notify/test");
    alert(`飞书返回: ${JSON.stringify(data.result)}`);
    await loadNotifications();
  } catch (error) {
    alert(error.message);
  }
});


dom.btnSaveModelSettings.addEventListener("click", async () => {
  try {
    await saveModelSettings();
    dom.modelCheckStatus.textContent = "模型检查状态：模型配置已保存";
  } catch (error) {
    alert(error.message);
  }
});

dom.btnCheckTextModel.addEventListener("click", async () => {
  try {
    await checkModelAvailability("text");
  } catch (error) {
    dom.modelCheckStatus.textContent = `模型检查状态：文本模型不可用 (${error.message})`;
    alert(error.message);
  }
});

dom.btnCheckImageModel.addEventListener("click", async () => {
  try {
    await checkModelAvailability("image");
  } catch (error) {
    dom.modelCheckStatus.textContent = `模型检查状态：图片模型不可用 (${error.message})`;
    alert(error.message);
  }
});

dom.btnReadAllNotifications.addEventListener("click", async () => {
  try {
    await post("/api/content/notifications/read-all");
    await loadNotifications();
  } catch (error) {
    alert(error.message);
  }
});

dom.btnRefreshAll.addEventListener("click", refreshAll);
dom.btnCloseModal.addEventListener("click", closeImage);
dom.imageModal.addEventListener("click", (event) => {
  if (event.target === dom.imageModal) {
    closeImage();
  }
});

document.body.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement && target.dataset.role === "refine-suggestion") {
    state.refineSuggestions[target.dataset.id] = target.value;
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.role === "refine-images") {
    state.refineImageOptions[target.dataset.id] = target.checked;
  }
});

document.body.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionHost = target.closest("[data-action]");
  if (!(actionHost instanceof HTMLElement)) {
    if (!target.closest(".card-menu")) {
      document.querySelectorAll(".card-menu[open]").forEach((menu) => {
        menu.removeAttribute("open");
      });
    }
    return;
  }

  const action = actionHost.getAttribute("data-action");
  const id = actionHost.getAttribute("data-id");
  const url = actionHost.getAttribute("data-url");

  try {
    if (action === "toggle-refine") {
      toggleRefinePanel(id);
      return;
    }
    if (action === "cancel-refine") {
      state.refineOpenDraftId = null;
      renderDrafts(state.drafts);
      return;
    }
    if (action === "submit-refine") {
      const panel = actionHost.closest(".refine-panel");
      const textarea = panel ? panel.querySelector('[data-role="refine-suggestion"]') : null;
      await submitRefineDraft(id, textarea ? textarea.value : state.refineSuggestions[id] || "");
      return;
    }
    if (action === "approve" || action === "reject" || action === "sent") {
      await post(`/api/content/drafts/${id}/${action}`);
      await refreshAll();
      return;
    }
    if (action === "delete-draft") {
      await deleteDraft(id);
      return;
    }
    if (action === "read-notification") {
      await post(`/api/content/notifications/${id}/read`);
      await loadNotifications();
      return;
    }
    if (action === "preview-image" && url) {
      openImage(url);
    }
  } catch (error) {
    alert(error.message);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeImage();
  }
});

renderBannerAccount(null);
renderNotificationSummary(0);
setDraftFilter("today", "今日微博");
renderDraftSummary(0, {});
switchTab("home");
refreshAll();
