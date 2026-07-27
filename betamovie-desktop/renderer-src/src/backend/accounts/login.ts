import { ofetch } from "ofetch";

import { OAuthTokenResponse, SessionResponse } from "@/backend/accounts/auth";

export interface ChallengeTokenResponse {
  challenge: string;
  publicKey?: string;
}

export async function getLoginChallengeToken(
  url: string,
  identifier: string,
): Promise<ChallengeTokenResponse> {
  return ofetch<ChallengeTokenResponse>("/auth/login/start", {
    method: "POST",
    credentials: "include",
    body: {
      identifier,
    },
    baseURL: url,
  });
}

export interface LoginResponse {
  session: SessionResponse;
  oauth?: OAuthTokenResponse;
}

export interface LoginInput {
  identifier?: string;
  publicKey: string;
  challenge: {
    code: string;
    signature: string;
  };
  device: string;
}

export async function loginAccount(
  url: string,
  data: LoginInput,
): Promise<LoginResponse> {
  return ofetch<LoginResponse>("/auth/login/complete", {
    method: "POST",
    credentials: "include",
    body: {
      namespace: "movie-web",
      ...data,
    },
    baseURL: url,
  });
}
