const MODULE_NAME = "shoucangjia";
const SETTINGS_BLOCK_ID = "scj-settings-block";
const IMPORT_INPUT_ID = "scj-import-input";
const BUBBLE_ID = "scj-selection-bubble";
const MODAL_ID = "scj-collector-modal";

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
      // try next path
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
  mountSelectionBubble();
  mountSettingsEntry();
  mountCollectorModal();
  bindSelectionEvents();
  observeChatDom();
  mountMessageFavoriteButtons();
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

function mountSelectionBubble() {
  if (document.getElementById(BUBBLE_ID)) return;
  const bubble = document.createElement("div");
  bubble.id = BUBBLE_ID;
  bubble.innerHTML = `
    <button type="button" class="menu_button" data-action="fav">收藏</button>
    <button type="button" class="menu_button" data-action="highlight">高亮并收藏</button>
    <button type="button" class="menu_button" data-action="cancel">取消</button>
  `;
  bubble.addEventListener("click", onBubbleClick);
  document.body.appendChild(bubble);
}

function mountCollectorModal() {
  if (document.getElementById(MODAL_ID)) return;
  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="scj-modal-mask"></div>
    <div class="scj-modal-card">
      <div class="scj-modal-title">收藏本条消息</div>
      <div class="scj-modal-tip">先在下方文本框中选中片段，再点“收藏”完成。</div>
      <textarea class="text_pole scj-modal-text" rows="12"></textarea>
      <input class="text_pole scj-modal-note" placeholder="备注（可选）" />
      <input class="text_pole scj-modal-tags" placeholder="标签（可选，英文逗号分隔）" />
      <div class="scj-modal-actions">
        <button type="button" class="menu_button" data-action="save">收藏</button>
        <button type="button" class="menu_button menu_button_danger" data-action="close">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector(".scj-modal-mask")?.addEventListener("click", closeCollectorModal);
  modal.addEventListener("click", onModalAction);
}

function openCollectorModal(messageIndex) {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  const ctx = getContext();
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const msg = chat[messageIndex];
  if (!msg) {
    alert("没有找到这条消息。");
    return;
  }

  modal.setAttribute("data-message-index", String(messageIndex));
  const textarea = modal.querySelector(".scj-modal-text");
  const noteInput = modal.querySelector(".scj-modal-note");
  const tagsInput = modal.querySelector(".scj-modal-tags");
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.value = String(msg?.mes || "");
    textarea.focus();
  }
  if (noteInput instanceof HTMLInputElement) noteInput.value = "";
  if (tagsInput instanceof HTMLInputElement) tagsInput.value = "";

  modal.classList.add("scj-open");
}

function closeCollectorModal() {
  document.getElementById(MODAL_ID)?.classList.remove("scj-open");
}

function onModalAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action) return;

  if (action === "close") {
    closeCollectorModal();
    return;
  }

  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  const messageIndex = Number(modal.getAttribute("data-message-index"));
  if (!Number.isInteger(messageIndex)) return;

  const textarea = modal.querySelector(".scj-modal-text");
  const noteInput = modal.querySelector(".scj-modal-note");
  const tagsInput = modal.querySelector(".scj-modal-tags");
  if (!(textarea instanceof HTMLTextAreaElement)) return;
  const note = noteInput instanceof HTMLInputElement ? noteInput.value : "";
  const tagsText = tagsInput instanceof HTMLInputElement ? tagsInput.value : "";
  const tags = parseTags(tagsText);

  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const selected = start < end ? textarea.value.slice(start, end).trim() : "";
  if (!selected) {
    alert("请先在文本框里选中要收藏的片段。");
    return;
  }

  saveFavoriteByPayload({
    text: selected,
    messageIndex,
    note,
    tags,
    shouldHighlight: false,
  });
  closeCollectorModal();
}

