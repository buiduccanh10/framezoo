import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bytesToBase64,
  encryptData,
  keysFromMnemonic,
} from "@/backend/accounts/crypto";

import {
  loadAuthSecrets,
  recoverSeedFromSavedLogin,
  saveAuthSecrets,
} from "./secureSession";

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

  it("does not overwrite existing secrets when saving an account with empty seed", async () => {
    secureStoreGet.mockResolvedValue(
      JSON.stringify({
        userId: "user-1",
        sessionId: "session-1",
        token: "access-token",
        refreshToken: "refresh-token",
        seed: "existing-seed",
      }),
    );
    secureStoreSave.mockResolvedValue(true);

    await saveAuthSecrets({
      userId: "user-1",
      sessionId: "session-1",
      token: undefined,
      refreshToken: undefined,
      seed: "",
    });

    expect(secureStoreSave).toHaveBeenCalledWith(
      "auth_session",
      expect.stringContaining('"seed":"existing-seed"'),
    );
  });

  it("never writes a seed-less payload when the stored entry is unreadable", async () => {
    // safeStorage failing to decrypt (e.g. after an ad-hoc re-sign) returns null.
    secureStoreGet.mockResolvedValue(null);
    secureStoreSave.mockResolvedValue(true);

    const result = await saveAuthSecrets({
      userId: "user-1",
      sessionId: "session-1",
      token: "fresh-access",
      refreshToken: undefined,
      seed: "",
    });

    expect(result).toBe(false);
    expect(secureStoreSave).not.toHaveBeenCalled();
  });

  it("recovers the seed from saved login only when it decrypts the device name", async () => {
    const password = "correct horse battery staple";
    const keys = await keysFromMnemonic(password);
    const deviceName = await encryptData("Cảnh's MacBook", keys.seed);

    secureStoreGet.mockImplementation(async (key: string) =>
      key === "saved_login" ? JSON.stringify({ username: "me", password }) : null,
    );
    await expect(recoverSeedFromSavedLogin({ deviceName })).resolves.toBe(
      bytesToBase64(keys.seed),
    );

    secureStoreGet.mockImplementation(async (key: string) =>
      key === "saved_login"
        ? JSON.stringify({ username: "me", password: "other password" })
        : null,
    );
    await expect(recoverSeedFromSavedLogin({ deviceName })).resolves.toBeNull();
  });
});
