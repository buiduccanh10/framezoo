import { useEffect, useRef } from "react";

import {
  createHttpStatusError,
  getAuthHeaders,
  withAuthRetry,
} from "@/backend/accounts/auth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useAuthStore } from "@/stores/auth";
import { useBannerStore } from "@/stores/banner";

const PING_INTERVAL_MS = 5000;
const PUBLIC_ONLINE_SKIP_TICKS = 10; // 50s
const AUTH_ONLINE_SKIP_TICKS = 36; // 3m

export function useOnlineListener() {
  const updateOnline = useBannerStore((s) => s.updateOnline);
  const account = useAuthStore((s) => s.account);
  const backendUrl = useBackendUrl();
  const ref = useRef<boolean>(true);

  useEffect(() => {
    const backendBase = backendUrl?.replace(/\/+$/, "");
    const isAuthenticated = !!account && !!backendBase;
    const pingUrl = isAuthenticated ? `${backendBase}/auth/ping` : "/ping.txt";
    const onlineSkipTicks = isAuthenticated
      ? AUTH_ONLINE_SKIP_TICKS
      : PUBLIC_ONLINE_SKIP_TICKS;

    let counter = 0;

    let abort: null | AbortController = null;
    const interval = setInterval(() => {
      // if online try once every 10 iterations intead of every iteration
      counter += 1;
      if (ref.current) {
        if (counter < onlineSkipTicks) return;
      }
      counter = 0;

      if (abort) abort.abort();
      abort = new AbortController();
      const signal = abort.signal;
      (isAuthenticated
        ? withAuthRetry(backendBase, account, async (token) => {
            const response = await fetch(pingUrl, {
              signal,
              credentials: "include",
              cache: "no-store",
              headers: getAuthHeaders(token),
            });

            if (!response.ok) {
              throw createHttpStatusError(response.status, response.statusText);
            }
          })
        : fetch(pingUrl, {
            signal,
            credentials: "include",
            cache: "no-store",
          }).then((response) => {
            if (!response.ok) {
              throw createHttpStatusError(response.status, response.statusText);
            }
          })
      )
        .then(() => {
          updateOnline(true);
          ref.current = true;
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          updateOnline(false);
          ref.current = false;
        });
    }, PING_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (abort) abort.abort();
    };
  }, [account, backendUrl, updateOnline]);
}
