const GUEST_TOKEN_KEY = "fz_guest_token";
const GUEST_TOKEN_EXP_KEY = "fz_guest_token_exp";

let inMemoryGuestToken: string | null = null;
let inMemoryGuestTokenExp = 0;
let pendingGuestTokenPromise: Promise<string | null> | null = null;

export function getStoredGuestToken(): string | null {
  const now = Date.now();
  if (inMemoryGuestToken && inMemoryGuestTokenExp - now > 30_000) {
    return inMemoryGuestToken;
  }

  try {
    const storedToken = localStorage.getItem(GUEST_TOKEN_KEY);
    const storedExp = Number(localStorage.getItem(GUEST_TOKEN_EXP_KEY) || "0");
    if (storedToken && storedExp - now > 30_000) {
      inMemoryGuestToken = storedToken;
      inMemoryGuestTokenExp = storedExp;
      return storedToken;
    }
  } catch {
    // Ignore localStorage access issues
  }

  return null;
}

export async function ensureGuestToken(
  backendUrl: string | null,
): Promise<string | null> {
  const existing = getStoredGuestToken();
  if (existing) return existing;

  if (pendingGuestTokenPromise) {
    return pendingGuestTokenPromise;
  }

  pendingGuestTokenPromise = (async () => {
    try {
      const baseUrl = backendUrl ? backendUrl.replace(/\/+$/, "") : "";
      const endpoint = baseUrl
        ? `${baseUrl}/api/auth/guest`
        : "/api/auth/guest";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };

      if (!data.access_token) return null;

      const token = data.access_token;
      const expiresInMs = (data.expires_in ?? 1800) * 1000;
      const expTimestamp = Date.now() + expiresInMs;

      inMemoryGuestToken = token;
      inMemoryGuestTokenExp = expTimestamp;

      try {
        localStorage.setItem(GUEST_TOKEN_KEY, token);
        localStorage.setItem(GUEST_TOKEN_EXP_KEY, String(expTimestamp));
      } catch {
        // Ignore localStorage error
      }

      return token;
    } catch {
      return null;
    } finally {
      pendingGuestTokenPromise = null;
    }
  })();

  return pendingGuestTokenPromise;
}
