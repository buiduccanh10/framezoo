import type { AccountWithToken } from "./index";

const AUTH_SESSION_KEY = "auth_session";

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

  return api.secureStoreSave(
    AUTH_SESSION_KEY,
    JSON.stringify({
      userId: account.userId,
      sessionId: account.sessionId,
      token: account.token,
      refreshToken: account.refreshToken,
      seed: account.seed,
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
