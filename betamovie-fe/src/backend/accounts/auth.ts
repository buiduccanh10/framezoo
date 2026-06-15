import { ofetch } from "ofetch";

import { useAuthStore } from "@/stores/auth";
import type { AccountWithToken } from "@/stores/auth";

export interface SessionResponse {
  id: string;
  user?: string;
  userId?: string;
  createdAt: string;
  accessedAt: string;
  expiresAt?: string;
  device: string;
  userAgent: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  refreshTokenExpiresIn?: number;
}

export interface LoginResponse {
  session: SessionResponse;
  oauth?: OAuthTokenResponse;
}

type RetryableAccount = Pick<
  AccountWithToken,
  "sessionId" | "userId" | "token"
>;

let tokenRefreshInFlight: Promise<string | null> | null = null;

export function normalizeAccessToken(
  oauth?: OAuthTokenResponse | null,
): string | undefined {
  if (!oauth) return undefined;
  return oauth.accessToken || oauth.access_token;
}

export function getAuthHeaders(token?: string): Record<string, string> {
  if (!token) {
    return {};
  }

  return {
    authorization: `Bearer ${token}`,
  };
}

export function isAuthErrorStatus(status?: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

export function createHttpStatusError(status: number, statusText?: string) {
  const error = new Error(
    statusText || `Request failed with status ${status}`,
  ) as Error & { status: number };
  error.status = status;
  return error;
}

function getErrorStatus(error: unknown): number | undefined {
  const anyError = error as any;
  return anyError?.status ?? anyError?.statusCode ?? anyError?.response?.status;
}

function isMatchingAccount(
  currentAccount: AccountWithToken,
  account?: RetryableAccount | null,
) {
  if (!account) {
    return true;
  }

  return (
    currentAccount.userId === account.userId &&
    currentAccount.sessionId === account.sessionId
  );
}

export async function refreshOAuthToken(
  url: string,
): Promise<OAuthTokenResponse> {
  return ofetch<OAuthTokenResponse>("/oauth/token", {
    method: "POST",
    credentials: "include",
    body: {
      grant_type: "refresh_token",
    },
    baseURL: url,
  });
}

export async function refreshAccessTokenForAccount(
  url: string,
  account?: RetryableAccount | null,
): Promise<string | null> {
  if (!tokenRefreshInFlight) {
    tokenRefreshInFlight = (async () => {
      try {
        const oauth = await refreshOAuthToken(url);
        const accessToken = normalizeAccessToken(oauth);
        if (!accessToken) return null;

        const { account: currentAccount, setAccount } = useAuthStore.getState();
        if (currentAccount && isMatchingAccount(currentAccount, account)) {
          setAccount({
            ...currentAccount,
            token: accessToken,
          });
        }

        return accessToken;
      } catch {
        return null;
      } finally {
        tokenRefreshInFlight = null;
      }
    })();
  }

  return tokenRefreshInFlight;
}

export async function withAuthRetry<T>(
  url: string,
  account: RetryableAccount | null | undefined,
  request: (token?: string) => Promise<T>,
): Promise<T> {
  try {
    return await request(account?.token);
  } catch (error) {
    if (!isAuthErrorStatus(getErrorStatus(error))) {
      throw error;
    }

    const refreshedToken = await refreshAccessTokenForAccount(url, account);
    if (!refreshedToken) {
      throw error;
    }

    return request(refreshedToken);
  }
}

export async function accountLogin(
  url: string,
  id: string,
  deviceName: string,
): Promise<LoginResponse> {
  return ofetch<LoginResponse>("/auth/login", {
    method: "POST",
    credentials: "include",
    body: {
      id,
      device: deviceName,
    },
    baseURL: url,
  });
}
