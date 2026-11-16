import { ofetch } from "ofetch";

import {
  OAuthTokenResponse,
  SessionResponse,
  getAppVersionHeaders,
} from "@/backend/accounts/auth";
import { UserResponse } from "@/backend/accounts/user";

export interface ChallengeTokenResponse {
  challenge: string;
}

export interface OtpChallengeResponse {
  challengeId: string;
  expiresIn: number;
  resendAfter: number;
}

export async function requestRegistrationOtp(
  url: string,
  email: string,
): Promise<OtpChallengeResponse> {
  return ofetch<OtpChallengeResponse>("/auth/register/otp/request", {
    method: "POST",
    credentials: "include",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { email },
    baseURL: url,
  });
}

export async function getRegisterChallengeToken(
  url: string,
  captchaToken?: string,
): Promise<ChallengeTokenResponse> {
  return ofetch<ChallengeTokenResponse>("/auth/register/start", {
    method: "POST",
    credentials: "include",
    body: {
      captchaToken,
    },
    baseURL: url,
  });
}

export interface RegisterResponse {
  user: UserResponse;
  session: SessionResponse;
  oauth?: OAuthTokenResponse;
}

export interface LegalConsentInput {
  acceptedTerms: true;
  acceptedPrivacy: true;
  ageConfirmed: true;
  termsVersion: string;
  privacyVersion: string;
  platform: "web" | "desktop" | "mobile" | "tv";
}

export interface RegisterInput {
  publicKey: string;
  challenge: {
    code: string;
    signature: string;
  };
  device: string;
  nickname: string;
  email: string;
  profile: {
    colorA: string;
    colorB: string;
    icon: string;
  };
  emailOtp?: {
    challengeId: string;
    code: string;
  };
  legalConsent: LegalConsentInput;
}

export async function registerAccount(
  url: string,
  data: RegisterInput,
): Promise<RegisterResponse> {
  return ofetch<RegisterResponse>("/auth/register/complete", {
    method: "POST",
    credentials: "include",
    headers: getAppVersionHeaders(),
    body: {
      namespace: "desktop",
      ...data,
    },
    baseURL: url,
  });
}
