const MODULE_NAME = "youhua-exit";
const TOAST_TITLE = "\u53f3\u5212\u9000\u51fa";
const SWIPE_MIN_X = 70;
const SWIPE_MAX_Y = 110;
const SWIPE_MAX_MS = 900;
const SWIPE_DIRECTION_RATIO = 1.2;

let getContext = null;
let touchState = null;
let pointerState = null;
let triggerLockUntil = 0;

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
  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
  document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
  document.addEventListener("touchcancel", onTouchCancel, { passive: true, capture: true });

  document.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
  document.addEventListener("pointermove", onPointerMove, { passive: false, capture: true });
  document.addEventListener("pointerup", onPointerUp, { passive: true, capture: true });
  document.addEventListener("pointercancel", onPointerCancel, { passive: true, capture: true });

  console.log(`[${MODULE_NAME}] ready`);
}

function onTouchStart(event) {
  if (event.touches.length !== 1) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!canTrackGesture(target)) return;

  const t = event.touches[0];
  touchState = newState(t.clientX, t.clientY);
}

function onTouchMove(event) {
  if (!touchState) return;
  if (event.touches.length !== 1) {
    touchState = null;
    return;
  }
  const t = event.touches[0];
  updateStateOnMove(touchState, t.clientX, t.clientY, event);
}

function onTouchEnd(event) {
  if (!touchState) return;
  if (event.changedTouches.length !== 1) {
    touchState = null;
    return;
  }
  const t = event.changedTouches[0];
  finishGesture(touchState, t.clientX, t.clientY);
  touchState = null;
}

function onTouchCancel() {
  touchState = null;
}

function onPointerDown(event) {
  if (event.pointerType === "mouse") return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!canTrackGesture(target)) return;
  pointerState = newState(event.clientX, event.clientY);
}

function onPointerMove(event) {
  if (!pointerState) return;
  if (event.pointerType === "mouse") return;
  updateStateOnMove(pointerState, event.clientX, event.clientY, event);
}

function onPointerUp(event) {
  if (!pointerState) return;
  if (event.pointerType === "mouse") {
    pointerState = null;
    return;
  }
  finishGesture(pointerState, event.clientX, event.clientY);
  pointerState = null;
}

function onPointerCancel() {
  pointerState = null;
}

function newState(x, y) {
  return {
    sx: x,
    sy: y,
    ts: Date.now(),
    lockedHorizontal: false,
  };
}

function updateStateOnMove(state, x, y, event) {
  const dx = x - state.sx;
  const dy = y - state.sy;
  if (dx < 20) return;
  if (Math.abs(dy) > SWIPE_MAX_Y) return;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTION_RATIO) return;
  state.lockedHorizontal = true;
  if (event.cancelable) event.preventDefault();
}

function finishGesture(state, x, y) {
  const now = Date.now();
  if (now < triggerLockUntil) return;
  const dx = x - state.sx;
  const dy = y - state.sy;
  const dt = now - state.ts;

  if (dt > SWIPE_MAX_MS) return;
  if (dx < SWIPE_MIN_X) return;
  if (Math.abs(dy) > SWIPE_MAX_Y) return;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTION_RATIO) return;

  triggerLockUntil = now + 800;
  goHome();
}

function canTrackGesture(target) {
  return !isTypingTarget(target) && isInChatArea(target);
}

function isTypingTarget(target) {
  return Boolean(target.closest("input, textarea, [contenteditable='true'], .ProseMirror"));
}

function isInChatArea(target) {
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
    notify("Swipe detected, back action sent.");
    return;
  }
  notify("No back/home entry found. Share your ST version for exact selector adaptation.", true);
}

function tryCallKnownFunctions() {
  const ctx = typeof getContext === "function" ? getContext() : null;
  const candidateFns = [
    ctx?.goToMainMenu,
    ctx?.goHome,
    ctx?.openCharacterList,
    ctx?.showCharacters,
    ctx?.backToCharacterList,
    ctx?.openCharacterSelect,
    window.goToMainMenu,
    window.goHome,
    window.openCharacterList,
    window.showCharacters,
    window.backToCharacterList,
  ];
  for (const fn of candidateFns) {
    if (typeof fn !== "function") continue;
    try {
      fn();
      notify("Swipe detected, back action sent.");
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
    "[data-action='open-character-list']",
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) continue;
    el.click();
    notify("Swipe detected, back action sent.");
    return true;
  }

  const textHints = ["\u9996\u9875", "\u8fd4\u56de", "\u89d2\u8272", "\u4e3b\u754c\u9762", "home", "back", "character"];
  const clickable = Array.from(document.querySelectorAll("button, a, [role='button'], .menu_button"));
  for (const el of clickable) {
    const text = (el.textContent || "").trim().toLowerCase();
    if (!text) continue;
    if (!textHints.some((hint) => text.includes(String(hint).toLowerCase()))) continue;
    if (!(el instanceof HTMLElement)) continue;
    el.click();
    notify("Swipe detected, back action sent.");
    return true;
  }
  return false;
}

function notify(msg, isError = false) {
  if (typeof window.toastr !== "undefined") {
    if (isError) {
      window.toastr.warning(msg, TOAST_TITLE);
    } else {
      window.toastr.success(msg, TOAST_TITLE);
    }
    return;
  }
  console.log(`[${MODULE_NAME}] ${msg}`);
}

bootstrap().catch((error) => {
  console.error(`[${MODULE_NAME}] init failed`, error);
});
