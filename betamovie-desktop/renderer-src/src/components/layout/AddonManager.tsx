import classNames from "classnames";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { AddonPlatformBadges } from "@/components/addons/AddonPlatformBadges";
import { Icon, Icons } from "@/components/Icon";
import { AddonLogo } from "@/desktop/addons/AddonLogo";
import { loadAddonManifest } from "@/desktop/addons/client";
import { getAddonGuideUrl, openAddonGuide } from "@/desktop/addons/guide";
import { installAddon } from "@/desktop/addons/store";
import type { StremioManifest } from "@/desktop/addons/types";
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
  const [preview, setPreview] = useState<StremioManifest | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!url.trim()) {
      setPreview(null);
      return;
    }
    const timeout = setTimeout(() => {
      setPreviewLoading(true);
      setPreview(null);
      loadAddonManifest(url)
        .then((addon) => setPreview(addon.manifest))
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false));
    }, 500);
    return () => clearTimeout(timeout);
  }, [url]);

  if (!isDesktop) return null;

  const add = async () => {
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

  const isAddonsPage = location.pathname === "/addons";

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
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pill-background bg-opacity-50 transition-colors hover:bg-pill-backgroundHover">
            <Icon icon={Icons.EXTENSION} />
          </span>
        </button>
      )}

      {open ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-dropdown-border bg-dropdown-altBackground p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
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
                  if (event.key === "Enter" && url.trim()) void add();
                }}
                placeholder="https://addon.example.com/manifest.json"
                className="min-w-0 flex-1 rounded-xl border border-dropdown-border bg-dropdown-contentBackground px-3.5 py-2.5 text-sm text-white placeholder-dropdown-text/60 outline-none transition-colors focus:border-type-link"
                disabled={loading}
              />
              <button
                type="button"
                className={classNames(
                  "rounded-xl bg-buttons-purple px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-buttons-purpleHover hover:scale-105 active:scale-95",
                  (!url.trim() || loading) &&
                    "!cursor-not-allowed !scale-100 opacity-60 hover:bg-buttons-purple",
                )}
                onClick={() => void add()}
                disabled={!url.trim() || loading}
              >
                {loading
                  ? t("addons.manager.adding", "Adding...")
                  : t("addons.manager.add", "Add")}
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
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-dropdown-border bg-dropdown-contentBackground p-3">
                <AddonLogo
                  name={preview.name}
                  logo={preview.logo}
                  className="h-10 w-10 rounded bg-dropdown-border"
                />
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate font-semibold text-white">
                    {preview.name}{" "}
                    <span className="text-xs font-normal text-dropdown-text">
                      v{preview.version}
                    </span>
                  </span>
                  {preview.description && (
                    <span className="truncate text-xs text-dropdown-text">
                      {preview.description}
                    </span>
                  )}
                </div>
              </div>
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
              <a
                href={getAddonGuideUrl()}
                onClick={(event) => {
                  event.preventDefault();
                  void openAddonGuide();
                }}
                className="inline-flex items-center border-0 bg-transparent p-0 text-sm font-semibold text-type-link transition-colors hover:text-type-linkHover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-type-link/60"
              >
                {t("addons.manager.createGuideLink", "How to create an addon")}
              </a>
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
      ) : null}
    </>
  );
}
