import { useEffect, useRef } from "react";
import { useAsync, useInterval } from "react-use";

import { useAuth } from "@/hooks/auth/useAuth";
import { useAuthStore } from "@/stores/auth";
import { useBannerStore } from "@/stores/banner";

const AUTH_CHECK_INTERVAL = 12 * 60 * 60 * 1000;

export function useAuthRestore() {
  const { account } = useAuthStore();
  const hydrateAuthSecrets = useAuthStore((s) => s.hydrateAuthSecrets);
  const { restore } = useAuth();
  const hasRestored = useRef(false);

  useInterval(() => {
    if (account && (typeof navigator === "undefined" || navigator.onLine)) {
      restore(account).catch(console.error);
    }
  }, AUTH_CHECK_INTERVAL);

  // When connection comes back online, restore if not yet restored
  useEffect(() => {
    const handleOnline = () => {
      const currentAccount = useAuthStore.getState().account;
      if (currentAccount && !hasRestored.current) {
        restore(currentAccount)
          .then(() => {
            hasRestored.current = true;
          })
          .catch(console.error);
      }
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [restore]);

  const result = useAsync(async () => {
    await hydrateAuthSecrets();
    const hydratedAccount = useAuthStore.getState().account;
    if (hasRestored.current || !hydratedAccount) return;

    // If WiFi/Network is not connected at startup, don't block the app.
    // Enter app in offline mode and show the red wifi icon in header.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      useBannerStore.getState().updateOnline(false);
      return;
    }

    try {
      await restore(hydratedAccount);
      hasRestored.current = true;
    } catch (err) {
      // If network disconnected while restoring, also enter offline mode instead of error screen
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        useBannerStore.getState().updateOnline(false);
        return;
      }
      throw err;
    }
  }, [hydrateAuthSecrets]);

  return result;
}
