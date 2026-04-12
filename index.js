const MODULE_NAME = "shoucangjia";
const PANEL_ID = "scj-panel";
const BUBBLE_ID = "scj-selection-bubble";
const IMPORT_INPUT_ID = "scj-import-input";
const SETTINGS_BLOCK_ID = "scj-settings-block";
const MOBILE_SAVE_ID = "scj-mobile-save";

const DEFAULT_SETTINGS = {
  favorites: [],
  highlightsByChatKey: {},
};

const IS_TOUCH = "ontouchstart" in window || (navigator?.maxTouchPoints || 0) > 0;

let selectionState = null;
let observer = null;
let highlightDebounceTimer = null;
let selectionSyncTimer = null;

let saveSettingsDebounced = null;
let extension_settings = null;
let getContext = null;

async function importAny(paths) {
  for (const p of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await import(p);
    } catch {
      // continue
    }
  }
  throw new Error(`Cannot import module from paths: ${paths.join(", ")}`);
}

async function bootstrap() {
  const scriptModule = await importAny(["/script.js", "../../../../script.js", "../../../script.js"]);
  const extModule = await importAny(["/scripts/extensions.js", "../../../extensions.js", "../../extensions.js"]);

  saveSettingsDebounced = scriptModule.saveSettingsDebounced;
  extension_settings = extModule.extension_settings;
  getContext = extModule.getContext;

  if (!saveSettingsDebounced || !extension_settings || !getContext) {
    throw new Error("SillyTavern APIs missing.");
  }

  init();
}

function init() {
  initSettings();
  mountUI();
  mountSettingsEntry();
  bindSelectionEvents();
  observeChatDom();
  applyHighlightsDebounced();
}

function initSettings() {
  if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    saveSettingsDebounced();
  }
  const current = extension_settings[MODULE_NAME];
  current.favorites = Array.isArray(current.favorites) ? current.favorites : [];
  current.highlightsByChatKey =
    current.highlightsByChatKey && typeof current.highlightsByChatKey === "object"
      ? current.highlightsByChatKey
      : {};
}

function getSettings() {
  return extension_settings[MODULE_NAME];
}

function getChatElements() {
  return Array.from(document.querySelectorAll("#chat .mes"));
}

function getSessionInfo(ctx = getContext()) {
  const characterName = ctx?.name2 || "未知角色";
  const chatMeta = ctx?.chatMetadata || {};
  const chatId = chatMeta.main_chat || chatMeta.chat_id || chatMeta.file_name || ctx?.chatId || "unknown-chat";
  const groupId = ctx?.groupId ?? null;
  const characterId = ctx?.characterId ?? null;
  const chatKey = JSON.stringify({ characterName, characterId, groupId, chatId });
  return { characterName, characterId, groupId, chatId, chatKey };
}

function mountUI() {
  if (!document.getElementById(PANEL_ID)) {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = panelTemplate();
    document.body.appendChild(panel);

    panel.querySelector(".scj-close-btn")?.addEventListener("click", closePanel);
    panel.querySelector(".scj-export-btn")?.addEventListener("click", exportFavorites);
    panel.querySelector(".scj-import-btn")?.addEventListener("click", () => {
      panel.querySelector(`#${IMPORT_INPUT_ID}`)?.click();
    });
    panel.querySelector(`#${IMPORT_INPUT_ID}`)?.addEventListener("change", importFavorites);
    panel.querySelectorAll(".scj-filter").forEach((el) => {
      el.addEventListener("input", renderFavorites);
      el.addEventListener("change", renderFavorites);
    });
    panel.querySelector(".scj-list")?.addEventListener("click", onListAction);
  }

  if (!document.getElementById(MOBILE_SAVE_ID)) {
    const btn = document.createElement("button");
    btn.id = MOBILE_SAVE_ID;
    btn.type = "button";
    btn.textContent = "收藏选中";
    btn.title = "收藏当前选中的文本";
    btn.addEventListener("click", () => saveCurrentSelection(false));
    document.body.appendChild(btn);
  }
}

