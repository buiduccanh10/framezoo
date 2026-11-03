import { ofetch } from "ofetch";

import { AccountWithToken } from "@/stores/auth";

import {
  OAuthTokenResponse,
  SessionResponse,
  getAuthHeaders,
  withAuthRetry,
} from "./auth";
import { UserResponse } from "./user";

export interface OtpChallengeResponse {
  challengeId: string;
  expiresIn: number;
  resendAfter: number;
}

export interface ResetPasswordResponse {
  user: UserResponse;
  session: SessionResponse;
  oauth?: OAuthTokenResponse;
}

export async function requestPasswordReset(url: string, email: string) {
  return ofetch<OtpChallengeResponse & { message: string }>(
    "/auth/password/reset/request",
    {
      method: "POST",
      credentials: "include",
      body: { email },
      baseURL: url,
    },
  );
}

export async function verifyPasswordReset(
  url: string,
  challengeId: string,
  code: string,
) {
  return ofetch<{ actionToken: string }>("/auth/password/reset/verify", {
    method: "POST",
    credentials: "include",
    body: { challengeId, code },
    baseURL: url,
  });
}

export async function completePasswordReset(
  url: string,
  actionToken: string,
  newPublicKey: string,
  device: string,
) {
  return ofetch<ResetPasswordResponse>("/auth/password/reset/complete", {
    method: "POST",
    credentials: "include",
    body: { actionToken, newPublicKey, device },
    baseURL: url,
  });
}

export async function requestPasswordChange(
  url: string,
  account: AccountWithToken,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<OtpChallengeResponse>("/auth/password/change/request", {
      method: "POST",
      credentials: "include",
      headers: getAuthHeaders(token),
      baseURL: url,
    }),
  );
}

export async function completePasswordChange(
  url: string,
  account: AccountWithToken,
  challengeId: string,
  code: string,
  newPublicKey: string,
  device: string,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<{ user: UserResponse; session: SessionResponse }>(
      "/auth/password/change/complete",
      {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(token),
        body: { challengeId, code, newPublicKey, device },
        baseURL: url,
      },
    ),
  );
}

export async function requestEmailChange(
  url: string,
  account: AccountWithToken,
  newEmail: string,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<OtpChallengeResponse>("/auth/email/change/request", {
      method: "POST",
      credentials: "include",
      headers: getAuthHeaders(token),
      body: { newEmail },
      baseURL: url,
    }),
  );
}

export async function verifyEmailChangeOld(
  url: string,
  account: AccountWithToken,
  challengeId: string,
  code: string,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<OtpChallengeResponse>("/auth/email/change/verify-old", {
      method: "POST",
      credentials: "include",
      headers: getAuthHeaders(token),
      body: { challengeId, code },
      baseURL: url,
    }),
  );
}

export async function completeEmailChange(
  url: string,
  account: AccountWithToken,
  flowId: string,
  code: string,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<{ user: UserResponse }>("/auth/email/change/complete", {
      method: "POST",
      credentials: "include",
      headers: getAuthHeaders(token),
      body: { flowId, code },
      baseURL: url,
    }),
  );
}

export async function resendOtp(url: string, challengeId: string) {
  return ofetch<OtpChallengeResponse>("/auth/otp/resend", {
    method: "POST",
    credentials: "include",
    body: { challengeId },
    baseURL: url,
  });
}
