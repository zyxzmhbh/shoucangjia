const MODULE_NAME = "shoucangjia";
const SETTINGS_BLOCK_ID = "scj-settings-block";
const IMPORT_INPUT_ID = "scj-import-input";
const MODAL_ID = "scj-collector-modal";

const DEFAULT_SETTINGS = {
  favorites: [],
  highlightsByChatKey: {},
};

let observer = null;
let saveSettingsDebounced = null;
let extension_settings = null;
let getContext = null;

async function importAny(paths) {
  for (const p of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await import(p);
    } catch {
      // try next
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
  mountSettingsEntry();
  mountCollectorModal();
  observeChatDom();
  mountMessageFavoriteButtons();
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

function mountCollectorModal() {
  if (document.getElementById(MODAL_ID)) return;
  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="scj-modal-mask"></div>
    <div class="scj-modal-card">
      <div class="scj-modal-title">收藏本条消息</div>
      <div class="scj-modal-tip">先在文本框中选中片段，再点“收藏”。</div>
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
  if (!msg) return alert("没有找到这条消息。");

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
  if (action === "close") return closeCollectorModal();
  if (action !== "save") return;

  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  const messageIndex = Number(modal.getAttribute("data-message-index"));
  if (!Number.isInteger(messageIndex)) return;

  const textarea = modal.querySelector(".scj-modal-text");
  const noteInput = modal.querySelector(".scj-modal-note");
  const tagsInput = modal.querySelector(".scj-modal-tags");
  if (!(textarea instanceof HTMLTextAreaElement)) return;

  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const selected = start < end ? textarea.value.slice(start, end).trim() : "";
  if (!selected) return alert("请先在文本框里选中要收藏的片段。");

  saveFavoriteByPayload({
    text: selected,
    messageIndex,
    note: noteInput instanceof HTMLInputElement ? noteInput.value : "",
    tags: parseTags(tagsInput instanceof HTMLInputElement ? tagsInput.value : ""),
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
    <div class="inline-drawer-toggle" data-action="toggle">
      <span>收藏夹</span>
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
    if (target.dataset.action === "toggle") toggleDrawer(block);
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
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
  const contextHtml = renderContext(item.snapshot?.contextMessages || []);
  const charSnapshot = escapeHtml(JSON.stringify(item.snapshot?.characterCard || {}, null, 2));
  const tags = Array.isArray(item.tags) && item.tags.length
    ? `<div class="scj-tags">${item.tags.map((t) => `<span class="scj-tag">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";

  return `
    <article class="scj-card" data-id="${escapeHtml(item.id)}">
      <div class="scj-meta">${escapeHtml(item.session?.characterName || "未知角色")} | ${createdAt} | 会话: ${chatId}</div>
      <blockquote>${escapeHtml(quote)}</blockquote>
      ${tags}
      ${note}
      <div class="scj-actions">
        <button type="button" class="menu_button" data-action="toggle">查看快照</button>
        <button type="button" class="menu_button" data-action="jump">跳转原消息</button>
        <button type="button" class="menu_button" data-action="copy-chat-id">复制会话ID</button>
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
    .map((m) => `<div class="scj-context-row"><b>${escapeHtml(m.name || (m.is_user ? "你" : "角色"))}</b>: ${escapeHtml(m.mes || "")}</div>`)
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
  const item = getSettings().favorites.find((f) => f.id === id);
  if (!item) return;

  if (action === "delete") {
    if (!confirm("确认删除这条收藏吗？")) return;
    const settings = getSettings();
    settings.favorites = settings.favorites.filter((it) => it.id !== id);
    saveSettingsDebounced();
    renderFavorites();
    return;
  }

  if (action === "toggle") {
    const details = card?.querySelector(".scj-details");
    if (details) details.open = !details.open;
    return;
  }

  if (action === "copy-chat-id") {
    copyText(item.session?.chatId || "");
    return;
  }

  if (action === "jump") {
    jumpToOriginalMessage(item);
  }
}

function saveFavoriteByPayload({ text, messageIndex, note, tags }) {
  if (!text || !Number.isInteger(messageIndex)) return alert("没有可收藏的文本。");
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
  saveSettingsDebounced();
  renderFavorites();
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
    btn.innerHTML = `<span class="scj-bookmark-icon" aria-hidden="true"></span>`;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const idx = getMessageIndexFromElement(mesEl);
      if (!Number.isInteger(idx) || idx < 0) return;
      openCollectorModal(idx);
    });

    const pencil = toolbar.querySelector(".fa-pencil, .fa-pencil-alt, .fa-pen-to-square");
    if (pencil?.parentElement?.classList?.contains("mes_button")) {
      toolbar.insertBefore(btn, pencil.parentElement);
    } else if (toolbar.children[1]) {
      toolbar.insertBefore(btn, toolbar.children[1]);
    } else {
      toolbar.appendChild(btn);
    }
  });
}

function jumpToOriginalMessage(item) {
  const nowSession = getSessionInfo();
  if (nowSession.chatKey !== item.session?.chatKey) {
    const switched = tryAutoSwitchSession(item.session);
    if (!switched) {
      copyText(item.session?.chatId || "");
      return alert("未能自动切换，已复制会话ID。");
    }
    setTimeout(() => jumpToOriginalMessage(item), 700);
    return;
  }
  const idx = item.selection?.messageIndex;
  if (!Number.isInteger(idx)) return;
  const mesEl = getChatElements()[idx];
  if (!mesEl) {
    copyText(item.session?.chatId || "");
    return alert("未定位到原消息，已复制会话ID。");
  }
  mesEl.scrollIntoView({ behavior: "smooth", block: "center" });
  mesEl.classList.add("scj-flash");
  setTimeout(() => mesEl.classList.remove("scj-flash"), 1200);
}

function tryAutoSwitchSession(targetSession) {
  const targetChatId = String(targetSession?.chatId || "");
  if (!targetChatId) return false;

  const ctx = getContext();
  const maybeFns = [ctx?.openChat, ctx?.setChat, ctx?.switchChat, window.openChat].filter((fn) => typeof fn === "function");
  for (const fn of maybeFns) {
    try {
      fn(targetChatId);
      return true;
    } catch {
      // next
    }
  }
  return false;
}

function copyText(text) {
  const value = String(text || "");
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
    return;
  }
  fallbackCopy(value);
}

function fallbackCopy(value) {
  const ta = document.createElement("textarea");
  ta.value = value;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function getMessageIndexFromElement(mesEl) {
  const attrs = [mesEl.getAttribute("mesid"), mesEl.dataset?.mesid, mesEl.dataset?.messageId];
  for (const raw of attrs) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return getChatElements().indexOf(mesEl);
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
  });
  observer.observe(chat, { childList: true, subtree: true });
}

function exportFavorites() {
  const data = {
    module: MODULE_NAME,
    exportedAt: new Date().toISOString(),
    version: 9,
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
  return `${text.slice(0, maxLen - 1)}...`;
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