function mountSettingsEntry() {
  const container = document.getElementById("extensions_settings2");
  if (!container || document.getElementById(SETTINGS_BLOCK_ID)) return;

  const block = document.createElement("div");
  block.id = SETTINGS_BLOCK_ID;
  block.className = "scj-settings-entry";
  block.innerHTML = `
    <div class="scj-settings-title">收藏夹</div>
    <div class="scj-settings-actions">
      <button type="button" class="menu_button" data-action="open">打开收藏夹</button>
      <button type="button" class="menu_button" data-action="save">收藏选中</button>
      <button type="button" class="menu_button" data-action="save-highlight">高亮并收藏</button>
    </div>
    <div class="scj-settings-hint">提示：手机长按选中文本后，页面底部会出现“收藏选中”。</div>
  `;
  block.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (action === "open") openPanel();
    if (action === "save") {
      refreshSelectionState();
      saveCurrentSelection(false);
    }
    if (action === "save-highlight") {
      refreshSelectionState();
      saveCurrentSelection(true);
    }
  });
  container.prepend(block);
}

function panelTemplate() {
  return `
    <div class="scj-panel-mask"></div>
    <div class="scj-panel-card">
      <div class="scj-panel-header">
        <h3>收藏夹</h3>
        <div class="scj-header-actions">
          <button type="button" class="menu_button scj-export-btn">导出</button>
          <button type="button" class="menu_button scj-import-btn">导入</button>
          <button type="button" class="menu_button scj-close-btn">关闭</button>
        </div>
      </div>
      <div class="scj-filters">
        <input class="text_pole scj-filter" data-filter="character" placeholder="按角色筛选" />
        <input class="text_pole scj-filter" data-filter="session" placeholder="按会话ID筛选" />
        <input class="text_pole scj-filter" data-filter="note" placeholder="按备注筛选" />
        <input class="text_pole scj-filter" data-filter="tags" placeholder="按标签筛选" />
        <input class="text_pole scj-filter" data-filter="search" placeholder="全文搜索" />
        <select class="text_pole scj-filter" data-filter="sort">
          <option value="desc">时间：最新在前</option>
          <option value="asc">时间：最早在前</option>
        </select>
      </div>
      <div class="scj-list"></div>
      <input id="${IMPORT_INPUT_ID}" type="file" accept="application/json" hidden />
    </div>
  `;
}

function openPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  panel.classList.add("scj-open");
  renderFavorites();
}

function closePanel() {
  document.getElementById(PANEL_ID)?.classList.remove("scj-open");
}

function renderFavorites() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  const list = panel.querySelector(".scj-list");
  if (!list) return;

  const characterFilter = (panel.querySelector('[data-filter="character"]')?.value || "").trim().toLowerCase();
  const sessionFilter = (panel.querySelector('[data-filter="session"]')?.value || "").trim().toLowerCase();
  const noteFilter = (panel.querySelector('[data-filter="note"]')?.value || "").trim().toLowerCase();
  const tagsFilter = (panel.querySelector('[data-filter="tags"]')?.value || "").trim().toLowerCase();
  const fullTextFilter = (panel.querySelector('[data-filter="search"]')?.value || "").trim().toLowerCase();
  const sort = panel.querySelector('[data-filter="sort"]')?.value || "desc";

  const filtered = getSettings().favorites
    .filter((item) => {
      const c = (item.session?.characterName || "").toLowerCase();
      const s = (item.session?.chatId || "").toLowerCase();
      const n = (item.note || "").toLowerCase();
      const tags = (Array.isArray(item.tags) ? item.tags : []).join(" ").toLowerCase();
      const fullTextBlob = [
        item.selection?.text || "",
        item.note || "",
        (item.snapshot?.contextMessages || []).map((m) => m?.mes || "").join("\n"),
      ]
        .join("\n")
        .toLowerCase();
      return (!characterFilter || c.includes(characterFilter)) &&
        (!sessionFilter || s.includes(sessionFilter)) &&
        (!noteFilter || n.includes(noteFilter)) &&
        (!tagsFilter || tags.includes(tagsFilter)) &&
        (!fullTextFilter || fullTextBlob.includes(fullTextFilter));
    })
    .sort((a, b) => {
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      return sort === "asc" ? at - bt : bt - at;
    });

  if (!filtered.length) {
    list.innerHTML = `<div class="scj-empty">暂无收藏。</div>`;
    return;
  }

  const byCharacter = groupBy(filtered, (it) => it.session?.characterName || "未知角色");
  const sections = Object.entries(byCharacter).map(([characterName, items]) => {
    const cards = items.map(renderCard).join("");
    return `
      <section class="scj-character-group">
        <h4>${escapeHtml(characterName)} <small>(${items.length})</small></h4>
        ${cards}
      </section>
    `;
  });

  list.innerHTML = sections.join("");
}