function mountSettingsEntry() {
  const container = document.getElementById("extensions_settings2");
  if (!container || document.getElementById(SETTINGS_BLOCK_ID)) return;

  const block = document.createElement("div");
  block.id = SETTINGS_BLOCK_ID;
  block.className = "inline-drawer scj-drawer";
  block.innerHTML = `
    <div class="inline-drawer-toggle scj-drawer-toggle" data-action="toggle">
      <b class="scj-drawer-title">收藏夹</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content scj-collapsed">
      <div class="scj-panel-header">
        <div class="scj-header-actions">
          <button type="button" class="menu_button scj-export-btn">导出</button>
          <button type="button" class="menu_button scj-import-btn">导入</button>
        </div>
      </div>
      <div class="scj-filters">
        <input class="text_pole scj-filter" data-filter="character" placeholder="角色" />
        <input class="text_pole scj-filter" data-filter="note" placeholder="备注" />
        <input class="text_pole scj-filter" data-filter="tags" placeholder="标签" />
        <input class="text_pole scj-filter" data-filter="search" placeholder="全文搜索" />
      </div>
      <div class="scj-list"></div>
      <input id="${IMPORT_INPUT_ID}" type="file" accept="application/json" hidden />
    </div>
  `;

  block.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (action === "toggle") {
      toggleDrawer(block);
    }
  });

  block.querySelector(".scj-export-btn")?.addEventListener("click", exportFavorites);
  block.querySelector(".scj-import-btn")?.addEventListener("click", () => {
    block.querySelector(`#${IMPORT_INPUT_ID}`)?.click();
  });
  block.querySelector(`#${IMPORT_INPUT_ID}`)?.addEventListener("change", importFavorites);
  block.querySelectorAll(".scj-filter").forEach((el) => {
    el.addEventListener("input", renderFavorites);
    el.addEventListener("change", renderFavorites);
  });
  block.querySelector(".scj-list")?.addEventListener("click", onListAction);

  container.prepend(block);
}

function toggleDrawer(block) {
  const content = block.querySelector(".inline-drawer-content");
  const icon = block.querySelector(".inline-drawer-icon");
  if (!content || !icon) return;
  const collapsed = content.classList.contains("scj-collapsed");
  if (collapsed) {
    content.classList.remove("scj-collapsed");
    icon.classList.remove("down");
    icon.classList.add("up");
    renderFavorites();
  } else {
    content.classList.add("scj-collapsed");
    icon.classList.remove("up");
    icon.classList.add("down");
  }
}

function renderFavorites() {
  const block = document.getElementById(SETTINGS_BLOCK_ID);
  if (!block) return;
  const list = block.querySelector(".scj-list");
  if (!list) return;

  const characterFilter = (block.querySelector('[data-filter="character"]')?.value || "").trim().toLowerCase();
  const noteFilter = (block.querySelector('[data-filter="note"]')?.value || "").trim().toLowerCase();
  const tagsFilter = (block.querySelector('[data-filter="tags"]')?.value || "").trim().toLowerCase();
  const fullTextFilter = (block.querySelector('[data-filter="search"]')?.value || "").trim().toLowerCase();
  const sort = "desc";

  const filtered = getSettings().favorites
    .filter((item) => {
      const c = (item.session?.characterName || "").toLowerCase();
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
  list.innerHTML = Object.entries(byCharacter)
    .map(([characterName, items]) => {
      const cards = items.map(renderCard).join("");
      return `
        <section class="scj-character-group">
          <h4>${escapeHtml(characterName)} <small>(${items.length})</small></h4>
          ${cards}
        </section>
      `;
    })
    .join("");
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
}

function scheduleSelectionRefresh() {
  clearTimeout(selectionSyncTimer);
  selectionSyncTimer = setTimeout(refreshSelectionState, IS_TOUCH ? 120 : 10);
}

function refreshSelectionState() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const text = selection.toString().trim();
  if (!text) return;
  const range = selection.getRangeAt(0);
  const mesEl = findMessageElement(selection, range);
  if (!mesEl) return;
  const messageIndex = getMessageIndexFromElement(mesEl);
  if (messageIndex < 0) return;
  selectionState = { text, range, messageIndex };
  showSelectionBubble(range.getBoundingClientRect());
}

function findMessageElement(selection, range) {
  const candidates = [];
  const pushNode = (node) => {
    if (!node) return;
    if (node instanceof Element) candidates.push(node);
    else if (node.parentElement) candidates.push(node.parentElement);
  };
  pushNode(selection.anchorNode);
  pushNode(selection.focusNode);
  pushNode(range.commonAncestorContainer);
  for (const c of candidates) {
    const mes = c.closest?.(".mes");
    if (mes) return mes;
  }
  return null;
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
  const bubble = document.getElementById(BUBBLE_ID);
  if (!bubble) return;
  if (IS_TOUCH) {
    bubble.classList.add("scj-touch-anchor");
    bubble.style.top = "auto";
    bubble.style.left = "50%";
    bubble.style.bottom = "110px";
  } else {
    bubble.classList.remove("scj-touch-anchor");
    bubble.style.bottom = "auto";
    bubble.style.top = `${Math.max(8, rect.top - 44)}px`;
    bubble.style.left = `${Math.max(8, rect.left)}px`;
  }
  bubble.classList.add("scj-show");
}

function hideSelectionBubble() {
  document.getElementById(BUBBLE_ID)?.classList.remove("scj-show");
}

function onBubbleClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action) return;
  if (action === "cancel") {
    selectionState = null;
    hideSelectionBubble();
    return;
  }
  if (action === "fav") {
    saveFavoriteByPayload({
      text: selectionState?.text || "",
      messageIndex: selectionState?.messageIndex,
      note: prompt("请输入备注（可留空）", "") ?? "",
      tags: parseTags(prompt("请输入标签（可选，英文逗号分隔）", "") ?? ""),
      shouldHighlight: false,
    });
  }
  if (action === "highlight") {
    saveFavoriteByPayload({
      text: selectionState?.text || "",
      messageIndex: selectionState?.messageIndex,
      note: prompt("请输入备注（可留空）", "") ?? "",
      tags: parseTags(prompt("请输入标签（可选，英文逗号分隔）", "") ?? ""),
      shouldHighlight: true,
    });
  }
}

