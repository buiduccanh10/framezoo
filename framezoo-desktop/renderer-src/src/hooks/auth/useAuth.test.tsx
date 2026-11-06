import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import { useBannerStore } from "@/stores/banner";
import { useToastStore } from "@/stores/interface/toast";

import { useAuth } from "./useAuth";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  withAuthRetry: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/backend/accounts/user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/backend/accounts/user")>()),
  getUser: mocks.getUser,
}));
vi.mock("@/backend/accounts/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/backend/accounts/auth")>()),
  withAuthRetry: mocks.withAuthRetry,
}));
vi.mock("@/hooks/auth/useAuthData", () => ({
  useAuthData: () => ({
    logout: mocks.logout,
    login: vi.fn(),
    syncData: vi.fn(),
  }),
}));
vi.mock("@/hooks/auth/useBackendUrl", () => ({
  useBackendUrl: () => "https://example.test",
}));

describe("useAuth restore after session revocation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let auth: ReturnType<typeof useAuth>;
  const account = {
    userId: "user-test",
    sessionId: "session-test",
    nickname: "tester",
    seed: "seed",
    deviceName: "Desktop",
    profile: { colorA: "#000", colorB: "#fff", icon: "user" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({ account });
    useBannerStore.setState({ isOnline: false });
    useToastStore.setState({ toast: null });
    mocks.logout.mockImplementation(async () => {
      useAuthStore.getState().removeAccount();
    });

    act(() => {
      root.render(
        createElement(() => {
          auth = useAuth();
          return null;
        }),
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("enters guest mode with a warning when token and cookie both return 401", async () => {
    mocks.withAuthRetry.mockRejectedValueOnce({ status: 401 });
    mocks.getUser.mockRejectedValueOnce({ status: 401 });

    await act(async () => auth.restore(account));

    expect(useAuthStore.getState().account).toBeNull();
    expect(useBannerStore.getState().isOnline).toBe(true);
    expect(useToastStore.getState().toast?.type).toBe("warning");
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("preserves the account on a server error", async () => {
    mocks.withAuthRetry.mockRejectedValueOnce({ status: 503 });

    await expect(auth.restore(account)).rejects.toMatchObject({ status: 503 });

    expect(useAuthStore.getState().account?.sessionId).toBe(account.sessionId);
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});
