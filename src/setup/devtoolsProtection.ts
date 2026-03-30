const DETECTION_INTERVAL_MS = 1000;
const DEVTOOLS_PAUSE_THRESHOLD_MS = 150;
const RELOAD_COOLDOWN_MS = 2000;
const DEVTOOLS_PROTECTION_ENABLED =
  import.meta.env.VITE_ENABLE_DEVTOOLS_PROTECTION !== "false";

let lastReloadAt = 0;

function triggerDebuggerTrap() {
  const startedAt = performance.now();

  eval("debugger");

  const elapsed = performance.now() - startedAt;
  const now = Date.now();

  if (
    elapsed > DEVTOOLS_PAUSE_THRESHOLD_MS &&
    now - lastReloadAt > RELOAD_COOLDOWN_MS
  ) {
    lastReloadAt = now;
    window.location.reload();
  }
}

function initializeDevtoolsProtection() {
  if (
    !import.meta.env.PROD ||
    !DEVTOOLS_PROTECTION_ENABLED ||
    typeof window === "undefined"
  )
    return;

  const intervalId = window.setInterval(
    triggerDebuggerTrap,
    DETECTION_INTERVAL_MS,
  );

  window.addEventListener(
    "beforeunload",
    () => {
      window.clearInterval(intervalId);
    },
    { once: true },
  );
}

initializeDevtoolsProtection();
