import { ofetch } from "ofetch";

import { getAuthHeaders, withAuthRetry } from "@/backend/accounts/auth";
import { AccountWithToken } from "@/stores/auth";

export interface SessionResponse {
  id: string;
  userId: string;
  createdAt: string;
  accessedAt: string;
  device: string;
  userAgent: string;
}

export interface SessionUpdate {
  deviceName: string;
}

export async function getSessions(url: string, account: AccountWithToken) {
  return withAuthRetry(url, account, (token) =>
    ofetch<SessionResponse[]>(`/users/${account.userId}/sessions`, {
      credentials: "include",
      headers: getAuthHeaders(token),
      baseURL: url,
    }),
  );
}

export async function updateSession(
  url: string,
  account: AccountWithToken,
  update: SessionUpdate,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<SessionResponse[]>(`/sessions/${account.sessionId}`, {
      method: "PATCH",
      credentials: "include",
      headers: getAuthHeaders(token),
      body: update,
      baseURL: url,
    }),
  );
}

export async function removeSession(
  url: string,
  account: AccountWithToken,
  sessionId: string,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<SessionResponse[]>(`/sessions/${sessionId}`, {
      method: "DELETE",
      credentials: "include",
      headers: getAuthHeaders(token),
      baseURL: url,
    }),
  );
}
