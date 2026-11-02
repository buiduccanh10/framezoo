import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthSecrets, saveAuthSecrets } from "./secureSession";

describe("secure auth session", () => {
  const secureStoreGet = vi.fn();
  const secureStoreSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(window, {
      __FRAMEZOO_DESKTOP__: true,
      electronAPI: { secureStoreGet, secureStoreSave },
    });
  });

  it("loads only a validated encrypted-store payload", async () => {
    secureStoreGet.mockResolvedValue(
      JSON.stringify({
        userId: "user-1",
        sessionId: "session-1",
        token: "access",
        refreshToken: "refresh",
        seed: "seed",
      }),
    );

    await expect(loadAuthSecrets()).resolves.toEqual({
      userId: "user-1",
      sessionId: "session-1",
      token: "access",
      refreshToken: "refresh",
      seed: "seed",
    });
  });

  it("writes the session secret bundle through Electron secure storage", async () => {
    secureStoreSave.mockResolvedValue(true);

    await saveAuthSecrets({
      userId: "user-1",
      sessionId: "session-1",
      token: "access",
      refreshToken: "refresh",
      seed: "seed",
    });

    expect(secureStoreSave).toHaveBeenCalledWith(
      "auth_session",
      expect.stringContaining('"token":"access"'),
    );
  });
});
