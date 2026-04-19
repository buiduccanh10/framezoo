import { ofetch } from "ofetch";

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
