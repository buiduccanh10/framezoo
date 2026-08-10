import type { AccountWithToken } from '@/types';

import { apiRequest } from '../api/client';

export interface MobileSettings {
  applicationLanguage?: string;
  applicationTheme?: string | null;
  defaultSubtitleLanguage?: string;
  enableAutoplay?: boolean;
  enableSkipCredits?: boolean;
  enableAutoSkipSegments?: boolean;
  enableAutoResumeOnPlaybackError?: boolean;
  enableDoubleClickToSeek?: boolean;
  proxyTmdb?: boolean;
  torrentMaxSizeBytes?: string | null;
}

export function getSettings(baseUrl: string, account: AccountWithToken) {
  return apiRequest<MobileSettings>(
    baseUrl,
    `/users/${encodeURIComponent(account.userId)}/settings`,
    { account },
  );
}

export function updateSettings(
  baseUrl: string,
  account: AccountWithToken,
  settings: MobileSettings,
) {
  return apiRequest<MobileSettings>(
    baseUrl,
    `/users/${encodeURIComponent(account.userId)}/settings`,
    { method: 'PUT', account, body: JSON.stringify(settings) },
  );
}