function renderCard(item) {
  const quote = ellipsis(item.selection?.text || "", 140);
  const note = item.note ? `<div class="scj-note">备注：${escapeHtml(item.note)}</div>` : "";
  const createdAt = formatDate(item.createdAt);
  const chatId = escapeHtml(item.session?.chatId || "unknown-chat");
  const charName = escapeHtml(item.session?.characterName || "未知角色");
  const contextHtml = renderContext(item.snapshot?.contextMessages || []);
  const charSnapshot = escapeHtml(JSON.stringify(item.snapshot?.characterCard || {}, null, 2));
  const tags = Array.isArray(item.tags) && item.tags.length
    ? `<div class="scj-tags">${item.tags.map((t) => `<span class="scj-tag">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";

  return `
    <article class="scj-card" data-id="${escapeHtml(item.id)}">
      <div class="scj-meta">${charName} | ${createdAt} | 会话: ${chatId}</div>
      <blockquote>${escapeHtml(quote)}</blockquote>
      ${tags}
      ${note}
      <div class="scj-actions">
        <button type="button" class="menu_button" data-action="toggle">查看快照</button>
        <button type="button" class="menu_button" data-action="jump">跳转原消息</button>
        <button type="button" class="menu_button menu_button_danger" data-action="delete">删除</button>
      </div>
      <details class="scj-details">
        <summary>上下文 + 角色快照</summary>
        <div class="scj-subtitle">上下 5 条聊天记录</div>
        <div class="scj-context">${contextHtml}</div>
        <div class="scj-subtitle">收藏时角色信息快照</div>
        <pre>${charSnapshot}</pre>
      </details>
    </article>
  `;
}

function renderContext(messages) {
  if (!messages.length) return `<div class="scj-empty-context">没有上下文快照</div>`;
  return messages
    .map((m) => {
      const name = escapeHtml(m.name || (m.is_user ? "你" : "角色"));
      const text = escapeHtml(m.mes || "");
      return `<div class="scj-context-row"><b>${name}</b>: ${text}</div>`;
    })
    .join("");
}

function onListAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action) return;
  const card = target.closest(".scj-card");
  const id = card?.getAttribute("data-id");
  if (!id) return;

  if (action === "delete") {
    if (!confirm("确认删除这条收藏吗？")) return;
    const settings = getSettings();
    settings.favorites = settings.favorites.filter((it) => it.id !== id);
    for (const key of Object.keys(settings.highlightsByChatKey)) {
      settings.highlightsByChatKey[key] = settings.highlightsByChatKey[key].filter((h) => h.favoriteId !== id);
    }
    saveSettingsDebounced();
    applyHighlightsDebounced();
    renderFavorites();
    return;
  }

  if (action === "toggle") {
    const details = card?.querySelector(".scj-details");
    if (details) details.open = !details.open;
    return;
  }

  if (action === "jump") {
    jumpToOriginalMessage(id);
  }
}

function bindSelectionEvents() {
  document.addEventListener("selectionchange", scheduleSelectionRefresh);
  document.addEventListener("mouseup", scheduleSelectionRefresh);
  document.addEventListener("touchend", scheduleSelectionRefresh, { passive: true });
  document.addEventListener("scroll", () => {
    if (!selectionState) hideSelectionBubble();
  }, true);
  if (!IS_TOUCH) {
    document.addEventListener("mousedown", hideSelectionBubble);
  }
}

function scheduleSelectionRefresh() {
  clearTimeout(selectionSyncTimer);
  selectionSyncTimer = setTimeout(refreshSelectionState, IS_TOUCH ? 120 : 10);
}

