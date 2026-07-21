import { ofetch } from "ofetch";

import { getAuthHeaders, withAuthRetry } from "@/backend/accounts/auth";
import { AccountWithToken } from "@/stores/auth";

export interface GroupOrderResponse {
  groupOrder: string[];
}

export function updateGroupOrder(
  url: string,
  account: AccountWithToken,
  groupOrder: string[],
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<GroupOrderResponse>(`/users/${account.userId}/group-order`, {
      method: "PUT",
      credentials: "include",
      body: groupOrder,
      baseURL: url,
      headers: getAuthHeaders(token),
    }),
  );
}

export function getGroupOrder(url: string, account: AccountWithToken) {
  return withAuthRetry(url, account, (token) =>
    ofetch<GroupOrderResponse>(`/users/${account.userId}/group-order`, {
      method: "GET",
      credentials: "include",
      baseURL: url,
      headers: getAuthHeaders(token),
    }),
  ).catch((err) => {
    if (err?.response?.status === 404) {
      return { groupOrder: [] };
    }
    throw err;
  });
}
