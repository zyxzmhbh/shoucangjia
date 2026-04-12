const MODULE_NAME = "youhua-exit";
const SWIPE_MIN_X = 80;
const SWIPE_MAX_Y = 90;
const SWIPE_MAX_MS = 700;
const SWIPE_DIRECTION_RATIO = 1.35;

let getContext = null;
let touchStart = null;

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
  const extModule = await importAny(["/scripts/extensions.js", "../../../extensions.js", "../../extensions.js"]);
  getContext = extModule.getContext;
  init();
}

function init() {
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  console.log(`[${MODULE_NAME}] ready`);
}

function onTouchStart(event) {
  if (!(event.target instanceof HTMLElement)) return;
  if (event.touches.length !== 1) return;
  if (isTypingTarget(event.target)) return;
  if (!isInChatArea(event.target)) return;

  const t = event.touches[0];
  touchStart = {
    x: t.clientX,
    y: t.clientY,
    ts: Date.now(),
  };
}

function onTouchEnd(event) {
  if (!touchStart) return;
  if (event.changedTouches.length !== 1) {
    touchStart = null;
    return;
  }

  const t = event.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const dt = Date.now() - touchStart.ts;
  touchStart = null;

  if (dt > SWIPE_MAX_MS) return;
  if (dx < SWIPE_MIN_X) return;
  if (Math.abs(dy) > SWIPE_MAX_Y) return;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTION_RATIO) return;

  goHome();
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target.closest("input, textarea, [contenteditable='true'], .ProseMirror")) return true;
  return false;
}

function isInChatArea(target) {
  if (!target) return false;
  return Boolean(
    target.closest(
      "#chat, #chat2, .chat, .chat_main, .mes, .mes_block, .mes_text, .chat_messages, #chat_container",
    ),
  );
}

function goHome() {
  if (tryCallKnownFunctions()) return;
  if (tryClickKnownButtons()) return;
  if (window.history.length > 1) {
    window.history.back();
    notify("已执行右划返回");
    return;
  }
  notify("未找到首页入口，请告诉我你的酒馆版本，我给你定向适配。", true);
}

function tryCallKnownFunctions() {
  const ctx = typeof getContext === "function" ? getContext() : null;
  const candidateFns = [
    ctx?.goToMainMenu,
    ctx?.goHome,
    ctx?.openCharacterList,
    ctx?.showCharacters,
    window.goToMainMenu,
    window.goHome,
    window.openCharacterList,
    window.showCharacters,
  ];

  for (const fn of candidateFns) {
    if (typeof fn !== "function") continue;
    try {
      fn();
      notify("已执行右划返回");
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

function tryClickKnownButtons() {
  const selectors = [
    "#back_to_main",
    "#back_to_characters",
    "#option_back_to_main",
    "#option_select_characters",
    "#rm_button_back",
    "#rm_button_characters",
    "#rightNavDrawerIcon",
    "[data-action='back']",
    "[data-action='go-home']",
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) continue;
    el.click();
    notify("已执行右划返回");
    return true;
  }

  const textHints = ["首页", "返回", "角色", "主界面", "back", "home", "character"];
  const clickable = Array.from(document.querySelectorAll("button, a, [role='button'], .menu_button"));
  for (const el of clickable) {
    const text = (el.textContent || "").trim().toLowerCase();
    if (!text) continue;
    if (!textHints.some((hint) => text.includes(hint.toLowerCase()))) continue;
    if (!(el instanceof HTMLElement)) continue;
    el.click();
    notify("已执行右划返回");
    return true;
  }
  return false;
}

function notify(msg, isError = false) {
  if (typeof window.toastr !== "undefined") {
    if (isError) {
      window.toastr.warning(msg, "右划退出");
    } else {
      window.toastr.success(msg, "右划退出");
    }
    return;
  }
  console.log(`[${MODULE_NAME}] ${msg}`);
}

bootstrap().catch((error) => {
  console.error(`[${MODULE_NAME}] init failed`, error);
});
