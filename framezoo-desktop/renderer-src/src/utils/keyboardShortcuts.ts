/**
 * Keyboard shortcuts configuration and utilities
 */

export type KeyboardModifier = "Shift" | "Alt";

export interface KeyboardShortcutConfig {
  modifier?: KeyboardModifier;
  key?: string;
}

export type KeyboardShortcuts = Record<string, KeyboardShortcutConfig>;

/**
 * Shortcut IDs for customizable shortcuts
 */
export enum ShortcutId {
  // Video playback
  SKIP_FORWARD_5 = "skipForward5",
  SKIP_BACKWARD_5 = "skipBackward5",
  SKIP_FORWARD_10 = "skipForward10",
  SKIP_BACKWARD_10 = "skipBackward10",
  SKIP_FORWARD_1 = "skipForward1",
  SKIP_BACKWARD_1 = "skipBackward1",
  NEXT_EPISODE = "nextEpisode",
  PREVIOUS_EPISODE = "previousEpisode",

  // Jump to position
  JUMP_TO_0 = "jumpTo0",
  JUMP_TO_9 = "jumpTo9",

  // Audio/Video
  INCREASE_VOLUME = "increaseVolume",
  DECREASE_VOLUME = "decreaseVolume",
  MUTE = "mute",
  TOGGLE_FULLSCREEN = "toggleFullscreen",

  // Subtitles/Accessibility
  TOGGLE_CAPTIONS = "toggleCaptions",
  RANDOM_CAPTION = "randomCaption",
  SYNC_SUBTITLES_EARLIER = "syncSubtitlesEarlier",
  SYNC_SUBTITLES_LATER = "syncSubtitlesLater",

  // Interface
  BARREL_ROLL = "barrelRoll",
}

/**
 * Default keyboard shortcuts configuration
 */
export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  [ShortcutId.SKIP_FORWARD_5]: { key: "ArrowRight" },
  [ShortcutId.SKIP_BACKWARD_5]: { key: "ArrowLeft" },
  [ShortcutId.SKIP_FORWARD_10]: { key: "L" },
  [ShortcutId.SKIP_BACKWARD_10]: { key: "J" },
  [ShortcutId.SKIP_FORWARD_1]: { key: "." },
  [ShortcutId.SKIP_BACKWARD_1]: { key: "," },
  [ShortcutId.NEXT_EPISODE]: { key: "P" },
  [ShortcutId.PREVIOUS_EPISODE]: { key: "O" },
  [ShortcutId.JUMP_TO_0]: { key: "0" },
  [ShortcutId.JUMP_TO_9]: { key: "9" },
  [ShortcutId.INCREASE_VOLUME]: { key: "ArrowUp" },
  [ShortcutId.DECREASE_VOLUME]: { key: "ArrowDown" },
  [ShortcutId.MUTE]: { key: "M" },
  [ShortcutId.TOGGLE_FULLSCREEN]: { key: "F" },
  [ShortcutId.TOGGLE_CAPTIONS]: { key: "C" },
  [ShortcutId.RANDOM_CAPTION]: { modifier: "Shift", key: "C" },
  [ShortcutId.SYNC_SUBTITLES_EARLIER]: { key: "[" },
  [ShortcutId.SYNC_SUBTITLES_LATER]: { key: "]" },
  [ShortcutId.BARREL_ROLL]: { key: "R" },
};

/**
 * Locked shortcuts that cannot be customized
 */
export const LOCKED_SHORTCUTS = {
  PLAY_PAUSE_SPACE: " ",
  PLAY_PAUSE_K: "K",
  MODAL_HOTKEY: "`",
  ARROW_UP: "ArrowUp",
  ARROW_DOWN: "ArrowDown",
  ARROW_LEFT: "ArrowLeft",
  ARROW_RIGHT: "ArrowRight",
  ESCAPE: "Escape",
  JUMP_TO_0: "0",
  JUMP_TO_9: "9",
} as const;

/**
 * Locked shortcut IDs that cannot be customized
 */
export const LOCKED_SHORTCUT_IDS: string[] = [
  "playPause",
  "playPauseAlt",
  "skipForward5",
  "skipBackward5",
  "increaseVolume",
  "decreaseVolume",
  "modalHotkey",
  "closeOverlay",
  "jumpTo0",
  "jumpTo9",
];

