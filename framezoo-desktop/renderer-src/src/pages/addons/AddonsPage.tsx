import classNames from "classnames";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCopyToClipboard } from "react-use";

import { createHttpStatusError, withAuthRetry } from "@/backend/accounts/auth";
import { AddonResourceBadges } from "@/components/addons/AddonResourceBadges";
import { Icon, Icons } from "@/components/Icon";
import { AddonManager } from "@/components/layout/AddonManager";
import { WideContainer } from "@/components/layout/WideContainer";
import { Heading1 } from "@/components/utils/Text";
import { AddonLogo } from "@/desktop/addons/AddonLogo";
import {
  getAddonConfigureUrl,
  isAddonConfigurable,
  isAddonConfigurationRequired,
  openExternalUrl,
} from "@/desktop/addons/manifest";
import {
  NATIVE_SUBTITLE_ADDON_ID,
  getActiveBackendUrl,
} from "@/desktop/addons/storage";
import {
  removeAddon,
  setAddonEnabled,
  useInstalledAddons,
} from "@/desktop/addons/store";
import type { InstalledAddon } from "@/desktop/addons/types";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";
import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/interface/toast";

export function AddonsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const addons = useInstalledAddons();
  const [, copyToClipboard] = useCopyToClipboard();
  const showToast = useToastStore((state) => state.showToast);
  const account = useAuthStore((s) => s.account);

  const [hasNativeCustomKey, setHasNativeCustomKey] = useState<boolean>(false);

  const checkNativeStatus = useCallback(async () => {
    if (!account) {
      setHasNativeCustomKey(false);
      return;
    }
    const backend = getActiveBackendUrl();
    const backendBase = backend ? backend.replace(/\/+$/, "") : "";
    if (!backendBase) return;

    try {
      const data = await withAuthRetry(backendBase, account, async (token) => {
        const response = await fetch(
          `${backendBase}/addon/subtitles/api/status`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!response.ok) return { hasCustomKey: false };
        return response.json();
      });
      setHasNativeCustomKey(Boolean(data?.hasCustomKey));
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

  const handleShareAddon = (manifestUrl: string) => {
    copyToClipboard(manifestUrl);
    showToast(t("toasts.linkCopied"), "success");
  };

  const handleConfigureAddon = async (
    addon: InstalledAddon,
    defaultUrl: string,
  ) => {
    if (addon.isNative || addon.manifest.id === NATIVE_SUBTITLE_ADDON_ID) {
      const activeAccount = account ?? useAuthStore.getState().account;
      if (activeAccount) {
        try {
          const backend = getActiveBackendUrl();
          const backendBase = backend ? backend.replace(/\/+$/, "") : "";
          if (backendBase) {
            const frontendOrigin = (() => {
              const appDomain = (conf().APP_DOMAIN || "")
                .trim()
                .replace(/\/+$/, "");
              if (appDomain && appDomain !== "https://framezoo.top") {
                return appDomain;
              }
              if (
                typeof window !== "undefined" &&
                window.location.origin &&
                window.location.origin.startsWith("http")
              ) {
                return window.location.origin;
              }
              return appDomain || "https://framezoo.top";
            })();

            const ticketData = await withAuthRetry(
              backendBase,
              activeAccount,
              async (token) => {
                const response = await fetch(
                  `${backendBase}/addon/subtitles/api/ticket`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Frontend-Origin": frontendOrigin,
                      ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                      frontendOrigin,
                    }),
                  },
                );
                if (!response.ok) {
                  throw createHttpStatusError(
                    response.status,
                    `Ticket request failed with status ${response.status}`,
                  );
                }
                return response.json();
              },
            );

            if (ticketData?.url) {
              void openExternalUrl(ticketData.url);
              return;
            }
          }
        } catch (err) {
          console.warn(
            "[addons] Failed to request one-time config ticket:",
            err,
          );
        }
      }
    }
    void openExternalUrl(defaultUrl);
  };

  return (
    <SubPageLayout>
      <WideContainer>
        <div className="flex items-center justify-between gap-8">
          <Heading1 className="text-4xl font-bold text-white">
            {t("addons.page.title", "Addons Manager")}
          </Heading1>
          <div className="flex flex-wrap justify-end gap-8">
            <AddonManager>
              {(open) => (
                <button
                  type="button"
                  onClick={open}
                  className="flex items-center gap-2 rounded-xl bg-buttons-purple px-5 py-2.5 font-semibold text-sm text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-buttons-purpleHover active:scale-95"
                >
                  <Icon icon={Icons.PLUS} className="text-base" />
                  <span>{t("addons.page.addAddonButton", "Add Addon")}</span>
                </button>
              )}
            </AddonManager>
          </div>
        </div>

        <div className="flex items-center gap-4 pb-8 mt-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center font-medium text-white transition-colors hover:text-gray-300"
          >
            <Icon icon={Icons.ARROW_LEFT} className="text-xl" />
            <span className="ml-2">
              {t("discover.page.back", "Back to home")}
            </span>
          </button>
        </div>

        {/* Installed Addons List */}
        <div className="mb-4 flex items-center gap-3">
          <Icon icon={Icons.EXTENSION} className="text-xl text-white" />
          <h2 className="text-xl font-bold text-white">
            {t("addons.page.installedHeading", "Installed Addons")}
          </h2>
        </div>
        <div className="max-h-[62vh] overflow-y-auto overscroll-contain pr-2 space-y-3 pb-6">
          {addons.length === 0 ? (
            <div className="rounded-2xl border border-dropdown-border border-dashed bg-dropdown-contentBackground/20 p-8 text-center text-dropdown-text">
              <p className="font-medium text-sm">
                {t(
                  "addons.page.emptyInstalled",
                  "No addons installed in the system yet.",
                )}
              </p>
            </div>
          ) : (
            addons.map((addon) => {
              const isConfigRequired = isAddonConfigurationRequired(
                addon.manifest,
              );
              const isConfigurable = isAddonConfigurable(addon.manifest);
              const isNative =
                addon.isNative ||
                addon.manifest.id === NATIVE_SUBTITLE_ADDON_ID;
              const hasConfiguredCustomKey = isNative && hasNativeCustomKey;
              const configureUrl = getAddonConfigureUrl(
                addon.manifestUrl,
                addon.baseUrl,
                addon.manifest,
              );

              return (
                <div
                  key={addon.manifest.id}
                  className="flex items-center gap-4 rounded-xl border border-dropdown-border bg-dropdown-contentBackground/60 p-4 transition-all duration-200 hover:border-dropdown-border/80 hover:bg-dropdown-contentBackground"
                >
                  <AddonLogo
                    name={addon.manifest.name}
                    logo={addon.manifest.logo}
                    className="h-11 w-11 rounded-lg bg-black/20 p-1"
                    fallbackIcon={
                      addon.isNative ||
                      addon.manifest.resources?.includes("subtitles")
                        ? Icons.CAPTIONS
                        : Icons.EXTENSION
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-base text-white">
                        {addon.manifest.name}
                      </p>
                      {addon.manifest.version ? (
                        <span className="shrink-0 rounded bg-dropdown-altBackground px-2 py-0.5 text-dropdown-text text-xs">
                          v{addon.manifest.version}
                        </span>
                      ) : null}
                      {hasConfiguredCustomKey ? (
                        <span className="shrink-0 rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                          {t(
                            "addons.page.customKeyConfiguredBadge",
                            "Key của bạn đã được cấu hình",
                          )}
                        </span>
                      ) : null}
                      {isConfigRequired ? (
                        <span className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
                          {t(
                            "addons.page.configRequiredBadge",
                            "Requires Configuration",
                          )}
                        </span>
                      ) : null}
                      <p className="min-w-0 flex-1 truncate text-[11px] text-dropdown-text opacity-60 ml-1">
                        {addon.manifestUrl}
                      </p>
                    </div>
                    <AddonResourceBadges
                      resources={addon.manifest.resources}
                      className="mt-1"
                    />
                    {hasConfiguredCustomKey ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                        <Icon
                          icon={Icons.CHECKMARK}
                          className="shrink-0 text-sm text-emerald-400"
                        />
                        <span>
                          {t(
                            "addons.page.customKeyActiveDesc",
                            "Đang sử dụng API key Wyzie riêng của tài khoản",
                          )}
                        </span>
                      </p>
                    ) : null}
                    {isConfigRequired ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-300/90">
                        <Icon
                          icon={Icons.WARNING}
                          className="shrink-0 text-sm text-amber-400"
                        />
                        <span>
                          {t(
                            "addons.page.configRequiredWarning",
                            "This addon is not configured and may fail to load streams or subtitles.",
                          )}
                        </span>
                      </p>
                    ) : null}
                    {addon.manifest.description ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-dropdown-text opacity-90">
                        {addon.manifest.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg p-2 text-dropdown-text transition-colors hover:bg-blue-500/20 hover:text-blue-400"
                      onClick={() => handleShareAddon(addon.manifestUrl)}
                      aria-label={t("actions.copy")}
                      title={t("actions.copy")}
                    >
                      <Icon icon={Icons.IOS_SHARE} className="text-base" />
                    </button>
                    {isConfigurable ? (
                      <button
                        type="button"
                        className={classNames(
                          "rounded-lg p-2 transition-colors",
                          hasConfiguredCustomKey
                            ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                            : isConfigRequired
                              ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                              : "text-dropdown-text hover:bg-green-500/20 hover:text-green-400",
                        )}
                        onClick={() =>
                          void handleConfigureAddon(addon, configureUrl)
                        }
                        title={
                          hasConfiguredCustomKey
                            ? t(
                                "addons.page.configureCustomKeyActive",
                                "Key của bạn đã được cấu hình (nhấn để đổi)",
                              )
                            : isConfigRequired
                              ? t(
                                  "addons.page.configureRequiredAction",
                                  "Configure this addon (Required)",
                                )
                              : t(
                                  "addons.page.configureAddon",
                                  "Configure this addon",
                                )
                        }
                      >
                        <Icon icon={Icons.SETTINGS} className="text-base" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={classNames(
                        "rounded-lg px-3.5 py-1.5 font-semibold text-xs transition-colors",
                        addon.enabled
                          ? "bg-buttons-purple text-white hover:bg-buttons-purpleHover"
                          : "bg-dropdown-altBackground text-dropdown-text hover:bg-pill-backgroundHover hover:text-white",
                      )}
                      onClick={() =>
                        setAddonEnabled(addon.manifest.id, !addon.enabled)
                      }
                    >
                      {addon.enabled
                        ? t("addons.page.enabled", "Enabled")
                        : t("addons.page.disabled", "Disabled")}
                    </button>
                    {!addon.isNative ? (
                      <button
                        type="button"
                        className="rounded-lg p-2 text-dropdown-text transition-colors hover:bg-red-500/20 hover:text-red-400"
                        onClick={() => removeAddon(addon.manifest.id)}
                        aria-label={t(
                          "addons.page.removeAddon",
                          "Remove this addon",
                        )}
                        title={t(
                          "addons.page.removeAddon",
                          "Remove this addon",
                        )}
                      >
                        <Icon icon={Icons.X} className="text-base" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </WideContainer>
    </SubPageLayout>
  );
}
