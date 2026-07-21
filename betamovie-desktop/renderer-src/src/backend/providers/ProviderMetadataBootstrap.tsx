import { useEffect, useRef } from "react";

import { refreshCachedMetadata } from "@/backend/helpers/providerApi";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";

import {
  hasLoadedProviderMetadata,
  loadProviderMetadata,
} from "./runtimeMetadata";

const PROVIDER_REFRESH_STALE_MS = 5 * 60 * 1000;

export function ProviderMetadataBootstrap() {
  const backendUrl = useBackendUrl();
  const lastRefreshAtRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const refreshProviders = async (force = false) => {
      const now = Date.now();
      if (
        !force &&
        hasLoadedProviderMetadata() &&
        lastRefreshAtRef.current > 0 &&
        now - lastRefreshAtRef.current < PROVIDER_REFRESH_STALE_MS
      ) {
        refreshCachedMetadata();
        return;
      }

      if (refreshPromiseRef.current) {
        await refreshPromiseRef.current;
        return;
      }

      refreshPromiseRef.current = (async () => {
        await loadProviderMetadata(force);
        refreshCachedMetadata();
        lastRefreshAtRef.current = Date.now();
      })()
        .catch((error) => {
          console.warn("[ProviderMetadataBootstrap] Refresh failed", error);
        })
        .finally(() => {
          refreshPromiseRef.current = null;
        });

      await refreshPromiseRef.current;
    };

    const handleVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshProviders(true);
    };

    const handleInteraction = () => {
      void refreshProviders(false);
    };

    void refreshProviders(true);

    window.addEventListener("focus", handleVisible);
    window.addEventListener("online", handleVisible);
    window.addEventListener("pageshow", handleVisible);
    window.addEventListener("pointerdown", handleInteraction, true);
    window.addEventListener("keydown", handleInteraction, true);
    document.addEventListener("visibilitychange", handleVisible);

    return () => {
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("online", handleVisible);
      window.removeEventListener("pageshow", handleVisible);
      window.removeEventListener("pointerdown", handleInteraction, true);
      window.removeEventListener("keydown", handleInteraction, true);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [backendUrl]);

  return null;
}
