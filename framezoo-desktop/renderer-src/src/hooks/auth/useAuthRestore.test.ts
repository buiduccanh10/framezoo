import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthRestore } from "./useAuthRestore";
import { useAuthStore } from "@/stores/auth";
import { useBannerStore } from "@/stores/banner";

const mockRestore = vi.fn();

vi.mock("@/hooks/auth/useAuth", () => ({
  useAuth: () => ({
    restore: mockRestore,
  }),
}));

describe("useAuthRestore offline behavior", () => {
  const originalOnLine = navigator.onLine;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useBannerStore.setState({ isOnline: true });
    useAuthStore.setState({
      account: {
        userId: "user-test",
        sessionId: "session-test",
        nickname: "tester",
        seed: "seed",
        deviceName: "Desktop",
        profile: { colorA: "#000", colorB: "#fff", icon: "user" },
      },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();

    Object.defineProperty(navigator, "onLine", {
      value: originalOnLine,
      configurable: true,
    });
  });

  function renderHookHelper(onState: (state: ReturnType<typeof useAuthRestore>) => void) {
    function TestComponent() {
      const state = useAuthRestore();
      useEffect(() => {
        onState(state);
      }, [state]);
      return null;
    }

    act(() => {
      root.render(createElement(TestComponent));
    });
  }

  it("does not block with error and marks store offline when navigator.onLine is false", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });

    let currentState: ReturnType<typeof useAuthRestore> | undefined;
    renderHookHelper((state) => {
      currentState = state;
    });

    await vi.waitFor(() => {
      expect(currentState?.loading).toBe(false);
    });

    expect(currentState?.error).toBeUndefined();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(useBannerStore.getState().isOnline).toBe(false);
  });

  it("propagates error when online and restore fails (backend unreachable)", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });

    const backendError = new Error("Backend connection failed");
    mockRestore.mockRejectedValueOnce(backendError);

    let currentState: ReturnType<typeof useAuthRestore> | undefined;
    renderHookHelper((state) => {
      currentState = state;
    });

    await vi.waitFor(() => {
      expect(currentState?.loading).toBe(false);
    });

    expect(currentState?.error).toBe(backendError);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it("triggers restore when window comes back online", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });

    mockRestore.mockResolvedValueOnce(undefined);

    let currentState: ReturnType<typeof useAuthRestore> | undefined;
    renderHookHelper((state) => {
      currentState = state;
    });

    await vi.waitFor(() => {
      expect(currentState?.loading).toBe(false);
    });

    expect(mockRestore).not.toHaveBeenCalled();

    // Now network comes back online
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await vi.waitFor(() => {
      expect(mockRestore).toHaveBeenCalledTimes(1);
    });
  });
});
