import { ofetch } from "ofetch";

import { getAuthHeaders, withAuthRetry } from "@/backend/accounts/auth";
import { AccountWithToken } from "@/stores/auth";

export type NativeSubtitleProviderId = "wyzie" | "subsource" | "opensubtitles";

export interface SubtitlesStatusResponse {
  configured: boolean;
  hasCustomKey: boolean;
  provider: string | null;
  providers?: Partial<Record<NativeSubtitleProviderId, boolean>>;
}

export interface SubtitlesTicketResponse {
  ticket: string;
  url: string;
}

export async function getSubtitlesApiKeyStatus(
  url: string,
  account: AccountWithToken,
): Promise<SubtitlesStatusResponse> {
  try {
    return await withAuthRetry(url, account, (token) =>
      ofetch<SubtitlesStatusResponse>("/addon/subtitles/api/status", {
        method: "GET",
        baseURL: url,
        credentials: "include",
        headers: getAuthHeaders(token),
      }),
    );
  } catch {
    return {
      configured: false,
      hasCustomKey: false,
      provider: null,
    };
  }
}

export async function createSubtitlesTicket(
  url: string,
  account: AccountWithToken,
  frontendOrigin: string,
): Promise<SubtitlesTicketResponse> {
  return withAuthRetry(url, account, (token) =>
    ofetch<SubtitlesTicketResponse>("/addon/subtitles/api/ticket", {
      method: "POST",
      baseURL: url,
      credentials: "include",
      headers: getAuthHeaders(token),
      body: {
        frontendOrigin,
      },
    }),
  );
}
