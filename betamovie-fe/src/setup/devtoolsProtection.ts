import disableDevtool from "disable-devtool";

const DETECTION_INTERVAL_MS = 1000;
const DEVTOOLS_PAUSE_THRESHOLD_MS = 150;
const RELOAD_COOLDOWN_MS = 2000;

const DEVTOOLS_PROTECTION_ENABLED =
  import.meta.env.VITE_ENABLE_DEVTOOLS_PROTECTION === "true";

let lastReloadAt = 0;

function reloadWithCooldown() {
  const now = Date.now();

  if (now - lastReloadAt <= RELOAD_COOLDOWN_MS) return;

  lastReloadAt = now;
  window.location.reload();
}

function triggerDebuggerTrap() {
  const startedAt = performance.now();

  eval("debugger");

  const elapsed = performance.now() - startedAt;

  if (elapsed > DEVTOOLS_PAUSE_THRESHOLD_MS) reloadWithCooldown();
}

function initializeDisableDevtool() {
  try {
    disableDevtool({
      ondevtoolopen: () => {
        reloadWithCooldown();
      },
      disableMenu: false,
      clearLog: false,
      clearIntervalWhenDevOpenTrigger: false,
    });
  } catch {
    // Keep fallback protection active even if third-party init fails.
  }
}

function initializeDevtoolsProtection() {
  if (!DEVTOOLS_PROTECTION_ENABLED || typeof window === "undefined") return;

  initializeDisableDevtool();

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
