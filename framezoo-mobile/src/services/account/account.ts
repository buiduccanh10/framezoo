import type { AccountProfile, AccountWithToken } from '@/types';

import { apiRequest } from '../api/client';

export interface MobileSession {
  id: string;
  userId: string;
  createdAt: string;
  accessedAt: string;
  device: string;
  userAgent: string;
}

export interface AccountUpdate {
  profile?: AccountProfile;
  nickname?: string;
}

export function getSessions(baseUrl: string, account: AccountWithToken) {
  return apiRequest<MobileSession[]>(
    baseUrl,
    `/users/${encodeURIComponent(account.userId)}/sessions`,
    { account },
  );
}

export function updateSession(
  baseUrl: string,
  account: AccountWithToken,
  deviceName: string,
) {
  return apiRequest<MobileSession[]>(
    baseUrl,
    `/sessions/${encodeURIComponent(account.sessionId)}`,
    {
      method: 'PATCH',
      account,
      body: JSON.stringify({ deviceName }),
    },
  );
}

export function removeSession(
  baseUrl: string,
  account: AccountWithToken,
  sessionId: string,
) {
  return apiRequest<MobileSession[]>(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE', account },
  );
}

export function updateAccount(
  baseUrl: string,
  account: AccountWithToken,
  input: AccountUpdate,
) {
  return apiRequest<{ user: { profile: AccountProfile; nickname: string } }>(
    baseUrl,
    `/users/${encodeURIComponent(account.userId)}`,
    { method: 'PATCH', account, body: JSON.stringify(input) },
  );
}

export function deleteAccount(baseUrl: string, account: AccountWithToken) {
  return apiRequest<unknown>(
    baseUrl,
    `/users/${encodeURIComponent(account.userId)}`,
    { method: 'DELETE', account },
  );
}