function refreshSelectionState() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    selectionState = null;
    hideSelectionBubble();
    hideMobileSave();
    return;
  }

  const text = selection.toString().trim();
  if (!text) {
    selectionState = null;
    hideSelectionBubble();
    hideMobileSave();
    return;
  }

  const range = selection.getRangeAt(0);
  const anchorNode = selection.anchorNode;
  const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
  const mesEl = anchorEl?.closest?.(".mes");
  const chatRoot = document.getElementById("chat");
  if (!mesEl || !chatRoot?.contains(mesEl)) {
    selectionState = null;
    hideSelectionBubble();
    hideMobileSave();
    return;
  }

  const messageIndex = getMessageIndexFromElement(mesEl);
  if (messageIndex < 0) {
    selectionState = null;
    hideSelectionBubble();
    hideMobileSave();
    return;
  }

  selectionState = { text, range, messageIndex };

  if (IS_TOUCH) {
    showMobileSave();
    hideSelectionBubble();
  } else {
    showSelectionBubble(range.getBoundingClientRect());
    hideMobileSave();
  }
}

function getMessageIndexFromElement(mesEl) {
  const attrs = [mesEl.getAttribute("mesid"), mesEl.dataset?.mesid, mesEl.dataset?.messageId];
  for (const raw of attrs) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return getChatElements().indexOf(mesEl);
}

function showSelectionBubble(rect) {
  let bubble = document.getElementById(BUBBLE_ID);
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = BUBBLE_ID;
    bubble.innerHTML = `
      <button type="button" class="menu_button" data-action="fav">收藏</button>
      <button type="button" class="menu_button" data-action="highlight">高亮并收藏</button>
      <button type="button" class="menu_button" data-action="cancel">取消</button>
    `;
    bubble.addEventListener("click", onBubbleClick);
    document.body.appendChild(bubble);
  }

  bubble.style.top = `${Math.max(8, rect.top - 44)}px`;
  bubble.style.left = `${Math.max(8, rect.left)}px`;
  bubble.classList.add("scj-show");
}

function hideSelectionBubble() {
  document.getElementById(BUBBLE_ID)?.classList.remove("scj-show");
}

function showMobileSave() {
  document.getElementById(MOBILE_SAVE_ID)?.classList.add("scj-show");
}

function hideMobileSave() {
  document.getElementById(MOBILE_SAVE_ID)?.classList.remove("scj-show");
}

function onBubbleClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action) return;
  if (action === "cancel") return hideSelectionBubble();
  if (action === "fav") saveCurrentSelection(false);
  if (action === "highlight") saveCurrentSelection(true);
}

function saveCurrentSelection(shouldHighlight) {
  if (!selectionState) {
    refreshSelectionState();
    if (!selectionState) {
      alert("请先在聊天消息里选中文本。");
      return;
    }
  }

  const note = prompt("请输入备注（可留空）", "") ?? "";
  const tagsText = prompt("请输入标签（可选，英文逗号分隔）", "") ?? "";
  const tags = parseTags(tagsText);

  const ctx = getContext();
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const idx = clamp(selectionState.messageIndex, 0, Math.max(0, chat.length - 1));
  const session = getSessionInfo(ctx);
  const settings = getSettings();

  const favoriteId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const contextMessages = chat.slice(Math.max(0, idx - 5), Math.min(chat.length, idx + 6)).map((m) => ({
    name: m?.name || "",
    is_user: Boolean(m?.is_user),
    is_system: Boolean(m?.is_system),
    mes: m?.mes || "",
    send_date: m?.send_date || null,
  }));

  const favorite = {
    id: favoriteId,
    createdAt: new Date().toISOString(),
    note: note.trim(),
    tags,
    selection: {
      text: selectionState.text,
      messageIndex: idx,
    },
    session,
    snapshot: {
      characterCard: snapshotCharacterCard(ctx),
      contextMessages,
    },
  };

  settings.favorites.push(favorite);
  if (shouldHighlight) {
    if (!Array.isArray(settings.highlightsByChatKey[session.chatKey])) {
      settings.highlightsByChatKey[session.chatKey] = [];
    }
    settings.highlightsByChatKey[session.chatKey].push({
      favoriteId,
      messageIndex: idx,
      text: selectionState.text,
    });
  }
  saveSettingsDebounced();
  applyHighlightsDebounced();
  renderFavorites();
  hideSelectionBubble();
  hideMobileSave();
}

