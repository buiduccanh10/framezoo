import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOtpCountdown } from "./useOtpCountdown";

describe("useOtpCountdown", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  function renderHookHelper(
    initialExpires: number,
    initialResend = 0,
    onState: (state: ReturnType<typeof useOtpCountdown>) => void,
  ) {
    function TestComponent() {
      const state = useOtpCountdown(initialExpires, initialResend);
      useEffect(() => {
        onState(state);
      });
      return null;
    }

    act(() => {
      root.render(createElement(TestComponent));
    });
  }

  it("initializes with formatted time and active state", () => {
    let currentState: ReturnType<typeof useOtpCountdown> | undefined;
    renderHookHelper(300, 30, (state) => {
      currentState = state;
    });

    expect(currentState?.expiresIn).toBe(300);
    expect(currentState?.resendAfter).toBe(30);
    expect(currentState?.formattedTime).toBe("5:00");
    expect(currentState?.isExpired).toBe(false);
    expect(currentState?.canResend).toBe(false);
  });

  it("counts down every second", () => {
    let currentState: ReturnType<typeof useOtpCountdown> | undefined;
    renderHookHelper(65, 5, (state) => {
      currentState = state;
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(currentState?.expiresIn).toBe(64);
    expect(currentState?.resendAfter).toBe(4);
    expect(currentState?.formattedTime).toBe("1:04");

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(currentState?.resendAfter).toBe(0);
    expect(currentState?.canResend).toBe(true);
  });

  it("resets countdown timers correctly", () => {
    let currentState: ReturnType<typeof useOtpCountdown> | undefined;
    renderHookHelper(10, 5, (state) => {
      currentState = state;
    });

    act(() => {
      currentState?.reset(180, 45);
    });

    expect(currentState?.expiresIn).toBe(180);
    expect(currentState?.resendAfter).toBe(45);
    expect(currentState?.formattedTime).toBe("3:00");
  });
});
