import { useRef } from "react";
import { useAsync, useInterval } from "react-use";

import { useAuth } from "@/hooks/auth/useAuth";
import { useAuthStore } from "@/stores/auth";

const AUTH_CHECK_INTERVAL = 12 * 60 * 60 * 1000;

export function useAuthRestore() {
  const { account } = useAuthStore();
  const hydrateAuthSecrets = useAuthStore((s) => s.hydrateAuthSecrets);
  const { restore } = useAuth();
  const hasRestored = useRef(false);

  useInterval(() => {
    if (account) restore(account);
  }, AUTH_CHECK_INTERVAL);

  const result = useAsync(async () => {
    await hydrateAuthSecrets();
    const hydratedAccount = useAuthStore.getState().account;
    if (hasRestored.current || !hydratedAccount) return;
    await restore(hydratedAccount).finally(() => {
      hasRestored.current = true;
    });
  }, [hydrateAuthSecrets]);

  return result;
}
