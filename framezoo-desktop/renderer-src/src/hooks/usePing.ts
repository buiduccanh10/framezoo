import { useEffect, useRef } from "react";

import {
  createHttpStatusError,
  getAuthHeaders,
  withAuthRetry,
} from "@/backend/accounts/auth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";
import { useAuthStore } from "@/stores/auth";
import { useBannerStore } from "@/stores/banner";
import { resolvePublicUrl } from "@/utils/publicUrl";

const PING_INTERVAL_MS = 5000;
const PUBLIC_ONLINE_SKIP_TICKS = 10; // 50s
const AUTH_ONLINE_SKIP_TICKS = 36; // 3m
const MAX_CONSECUTIVE_FAILURES = 3;

export function useOnlineListener() {
  const updateOnline = useBannerStore((s) => s.updateOnline);
  const account = useAuthStore((s) => s.account);
  const backendUrl = useBackendUrl();
  const isDesktopApp = useIsDesktopApp();
  const isOnlineRef = useRef<boolean>(true);
  const failureCountRef = useRef<number>(0);

  useEffect(() => {
    const backendBase = backendUrl?.replace(/\/+$/, "");
    const isAuthenticated = !!account && !!backendBase;
    const pingUrl = isAuthenticated
      ? `${backendBase}/auth/ping`
      : isDesktopApp && backendBase
        ? `${backendBase}/meta`
        : (resolvePublicUrl("/ping.txt") ?? "/ping.txt");
    const onlineSkipTicks = isAuthenticated
      ? AUTH_ONLINE_SKIP_TICKS
      : PUBLIC_ONLINE_SKIP_TICKS;

    let counter = 0;

    let abort: null | AbortController = null;
    const interval = setInterval(() => {
      counter += 1;
      // If currently online and no recent failures, skip ticks to reduce polling frequency.
      // If we experienced failures, poll every tick (5s) to retry and confirm status.
      if (isOnlineRef.current && failureCountRef.current === 0) {
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
            headers:
              isDesktopApp && backendBase
                ? {
                    accept: "application/json",
                  }
                : undefined,
          }).then((response) => {
            if (!response.ok) {
              throw createHttpStatusError(response.status, response.statusText);
            }
          })
      )
        .then(() => {
          failureCountRef.current = 0;
          isOnlineRef.current = true;
          updateOnline(true);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          failureCountRef.current += 1;
          if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
            isOnlineRef.current = false;
            updateOnline(false);
          }
        });
    }, PING_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (abort) abort.abort();
    };
  }, [account, backendUrl, isDesktopApp, updateOnline]);
}
