import {
  bytesToBase64,
  decryptData,
  keysFromMnemonic,
} from "@/backend/accounts/crypto";

import type { AccountWithToken } from "./index";

const AUTH_SESSION_KEY = "auth_session";
const SAVED_LOGIN_KEY = "saved_login";

type AuthSecrets = Pick<AccountWithToken, "token" | "refreshToken" | "seed">;
type StoredAuthSecrets = AuthSecrets &
  Pick<AccountWithToken, "userId" | "sessionId">;

function secureStore() {
  if (typeof window === "undefined" || window.__FRAMEZOO_DESKTOP__ !== true) {
    return undefined;
  }
  return window.electronAPI;
}

export function hasSecureSessionSupport() {
  return typeof secureStore()?.secureStoreGet === "function";
}

export async function saveAuthSecrets(
  account: Pick<
    AccountWithToken,
    "userId" | "sessionId" | "token" | "refreshToken" | "seed"
  >,
) {
  const api = secureStore();
  if (!api?.secureStoreSave) return false;

  let { token, refreshToken, seed } = account;

  // Preserve stored secrets if an unhydrated account state is saved
  if (!seed || !token) {
    const existing = await loadAuthSecrets().catch(() => null);
    if (
      existing &&
      existing.userId === account.userId &&
      existing.sessionId === account.sessionId
    ) {
      token = token || existing.token;
      refreshToken = refreshToken || existing.refreshToken;
      seed = seed || existing.seed;
    }
  }

  // Never persist a seed-less session. Every logged-in account has a seed
  // (it is the only key able to decrypt device names and synced data); an
  // empty one means the state was saved before secrets were hydrated, or
  // safeStorage/Keychain could not read the stored entry (e.g. right after an
  // app update re-signed the bundle). Overwriting would destroy the seed.
  if (!seed) return false;

  return api.secureStoreSave(
    AUTH_SESSION_KEY,
    JSON.stringify({
      userId: account.userId,
      sessionId: account.sessionId,
      token,
      refreshToken,
      seed,
    }),
  );
}

export async function loadAuthSecrets(): Promise<StoredAuthSecrets | null> {
  const value = await secureStore()?.secureStoreGet?.(AUTH_SESSION_KEY);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<StoredAuthSecrets>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.sessionId !== "string"
    ) {
      return null;
    }
    if (parsed.seed !== undefined && typeof parsed.seed !== "string") {
      return null;
    }
    if (parsed.token !== undefined && typeof parsed.token !== "string") {
      return null;
    }
    if (
      parsed.refreshToken !== undefined &&
      typeof parsed.refreshToken !== "string"
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      sessionId: parsed.sessionId,
      token: parsed.token,
      refreshToken: parsed.refreshToken,
      seed: parsed.seed ?? "",
    };
  } catch {
    return null;
  }
}

export async function removeAuthSecrets() {
  await secureStore()?.secureStoreRemove?.(AUTH_SESSION_KEY);
}

/**
 * Re-derive a lost account seed from the "remember me" credentials.
 *
 * Login derives the seed deterministically from the password
 * (`keysFromMnemonic(password)`), so it can be rebuilt without logging in
 * again. The candidate is only accepted if it decrypts the current session's
 * encrypted device name (AES-GCM authenticates the key), so a stale or
 * different saved password can never install a wrong seed.
 */
export async function recoverSeedFromSavedLogin(
  account: Pick<AccountWithToken, "deviceName">,
): Promise<string | null> {
  if (!account.deviceName) return null;
  const raw = await secureStore()
    ?.secureStoreGet?.(SAVED_LOGIN_KEY)
    .catch(() => null);
  if (!raw) return null;

  let password: unknown;
  try {
    password = (JSON.parse(raw) as { password?: unknown }).password;
  } catch {
    return null;
  }
  if (typeof password !== "string" || !password) return null;

  try {
    const keys = await keysFromMnemonic(password);
    decryptData(account.deviceName, keys.seed);
    return bytesToBase64(keys.seed);
  } catch {
    return null;
  }
}