function saveFavoriteByPayload({ text, messageIndex, note, tags, shouldHighlight }) {
  if (!text || !Number.isInteger(messageIndex)) {
    alert("没有可收藏的文本。");
    return;
  }
  const ctx = getContext();
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const idx = clamp(messageIndex, 0, Math.max(0, chat.length - 1));
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
    note: String(note || "").trim(),
    tags: Array.isArray(tags) ? tags : [],
    selection: {
      text: String(text),
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
      text: String(text),
    });
  }
  saveSettingsDebounced();
  applyHighlightsDebounced();
  renderFavorites();
  selectionState = null;
  hideSelectionBubble();
}

function mountMessageFavoriteButtons() {
  const messages = getChatElements();
  messages.forEach((mesEl) => {
    if (!(mesEl instanceof HTMLElement)) return;
    if (mesEl.querySelector(".scj-msg-fav-btn")) return;

    const toolbar = mesEl.querySelector(".mes_buttons, .mes_buttons_wrapper, .mes_header .right_menu");
    if (!toolbar) return;

    const btn = document.createElement("div");
    btn.className = "mes_button scj-msg-fav-btn";
    btn.title = "收藏本条消息";
    btn.setAttribute("aria-label", "收藏本条消息");
    btn.innerHTML = '<i class="fa-regular fa-bookmark scj-bookmark-icon" aria-hidden="true"></i>';
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const idx = getMessageIndexFromElement(mesEl);
      if (!Number.isInteger(idx) || idx < 0) return;
      openCollectorModal(idx);
    });

    const children = Array.from(toolbar.children);
    const pencil = children.find((el) =>
      el instanceof HTMLElement &&
      (el.classList.contains("fa-pencil") ||
        el.classList.contains("fa-pen") ||
        el.classList.contains("mes_edit") ||
        (el.getAttribute("title") || "").includes("编辑")),
    );

    if (pencil instanceof HTMLElement) {
      toolbar.insertBefore(btn, pencil);
    } else if (toolbar.lastElementChild) {
      toolbar.insertBefore(btn, toolbar.lastElementChild);
    } else {
      toolbar.appendChild(btn);
    }
  });
}
function jumpToOriginalMessage(favoriteId) {
  const item = getSettings().favorites.find((f) => f.id === favoriteId);
  if (!item) return;

  const rawChatId = String(item.session?.chatId || "");
  const atIndex = rawChatId.lastIndexOf("@");
  const shortSessionId = atIndex >= 0 ? rawChatId.slice(atIndex) : rawChatId || "unknown-chat";
  const idx = item.selection?.messageIndex;
  const floorText = Number.isInteger(idx) ? `#${idx + 1}` : "未知";
  const message = `楼层：${floorText}\n可复制会话ID：${shortSessionId}`;

  if (prompt(message, shortSessionId) === null) return;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(shortSessionId).catch(() => {});
  }
}

function parseTags(input) {
  return Array.from(new Set(String(input || "").split(",").map((t) => t.trim()).filter(Boolean)));
}

function snapshotCharacterCard(ctx) {
  const characterId = ctx?.characterId;
  const card = Number.isInteger(characterId) && Array.isArray(ctx?.characters) ? ctx.characters[characterId] : null;
  if (!card) return { name: ctx?.name2 || "未知角色", fallback: true };
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
  observer = new MutationObserver(() => {
    mountMessageFavoriteButtons();
    applyHighlightsDebounced();
  });
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
    version: 6,
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

