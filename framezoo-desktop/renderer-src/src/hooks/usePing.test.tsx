import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import { useBannerStore } from "@/stores/banner";

import { useOnlineListener } from "./usePing";

const mocks = vi.hoisted(() => ({
  expireSession: vi.fn(),
  withAuthRetry: vi.fn(),
}));

vi.mock("@/hooks/auth/useAuth", () => ({
  useAuth: () => ({ expireSession: mocks.expireSession }),
}));
vi.mock("@/hooks/auth/useBackendUrl", () => ({
  useBackendUrl: () => "https://example.test",
}));
vi.mock("@/hooks/useIsDesktopApp", () => ({
  useIsDesktopApp: () => true,
}));
vi.mock("@/backend/accounts/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/backend/accounts/auth")>()),
  withAuthRetry: mocks.withAuthRetry,
}));

describe("useOnlineListener with a revoked session", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
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
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("treats a 401 ping as sign-out, without showing the offline icon", async () => {
    mocks.withAuthRetry.mockRejectedValue({ status: 401 });

    act(() => {
      root.render(
        createElement(() => {
          useOnlineListener();
          return null;
        }),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(mocks.expireSession).toHaveBeenCalledOnce();
    expect(useBannerStore.getState().isOnline).toBe(true);
  });
});
