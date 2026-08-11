import type { AccountProfile, AccountWithToken } from '@/types';
import {
  deriveAuthKeys,
  encodeBytes,
  encodePublicKey,
  signChallenge,
} from '@/services/auth';

import { apiRequest } from './client';

export interface LoginInput {
  identifier: string;
  password: string;
}

interface AuthChallenge {
  challenge: string;
  publicKey?: string;
}

interface BackendUser {
  id: string;
  publicKey?: string;
  nickname: string;
  email?: string | null;
  profile: AccountProfile;
}

interface BackendSession {
  id: string;
  device?: string;
}

interface OAuthResponse {
  access_token?: string;
  refresh_token?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface AuthResponse {
  user: BackendUser;
  session: BackendSession;
  oauth?: OAuthResponse;
}

export async function login(
  baseUrl: string,
  input: LoginInput,
): Promise<AccountWithToken> {
  const keys = deriveAuthKeys(input.password);
  const challenge = await apiRequest<AuthChallenge>(baseUrl, '/auth/login/start', {
    method: 'POST',
    body: JSON.stringify({ identifier: input.identifier }),
  });
  const response = await apiRequest<AuthResponse>(baseUrl, '/auth/login/complete', {
    method: 'POST',
    body: JSON.stringify({
      namespace: 'movie-web',
      identifier: input.identifier,
      publicKey: challenge.publicKey ?? encodePublicKey(keys.publicKey),
      challenge: {
        code: challenge.challenge,
        signature: signChallenge(keys.secretKey, challenge.challenge),
      },
      device: 'Framezoo',
    }),
  });

  return toAccount(response, keys.seed);
}

export async function register(
  baseUrl: string,
  input: {
    nickname: string;
    email: string;
    password: string;
    profile: AccountProfile;
  },
): Promise<AccountWithToken> {
  const keys = deriveAuthKeys(input.password);
  const challenge = await apiRequest<{ challenge: string }>(
    baseUrl,
    '/auth/register/start',
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
  const response = await apiRequest<AuthResponse>(baseUrl, '/auth/register/complete', {
    method: 'POST',
    body: JSON.stringify({
      namespace: 'movie-web',
      nickname: input.nickname,
      email: input.email,
      profile: input.profile,
      publicKey: encodePublicKey(keys.publicKey),
      challenge: {
        code: challenge.challenge,
        signature: signChallenge(keys.secretKey, challenge.challenge),
      },
      device: 'Framezoo',
    }),
  });

  return toAccount(response, keys.seed);
}

function toAccount(response: AuthResponse, seed: Uint8Array): AccountWithToken {
  const token = response.oauth?.accessToken ?? response.oauth?.access_token;
  const refreshToken =
    response.oauth?.refreshToken ?? response.oauth?.refresh_token;

  return {
    profile: response.user.profile,
    nickname: response.user.nickname,
    email: response.user.email ?? null,
    sessionId: response.session.id,
    userId: response.user.id,
    token,
    refreshToken,
    seed: encodeBytes(seed),
    deviceName: response.session.device ?? 'Framezoo',
  };
}
