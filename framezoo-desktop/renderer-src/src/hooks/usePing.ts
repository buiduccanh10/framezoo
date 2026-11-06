import { useEffect, useRef } from "react";

import {
  createHttpStatusError,
  getAuthHeaders,
  getErrorStatus,
  withAuthRetry,
} from "@/backend/accounts/auth";
import { useAuth } from "@/hooks/auth/useAuth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";
import { useAuthStore } from "@/stores/auth";
import { useBannerStore } from "@/stores/banner";
import { resolvePublicUrl } from "@/utils/publicUrl";

const PING_INTERVAL_MS = 5000;
const PUBLIC_ONLINE_SKIP_TICKS = 10; // 50s
const AUTH_ONLINE_SKIP_TICKS = 12; // 1m
const MAX_CONSECUTIVE_FAILURES = 3;

export function useOnlineListener() {
  const updateOnline = useBannerStore((s) => s.updateOnline);
  const { expireSession } = useAuth();
  const account = useAuthStore((s) => s.account);
  const backendUrl = useBackendUrl();
  const isDesktopApp = useIsDesktopApp();
  const isOnlineRef = useRef<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const failureCountRef = useRef<number>(
    typeof navigator !== "undefined" && !navigator.onLine
      ? MAX_CONSECUTIVE_FAILURES
      : 0,
  );

  useEffect(() => {
    const handleOffline = () => {
      isOnlineRef.current = false;
      failureCountRef.current = MAX_CONSECUTIVE_FAILURES;
      updateOnline(false);
    };

    const handleOnline = () => {
      isOnlineRef.current = true;
      failureCountRef.current = 0;
      updateOnline(true);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      handleOffline();
    }

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
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (isOnlineRef.current) {
          handleOffline();
        }
        return;
      }

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
          if (account && getErrorStatus(err) === 401) {
            void expireSession(account);
            return;
          }
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
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [account, backendUrl, expireSession, isDesktopApp, updateOnline]);
}
