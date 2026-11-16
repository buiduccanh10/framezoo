import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  type NativeSubtitleProviderId,
  createSubtitlesTicket,
  getSubtitlesApiKeyStatus,
} from "@/backend/addons/subtitles";
import { openExternalUrl } from "@/desktop/addons/manifest";
import {
  NATIVE_SUBTITLE_ADDON_ID,
  getActiveBackendUrl,
} from "@/desktop/addons/storage";
import { InstalledAddon } from "@/desktop/addons/types";
import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/interface/toast";
import { bumpExternalSubtitleCredentialScope } from "@/utils/externalSubtitles/scope";
import { queryClient } from "@/utils/queryClient";

const PROVIDER_LABELS: Record<NativeSubtitleProviderId, string> = {
  wyzie: "Wyzie",
  subsource: "SubSource",
  opensubtitles: "OpenSubtitles.com",
};

export function useNativeSubtitlesConfig() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const showToast = useToastStore((state) => state.showToast);
  const account = useAuthStore((s) => s.account);

  const [hasNativeCustomKey, setHasNativeCustomKey] = useState<boolean>(false);
  const [configuredNativeProviders, setConfiguredNativeProviders] = useState<
    string[]
  >([]);

  const checkNativeStatus = useCallback(async () => {
    if (!account) {
      setHasNativeCustomKey(false);
      setConfiguredNativeProviders([]);
      return;
    }
    const backend = getActiveBackendUrl();
    const backendBase = backend ? backend.replace(/\/+$/, "") : "";
    if (!backendBase) return;

    try {
      const data = await getSubtitlesApiKeyStatus(backendBase, account);
      setHasNativeCustomKey(Boolean(data.hasCustomKey));
      const activeProviders = (
        Object.keys(PROVIDER_LABELS) as NativeSubtitleProviderId[]
      )
        .filter((id) => Boolean(data.providers?.[id]))
        .map((id) => PROVIDER_LABELS[id]);
      setConfiguredNativeProviders(activeProviders);
    } catch {
      // Ignore network errors
    }
  }, [account]);

  useEffect(() => {
    void checkNativeStatus();
  }, [checkNativeStatus]);

  // Handle toast notification when returning from web setup
  useEffect(() => {
    const status = searchParams.get("subtitles_configured");
    if (!status) return;

    if (status === "success") {
      bumpExternalSubtitleCredentialScope();
      queryClient.removeQueries({ queryKey: ["externalSubtitles"] });
      showToast(
        t(
          "addons.page.subtitlesConfiguredSuccess",
          "Cấu hình API key phụ đề thành công!",
        ),
        "success",
      );
      void checkNativeStatus();
    } else if (status === "failed" || status === "error") {
      showToast(
        t(
          "addons.page.subtitlesConfiguredError",
          "Cấu hình API key phụ đề thất bại. Vui lòng thử lại!",
        ),
        "error",
      );
    }

    const newParams = new URLSearchParams(searchParams);
    newParams.delete("subtitles_configured");
    setSearchParams(newParams, { replace: true });
  }, [searchParams, setSearchParams, showToast, t, checkNativeStatus]);

  const openNativeSubtitlesConfigure = useCallback(
    async (addon: InstalledAddon, fallbackUrl: string) => {
      const isNative =
        addon.isNative || addon.manifest.id === NATIVE_SUBTITLE_ADDON_ID;
      if (!isNative) {
        void openExternalUrl(fallbackUrl);
        return;
      }

      const activeAccount = account ?? useAuthStore.getState().account;
      if (!activeAccount) {
        void openExternalUrl(fallbackUrl);
        return;
      }

      try {
        const backend = getActiveBackendUrl();
        const backendBase = backend ? backend.replace(/\/+$/, "") : "";
        if (!backendBase) {
          void openExternalUrl(fallbackUrl);
          return;
        }

        const isLocalBackend =
          backendBase.includes("localhost") ||
          backendBase.includes("127.0.0.1");

        const frontendOrigin = (() => {
          const appDomain = (conf().APP_DOMAIN || "")
            .trim()
            .replace(/\/+$/, "");
          if (appDomain && appDomain !== "https://framezoo.top") {
            return appDomain;
          }
          if (isLocalBackend) {
            return "http://localhost";
          }
          if (
            typeof window !== "undefined" &&
            window.location.origin &&
            window.location.origin.startsWith("http") &&
            !window.location.origin.includes(":5174")
          ) {
            return window.location.origin;
          }
          return appDomain || "https://framezoo.top";
        })();

        const ticketData = await createSubtitlesTicket(
          backendBase,
          activeAccount,
          frontendOrigin,
        );

        if (ticketData?.url) {
          void openExternalUrl(ticketData.url);
          return;
        }
      } catch (err) {
        console.warn("[addons] Failed to request one-time config ticket:", err);
      }

      void openExternalUrl(fallbackUrl);
    },
    [account],
  );

  return {
    hasNativeCustomKey,
    configuredNativeProviders,
    checkNativeStatus,
    openNativeSubtitlesConfigure,
  };
}
