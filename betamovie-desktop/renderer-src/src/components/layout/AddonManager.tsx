import classNames from "classnames";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Icon, Icons } from "@/components/Icon";
import { installAddon } from "@/desktop/addons/store";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";

export function AddonManager() {
  const { t } = useTranslation();
  const isDesktop = useIsDesktopApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
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
                    "Add an addon manifest URL for torrent and direct streams.",
                  )}
                </p>
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

            {error ? (
              <p className="mt-2 text-sm font-medium text-red-400">{error}</p>
            ) : null}

            {/* Step Guide Section */}
            <div className="mt-6 rounded-xl border border-dropdown-border bg-dropdown-contentBackground/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-white flex items-center gap-2">
                <Icon icon={Icons.EXTENSION} className="text-type-link" />
                <span>{t("addons.guide.title", "Explore more addons:")}</span>
              </h3>
              <ol className="list-decimal space-y-2.5 pl-4 text-xs leading-relaxed text-dropdown-text">
                <li>
                  {t("addons.guide.step1Prefix", "Visit ")}
                  <a
                    href="https://stremio-addons.net"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-type-link hover:underline"
                  >
                    https://stremio-addons.net
                  </a>
                  {t(
                    "addons.guide.step1Suffix",
                    " or your trusted community addon catalog.",
                  )}
                </li>
                <li>
                  {t(
                    "addons.guide.step2Prefix",
                    "Copy the manifest link (e.g. ",
                  )}
                  <code className="rounded bg-dropdown-contentBackground px-1 py-0.5 text-white/90">
                    https://addon.example.com/manifest.json
                  </code>
                  {t("addons.guide.step2Suffix", ").")}
                </li>
                <li>
                  {t(
                    "addons.guide.step3Prefix",
                    "Paste into the box above, then press ",
                  )}
                  <span className="font-semibold text-white">
                    {t("addons.guide.step3AddName", "Add")}
                  </span>
                  {t("addons.guide.step3Suffix", ".")}
                </li>
              </ol>
            </div>

            {/* Navigation Button to Manage Addons Page */}
            <div className="mt-5 flex justify-end">
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
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