/**
 * Check if a key is a number key (0-9)
 */
export function isNumberKey(key: string): boolean {
  return /^[0-9]$/.test(key);
}

/**
 * Key equivalence map for bidirectional mapping
 * Maps keys that should be treated as equivalent (e.g., 1 and !)
 */
export const KEY_EQUIVALENCE_MAP: Record<string, string> = {
  // Number keys and their shift equivalents
  "1": "!",
  "!": "1",
  "2": "@",
  "@": "2",
  "3": "#",
  "#": "3",
  "4": "$",
  $: "4",
  "5": "%",
  "%": "5",
  "6": "^",
  "^": "6",
  "7": "&",
  "&": "7",
  "8": "*",
  "*": "8",
  "9": "(",
  "(": "9",
  "0": ")",
  ")": "0",

  // Other symbol pairs
  "-": "_",
  _: "-",
  "=": "+",
  "+": "=",
  "[": "{",
  "{": "[",
  "]": "}",
  "}": "]",
  "\\": "|",
  "|": "\\",
  ";": ":",
  ":": ";",
  "'": '"',
  '"': "'",
  ",": "<",
  "<": ",",
  ".": ">",
  ">": ".",
  "/": "?",
  "?": "/",
  "`": "~",
  "~": "`",
};

/**
 * Get equivalent keys for a given key
 */
export function getEquivalentKeys(key: string): string[] {
  const equivalent = KEY_EQUIVALENCE_MAP[key];
  if (equivalent) {
    return [key, equivalent];
  }
  return [key];
}

/**
 * Normalize a key for comparison (handles case-insensitive matching)
 */
export function normalizeKey(key: string): string {
  // For letter keys, use uppercase for consistency
  if (/^[a-z]$/i.test(key)) {
    return key.toUpperCase();
  }
  return key;
}

/**
 * Check if two shortcut configs conflict
 */
export function checkShortcutConflict(
  config1: KeyboardShortcutConfig | undefined,
  config2: KeyboardShortcutConfig | undefined,
): boolean {
  if (!config1 || !config2 || !config1.key || !config2.key) {
    return false;
  }

  // Check if modifiers match
  if (config1.modifier !== config2.modifier) {
    return false;
  }

  // Check if keys match directly or are equivalent
  const key1 = normalizeKey(config1.key);
  const key2 = normalizeKey(config2.key);

  if (key1 === key2) {
    return true;
  }

  // Check equivalence
  const equiv1 = getEquivalentKeys(key1);
  const equiv2 = getEquivalentKeys(key2);

  return equiv1.some((k1) => equiv2.includes(k1));
}

/**
 * Find all conflicts in a shortcuts configuration
 */
export function findConflicts(
  shortcuts: KeyboardShortcuts,
): Array<{ id1: string; id2: string }> {
  const conflicts: Array<{ id1: string; id2: string }> = [];
  const ids = Object.keys(shortcuts);

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const id1 = ids[i];
      const id2 = ids[j];
      const config1 = shortcuts[id1];
      const config2 = shortcuts[id2];

      if (checkShortcutConflict(config1, config2)) {
        conflicts.push({ id1, id2 });
      }
    }
  }

  return conflicts;
}

/**
 * Physical key code mapping for US QWERTY keys, used as a fallback when an IME
 * or non-Latin keyboard layout intercepts the printable key value.
 */
const KEY_TO_CODE_MAP: Record<string, string> = {
  "[": "BracketLeft",
  "{": "BracketLeft",
  "]": "BracketRight",
  "}": "BracketRight",
  ",": "Comma",
  "<": "Comma",
  ".": "Period",
  ">": "Period",
  ";": "Semicolon",
  ":": "Semicolon",
  "'": "Quote",
  '"': "Quote",
  "/": "Slash",
  "?": "Slash",
  "\\": "Backslash",
  "|": "Backslash",
  "-": "Minus",
  _: "Minus",
  "=": "Equal",
  "+": "Equal",
  "`": "Backquote",
  "~": "Backquote",
};

const CODE_TO_KEY_MAP: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

const IME_INTERCEPTED_KEYS = new Set(["", "Process", "Dead", "Unidentified"]);

function getExpectedKeyCode(key: string): string | undefined {
  if (/^[a-z]$/i.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(key)) {
    return `Digit${key}`;
  }
  return KEY_TO_CODE_MAP[key];
}