function jumpToOriginalMessage(favoriteId) {
  const item = getSettings().favorites.find((f) => f.id === favoriteId);
  if (!item) return;
  const nowSession = getSessionInfo();
  if (nowSession.chatKey !== item.session?.chatKey) {
    alert("这条收藏属于其他会话，请先切到对应会话。");
    return;
  }
  const idx = item.selection?.messageIndex;
  if (!Number.isInteger(idx)) return;
  const mesEl = getChatElements()[idx];
  if (!mesEl) return alert("当前页面没有找到原消息。");
  mesEl.scrollIntoView({ behavior: "smooth", block: "center" });
  mesEl.classList.add("scj-flash");
  setTimeout(() => mesEl.classList.remove("scj-flash"), 1200);
}

function parseTags(input) {
  return Array.from(new Set(String(input || "").split(",").map((t) => t.trim()).filter(Boolean)));
}

function snapshotCharacterCard(ctx) {
  const characterId = ctx?.characterId;
  const card = Number.isInteger(characterId) && Array.isArray(ctx?.characters) ? ctx.characters[characterId] : null;
  if (!card) {
    return { name: ctx?.name2 || "未知角色", fallback: true };
  }
  return {
    name: card.name ?? null,
    avatar: card.avatar ?? null,
    description: card.description ?? null,
    personality: card.personality ?? null,
    scenario: card.scenario ?? null,
    first_mes: card.first_mes ?? null,
    mes_example: card.mes_example ?? null,
    creator_notes: card.creator_notes ?? null,
    tags: card.tags ?? null,
  };
}

function observeChatDom() {
  const chat = document.getElementById("chat");
  if (!chat) return;
  observer?.disconnect();
  observer = new MutationObserver(() => applyHighlightsDebounced());
  observer.observe(chat, { childList: true, subtree: true });
}

function applyHighlightsDebounced() {
  clearTimeout(highlightDebounceTimer);
  highlightDebounceTimer = setTimeout(applyHighlightsForCurrentChat, 150);
}

function applyHighlightsForCurrentChat() {
  clearCurrentHighlights();
  const session = getSessionInfo();
  const highlights = getSettings().highlightsByChatKey[session.chatKey];
  if (!Array.isArray(highlights) || !highlights.length) return;
  const messageElements = getChatElements();
  highlights.forEach((h) => {
    const root = messageElements[h.messageIndex]?.querySelector(".mes_text");
    if (!root) return;
    markFirstTextOccurrence(root, h.text, h.favoriteId);
  });
}

function clearCurrentHighlights() {
  document.querySelectorAll(".scj-highlight").forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  });
}

function markFirstTextOccurrence(root, text, favoriteId) {
  const query = String(text || "").trim();
  if (!query) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const content = node.textContent || "";
    const at = content.indexOf(query);
    if (at < 0) continue;
    const middle = node.splitText(at);
    middle.splitText(query.length);
    const mark = document.createElement("span");
    mark.className = "scj-highlight";
    mark.setAttribute("data-favorite-id", favoriteId);
    mark.textContent = middle.textContent;
    middle.parentNode?.replaceChild(mark, middle);
    return true;
  }
  return false;
}

function exportFavorites() {
  const data = {
    module: MODULE_NAME,
    exportedAt: new Date().toISOString(),
    version: 3,
    payload: getSettings(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `shoucangjia_export_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importFavorites(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files?.length) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const incoming = parsed?.payload;
      if (!incoming || typeof incoming !== "object") throw new Error("invalid payload");
      if (!confirm("导入将覆盖当前收藏，确认继续？")) return;
      extension_settings[MODULE_NAME] = {
        favorites: Array.isArray(incoming.favorites) ? incoming.favorites : [],
        highlightsByChatKey:
          incoming.highlightsByChatKey && typeof incoming.highlightsByChatKey === "object"
            ? incoming.highlightsByChatKey
            : {},
      };
      saveSettingsDebounced();
      applyHighlightsDebounced();
      renderFavorites();
    } catch (error) {
      console.error(`[${MODULE_NAME}] import failed`, error);
      alert("导入失败：文件格式不正确。");
    } finally {
      input.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

function groupBy(arr, keySelector) {
  return arr.reduce((acc, item) => {
    const key = keySelector(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function ellipsis(text, maxLen) {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function escapeHtml(input) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

bootstrap()
  .then(() => {
    console.log(`[${MODULE_NAME}] ready`);
  })
  .catch((error) => {
    console.error(`[${MODULE_NAME}] init failed`, error);
    alert(`[${MODULE_NAME}] 加载失败，请查看控制台报错。`);
  });
