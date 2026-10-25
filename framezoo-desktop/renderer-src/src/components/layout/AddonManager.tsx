import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { AddonPlatformBadges } from "@/components/addons/AddonPlatformBadges";
import { AddonResourceBadges } from "@/components/addons/AddonResourceBadges";
import { Icon, Icons } from "@/components/Icon";
import { Spinner } from "@/components/layout/Spinner";
import { OverlayPortal } from "@/components/overlays/OverlayDisplay";
import { AddonLogo } from "@/desktop/addons/AddonLogo";
import { loadAddonManifest } from "@/desktop/addons/client";
import {
  getAddonConfigureUrl,
  isAddonConfigurationRequired,
  openExternalUrl,
} from "@/desktop/addons/manifest";
import { installAddon } from "@/desktop/addons/store";
import type { InstalledAddon } from "@/desktop/addons/types";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";

export function AddonManager({
  children,
}: {
  children?: (open: () => void) => React.ReactNode;
} = {}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktopApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InstalledAddon | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequestId = useRef(0);

  useEffect(() => {
    const manifestUrl = url.trim();
    const requestId = ++previewRequestId.current;

    if (!manifestUrl) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    setPreview(null);

    const timeout = setTimeout(() => {
      loadAddonManifest(manifestUrl)
        .then((addon) => {
          if (requestId === previewRequestId.current) setPreview(addon);
        })
        .catch(() => {
          if (requestId === previewRequestId.current) setPreview(null);
        })
        .finally(() => {
          if (requestId === previewRequestId.current) {
            setPreviewLoading(false);
          }
        });
    }, 500);

    return () => clearTimeout(timeout);
  }, [url]);

  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setUrl("");
        setError(null);
        setPreview(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!isDesktop) return null;

  const add = async () => {
    if (!url.trim() || loading || previewLoading) return;

    setLoading(true);
    setError(null);
    try {
      await installAddon(url);
      setUrl("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("addons.manager.errorFallback", "Unable to install this addon."),
      );
    } finally {
      setLoading(false);
    }
  };

  const isBusy = loading || previewLoading;
  const isAddonsPage = location.pathname === "/addons";
  const isConfigRequired = isAddonConfigurationRequired(preview?.manifest);
  const configureUrl = preview
    ? getAddonConfigureUrl(
        preview.manifestUrl,
        preview.baseUrl,
        preview.manifest,
      )
    : "";

  return (
    <>
      {children ? (
        children(() => setOpen(true))
      ) : (
        <button
          type="button"
          className="pointer-events-auto shrink-0 rounded-full text-lg text-white tabbable backdrop-blur-lg"
          onClick={() => setOpen(true)}
          aria-label={t("addons.manager.ariaManage", "Manage addons")}
          title={t("addons.manager.ariaManage", "Manage addons")}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pill-background/50 transition-colors hover:bg-pill-backgroundHover">
            <Icon icon={Icons.EXTENSION} />
          </span>
        </button>
      )}

      <OverlayPortal
        darken
        close={() => setOpen(false)}
        show={open}
        durationClass="duration-200"
        zIndex={1000}
      >
        <Helmet>
          <html data-no-scroll />
        </Helmet>
        <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
          <div
            className="pointer-events-auto w-full max-w-lg rounded-2xl border border-dropdown-border bg-dropdown-altBackground/95 p-6 shadow-2xl backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">
                  {t("addons.manager.title", "Desktop Addons")}
                </h2>
                <p className="mt-1 text-xs text-dropdown-text">
                  {t(
                    "addons.manager.subtitle",
                    "Add a manifest URL you choose. The app does not bundle or recommend addons.",
                  )}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-dropdown-text">
                  <span>
                    {t("addons.platforms.supportLabel", "Supported platforms:")}
                  </span>
                  <AddonPlatformBadges compact />
                </div>
              </div>
              <button
                type="button"
                className="rounded p-2 text-dropdown-text hover:bg-dropdown-contentBackground hover:text-white"
                onClick={() => setOpen(false)}
                aria-label={t(
                  "addons.manager.ariaClose",
                  "Close addon manager",
                )}
              >
                <Icon icon={Icons.X} />
              </button>
            </div>

            <div className="flex gap-2.5">
              <input
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && url.trim() && !isBusy) {
                    if (isConfigRequired) {
                      void openExternalUrl(configureUrl);
                    } else {
                      void add();
                    }
                  }
                }}
                placeholder="https://addon.example.com/manifest.json"
                className="min-w-0 flex-1 rounded-xl border border-dropdown-border bg-dropdown-contentBackground px-3.5 py-2.5 text-sm text-white placeholder-dropdown-text/60 outline-none transition-colors focus:border-type-link"
                disabled={loading}
              />
              <button
                type="button"
                className={classNames(
                  "rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 active:scale-95",
                  isConfigRequired
                    ? "bg-amber-600 hover:bg-amber-500 hover:scale-105"
                    : "bg-buttons-purple hover:bg-buttons-purpleHover hover:scale-105",
                  (!url.trim() || isBusy) &&
                    "!cursor-not-allowed !scale-100 opacity-60 hover:bg-buttons-purple",
                )}
                onClick={() => {
                  if (isConfigRequired) {
                    void openExternalUrl(configureUrl);
                  } else {
                    void add();
                  }
                }}
                disabled={!url.trim() || isBusy}
                aria-busy={isBusy}
              >
                {isBusy ? (
                  <>
                    <Spinner className="mr-2 inline-block h-4 w-4 text-current" />
                    {loading
                      ? t("addons.manager.adding", "Adding...")
                      : t("addons.page.processing", "Processing...")}
                  </>
                ) : isConfigRequired ? (
                  <span className="flex items-center gap-1.5">
                    <Icon icon={Icons.SETTINGS} className="text-sm" />
                    <span>
                      {t("addons.manager.configureAction", "Configure")}
                    </span>
                  </span>
                ) : (
                  t("addons.manager.add", "Add")
                )}
              </button>
            </div>

            {previewLoading ? (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-dropdown-border bg-dropdown-contentBackground p-3">
                <div className="h-10 w-10 animate-pulse rounded bg-dropdown-border" />
                <div className="flex flex-col gap-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-dropdown-border" />
                  <div className="h-3 w-48 animate-pulse rounded bg-dropdown-border" />
                </div>
              </div>
            ) : preview ? (
              <>
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-dropdown-border bg-dropdown-contentBackground p-3">
                  <AddonLogo
                    name={preview.manifest.name}
                    logo={preview.manifest.logo}
                    className="h-10 w-10 rounded bg-dropdown-border"
                  />
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate font-semibold text-white">
                      {preview.manifest.name}{" "}
                      <span className="text-xs font-normal text-dropdown-text">
                        v{preview.manifest.version}
                      </span>
                    </span>
                    <AddonResourceBadges
                      resources={preview.manifest.resources}
                      className="mt-1"
                    />
                    {preview.manifest.description && (
                      <span className="truncate text-xs text-dropdown-text">
                        {preview.manifest.description}
                      </span>
                    )}
                  </div>
                </div>

                {isConfigRequired && (
                  <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200">
                    <div className="flex items-start gap-2.5">
                      <Icon
                        icon={Icons.WARNING}
                        className="mt-0.5 shrink-0 text-base text-amber-400"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="font-semibold text-amber-300">
                          {t(
                            "addons.manager.configRequiredTitle",
                            "Configuration Required",
                          )}
                        </p>
                        <p className="leading-relaxed opacity-90">
                          {t(
                            "addons.manager.configRequiredDesc",
                            "This addon requires configuration (such as API keys or language settings) before it can return content. Please configure it in your browser, then copy and paste the generated manifest URL here.",
                          )}
                        </p>
                        <div className="flex flex-wrap items-center gap-2.5 pt-1">
                          <button
                            type="button"
                            onClick={() => void openExternalUrl(configureUrl)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/25 px-3 py-1.5 font-semibold text-xs text-amber-200 transition-all hover:bg-amber-500/40 hover:text-white active:scale-95"
                          >
                            <Icon icon={Icons.SETTINGS} className="text-sm" />
                            <span>
                              {t(
                                "addons.manager.openConfigurePage",
                                "Open Configuration Page",
                              )}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void add()}
                            disabled={isBusy}
                            className="text-xs text-amber-300/70 underline underline-offset-2 transition-colors hover:text-amber-200"
                          >
                            {t(
                              "addons.manager.addWithoutConfiguring",
                              "Install anyway (may not work)",
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {error ? (
              <p className="mt-2 text-sm font-medium text-red-400">{error}</p>
            ) : null}

            <div
              className={classNames(
                "mt-5 flex flex-wrap justify-end gap-2",
                !isAddonsPage && "sm:justify-between",
              )}
            >
              {!isAddonsPage && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate("/addons");
                  }}
                  className="flex items-center gap-2 rounded-xl bg-dropdown-contentBackground px-4 py-2.5 text-sm font-semibold text-white border border-dropdown-border transition-all duration-200 hover:border-type-link hover:bg-pill-backgroundHover"
                >
                  <Icon icon={Icons.EXTENSION} className="text-base" />
                  <span>
                    {t("addons.manager.manageListButton", "Manage addon list")}
                  </span>
                  <Icon icon={Icons.CHEVRON_RIGHT} className="text-sm" />
                </button>
              )}
            </div>
          </div>
        </div>
      </OverlayPortal>
    </>
  );
}