function isImeOrNonAsciiEvent(event: KeyboardEvent): boolean {
  const key = event.key ?? "";
  return (
    Boolean(event.isComposing) ||
    IME_INTERCEPTED_KEYS.has(key) ||
    /[^\x20-\x7e]/.test(key)
  );
}

function matchesVietnameseTelexBracket(
  event: KeyboardEvent,
  configKey: string,
): boolean {
  const lowerKey = (event.key ?? "").toLowerCase();
  if ((configKey === "[" || configKey === "{") && lowerKey === "ơ") {
    return event.code !== "BracketRight";
  }
  if ((configKey === "]" || configKey === "}") && lowerKey === "ư") {
    return event.code !== "BracketLeft" && event.code !== "KeyW";
  }
  return false;
}

/**
 * Resolve a captured shortcut key to its canonical key identifier when an IME
 * transforms `[` / `]` or emits a dead/composition key.
 */
export function resolveCapturedShortcutKey(event: KeyboardEvent): string {
  const key = event.key ?? "";
  const lowerKey = key.toLowerCase();

  if (lowerKey === "ơ") {
    return event.code === "BracketRight" ? "]" : "[";
  }
  if (lowerKey === "ư") {
    if (event.code === "BracketLeft") return "[";
    if (event.code === "KeyW") return "W";
    return "]";
  }

  if (IME_INTERCEPTED_KEYS.has(key) || event.isComposing) {
    if (event.code in CODE_TO_KEY_MAP) {
      return CODE_TO_KEY_MAP[event.code];
    }
    const letterMatch = /^Key([A-Z])$/.exec(event.code);
    if (letterMatch) {
      return letterMatch[1];
    }
    const digitMatch = /^Digit([0-9])$/.exec(event.code);
    if (digitMatch) {
      return digitMatch[1];
    }
  }

  return key;
}

/**
 * Check if a keyboard event matches a shortcut configuration
 */
export function matchesShortcut(
  event: KeyboardEvent,
  config: KeyboardShortcutConfig | undefined,
): boolean {
  if (!config || !config.key) {
    return false;
  }

  const rawEventKey = event.key ?? "";
  const eventKey = normalizeKey(rawEventKey);
  const configKey = normalizeKey(config.key);

  // Check modifier match
  if (config.modifier === "Shift" && !event.shiftKey) {
    return false;
  }
  if (config.modifier === "Alt" && !event.altKey) {
    return false;
  }
  // If no modifier specified, ensure no modifier is pressed (except ctrl/meta which we ignore)
  if (!config.modifier && (event.shiftKey || event.altKey)) {
    return false;
  }

  // Check key match (direct or equivalent)
  if (eventKey === configKey) {
    return true;
  }

  // Check equivalence
  const equivKeys = getEquivalentKeys(configKey);
  if (equivKeys.includes(eventKey)) {
    return true;
  }

  // Fallback for IME / non-Latin layouts when the OS/IME alters `event.key`
  // (e.g. Vietnamese Telex converting `[` -> `ơ` and `]` -> `ư` on the first press,
  // or Apple Vietnamese / CJK layouts while preserving `event.code`).
  if (matchesVietnameseTelexBracket(event, configKey)) {
    return true;
  }

  const expectedCode = getExpectedKeyCode(configKey);
  const lowerKey = rawEventKey.toLowerCase();
  // macOS IMEs such as OpenKey inject synthetic Unicode events on keyCode 0 (`KeyA`),
  // so never let synthetic `ơ` / `ư` trigger a shortcut bound to `A`.
  const isSyntheticTelexCarrier =
    expectedCode === "KeyA" && (lowerKey === "ơ" || lowerKey === "ư");

  if (
    expectedCode &&
    event.code === expectedCode &&
    !isSyntheticTelexCarrier &&
    isImeOrNonAsciiEvent(event)
  ) {
    return true;
  }

  return false;
}

/**
 * Get display name for a key
 */
export function getKeyDisplayName(key: string): string {
  const displayNames: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    " ": "Space",
  };

  return displayNames[key] || key;
}

/**
 * Get display symbol for a modifier
 */
export function getModifierSymbol(modifier: KeyboardModifier): string {
  return modifier === "Shift" ? "⇧" : "⌥";
}
