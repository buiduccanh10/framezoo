import disableDevtool from "disable-devtool";

const DETECTION_INTERVAL_MS = 1000;
const DEVTOOLS_PAUSE_THRESHOLD_MS = 150;
const RELOAD_COOLDOWN_MS = 2000;

function parseBooleanEnv(value: string | undefined, defaultValue: boolean) {
  if (value == null) return defaultValue;

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  return defaultValue;
}

const DEVTOOLS_PROTECTION_ENABLED = parseBooleanEnv(
  import.meta.env.VITE_ENABLE_DEVTOOLS_PROTECTION,
  import.meta.env.PROD,
);

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
