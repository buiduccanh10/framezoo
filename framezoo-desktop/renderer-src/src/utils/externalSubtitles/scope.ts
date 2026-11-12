import { useAuthStore } from "@/stores/auth";

let credentialScopeRevision = 0;

/**
 * Identifies the local account/credential context without exposing a provider
 * secret. The revision changes whenever the account's provider key changes.
 */
export function getExternalSubtitleCredentialScope(): string {
  const account = useAuthStore.getState().account;
  // An account without hydrated auth secrets still makes guest requests.
  // Keep that traffic out of the account-scoped subtitle cache.
  const owner = account?.token ? account.userId : "guest";
  return `${owner}:${credentialScopeRevision}`;
}

export function bumpExternalSubtitleCredentialScope(): void {
  credentialScopeRevision += 1;
}
