import { ofetch } from "ofetch";

import { getAuthHeaders, withAuthRetry } from "@/backend/accounts/auth";
import type { InstalledAddon } from "@/desktop/addons/types";
import { AccountWithToken } from "@/stores/auth";
import { KeyboardShortcuts } from "@/utils/keyboardShortcuts";

export interface CustomThemeSettings {
  primary: string;
  secondary: string;
  tertiary: string;
}

export interface SettingsInput {
  applicationLanguage?: string;
  applicationTheme?: string | null;
  defaultSubtitleLanguage?: string;
  enableAutoplay?: boolean;
  enableSkipCredits?: boolean;
  enableAutoSkipSegments?: boolean;
  proxyTmdb?: boolean;
  enableNumberKeySeeking?: boolean;
  keyboardShortcuts?: KeyboardShortcuts;
  customTheme?: CustomThemeSettings;
  addons?: InstalledAddon[];
}

export interface SettingsResponse {
  applicationTheme?: string | null;
  applicationLanguage?: string | null;
  defaultSubtitleLanguage?: string | null;
  enableAutoplay?: boolean;
  enableSkipCredits?: boolean;
  enableAutoSkipSegments?: boolean;
  proxyTmdb?: boolean;
  enableNumberKeySeeking?: boolean;
  keyboardShortcuts?: KeyboardShortcuts;
  customTheme?: CustomThemeSettings;
  addons?: InstalledAddon[];
}

export function updateSettings(
  url: string,
  account: AccountWithToken,
  settings: SettingsInput,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<SettingsResponse>(`/users/${account.userId}/settings`, {
      method: "PUT",
      credentials: "include",
      body: settings,
      baseURL: url,
      headers: getAuthHeaders(token),
    }),
  );
}

export function getSettings(url: string, account: AccountWithToken) {
  return withAuthRetry(url, account, (token) =>
    ofetch<SettingsResponse>(`/users/${account.userId}/settings`, {
      method: "GET",
      credentials: "include",
      baseURL: url,
      headers: getAuthHeaders(token),
    }),
  );
}
