import { describe, expect, it } from "vitest";

import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  ShortcutId,
  matchesShortcut,
  resolveCapturedShortcutKey,
} from "./keyboardShortcuts";

function makeKeyboardEvent(
  init: KeyboardEventInit & { code?: string; isComposing?: boolean },
): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("keyboardShortcuts", () => {
  const earlierConfig =
    DEFAULT_KEYBOARD_SHORTCUTS[ShortcutId.SYNC_SUBTITLES_EARLIER];
  const laterConfig =
    DEFAULT_KEYBOARD_SHORTCUTS[ShortcutId.SYNC_SUBTITLES_LATER];

  it("matches default [ and ] keys on US QWERTY", () => {
    expect(
      matchesShortcut(
        makeKeyboardEvent({ key: "[", code: "BracketLeft" }),
        earlierConfig,
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        makeKeyboardEvent({ key: "]", code: "BracketRight" }),
        laterConfig,
      ),
    ).toBe(true);
  });

  it("matches Vietnamese Telex first-press outputs ơ/ư (including synthetic OS IME events)", () => {
    // OpenKey / EVKey / UniKey replace `[` -> `ơ` and `]` -> `ư` on the first press,
    // often with `code` rewritten to `KeyA` (macOS keyCode 0) or `""` (Windows SendInput).
    for (const syntheticCode of ["", "Unidentified", "KeyA", "BracketLeft"]) {
      expect(
        matchesShortcut(
          makeKeyboardEvent({ key: "ơ", code: syntheticCode }),
          earlierConfig,
        ),
      ).toBe(true);
      expect(
        matchesShortcut(
          makeKeyboardEvent({ key: "Ơ", code: syntheticCode }),
          earlierConfig,
        ),
      ).toBe(true);
    }

    for (const syntheticCode of ["", "Unidentified", "KeyA", "BracketRight"]) {
      expect(
        matchesShortcut(
          makeKeyboardEvent({ key: "ư", code: syntheticCode }),
          laterConfig,
        ),
      ).toBe(true);
      expect(
        matchesShortcut(
          makeKeyboardEvent({ key: "Ư", code: syntheticCode }),
          laterConfig,
        ),
      ).toBe(true);
    }

    // Synthetic OpenKey carrier `KeyA` with `ơ` / `ư` must never trigger a shortcut bound to `A`.
    expect(
      matchesShortcut(makeKeyboardEvent({ key: "ơ", code: "KeyA" }), {
        key: "A",
      }),
    ).toBe(false);
    expect(
      matchesShortcut(makeKeyboardEvent({ key: "ư", code: "KeyA" }), {
        key: "A",
      }),
    ).toBe(false);
  });

  it("matches Apple standard Vietnamese layout using BracketLeft/BracketRight without swapping [ and ]", () => {
    // On Apple's standard Vietnamese layout, physical `[` (`BracketLeft`) emits `ư`
    // and physical `]` (`BracketRight`) emits `ơ`.
    const appleLeft = makeKeyboardEvent({ key: "ư", code: "BracketLeft" });
    const appleRight = makeKeyboardEvent({ key: "ơ", code: "BracketRight" });

    expect(matchesShortcut(appleLeft, earlierConfig)).toBe(true);
    expect(matchesShortcut(appleLeft, laterConfig)).toBe(false);

    expect(matchesShortcut(appleRight, laterConfig)).toBe(true);
    expect(matchesShortcut(appleRight, earlierConfig)).toBe(false);
  });

  it("matches IME dead/process composition keys on BracketLeft/BracketRight", () => {
    expect(
      matchesShortcut(
        makeKeyboardEvent({
          key: "Process",
          code: "BracketLeft",
          isComposing: true,
        }),
        earlierConfig,
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        makeKeyboardEvent({ key: "Dead", code: "BracketRight" }),
        laterConfig,
      ),
    ).toBe(true);
  });

  it("does not override remapped printable ASCII layouts like Dvorak", () => {
    expect(
      matchesShortcut(
        makeKeyboardEvent({ key: "/", code: "BracketLeft" }),
        earlierConfig,
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        makeKeyboardEvent({ key: "[", code: "Minus" }),
        earlierConfig,
      ),
    ).toBe(true);
  });

  it("still respects Shift modifier constraints", () => {
    expect(
      matchesShortcut(
        makeKeyboardEvent({ key: "{", code: "BracketLeft", shiftKey: true }),
        earlierConfig,
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        makeKeyboardEvent({ key: "ơ", code: "BracketLeft", shiftKey: true }),
        earlierConfig,
      ),
    ).toBe(false);
  });

  it("resolves captured shortcut keys when IME transforms [ / ]", () => {
    expect(
      resolveCapturedShortcutKey(makeKeyboardEvent({ key: "ơ", code: "KeyA" })),
    ).toBe("[");
    expect(
      resolveCapturedShortcutKey(makeKeyboardEvent({ key: "ư", code: "KeyA" })),
    ).toBe("]");
    expect(
      resolveCapturedShortcutKey(
        makeKeyboardEvent({
          key: "Process",
          code: "BracketLeft",
          isComposing: true,
        }),
      ),
    ).toBe("[");
    expect(
      resolveCapturedShortcutKey(
        makeKeyboardEvent({ key: "ư", code: "BracketLeft" }),
      ),
    ).toBe("[");
    expect(
      resolveCapturedShortcutKey(
        makeKeyboardEvent({ key: "ơ", code: "BracketRight" }),
      ),
    ).toBe("]");
  });
});
