import classNames from "classnames";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Icon, Icons } from "@/components/Icon";
import { SectionHeading } from "@/components/layout/SectionHeading";
import { WideContainer } from "@/components/layout/WideContainer";
import { Heading1 } from "@/components/utils/Text";
import {
  installAddon,
  removeAddon,
  setAddonEnabled,
  useInstalledAddons,
} from "@/desktop/addons/store";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";

export function AddonsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addons = useInstalledAddons();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    setLoading(true);
    setError(null);
    try {
      await installAddon(url);
      setUrl("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("addons.page.installError", "Unable to install this addon."),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SubPageLayout>
      <WideContainer>
        <div className="flex items-center justify-between gap-8">
          <Heading1 className="text-2xl font-bold text-white">
            {t("addons.page.title", "Addons Manager")}
          </Heading1>
        </div>

        <div className="flex items-center gap-4 pb-8">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center text-white transition-colors hover:text-gray-300"
          >
            <Icon icon={Icons.ARROW_LEFT} className="text-xl" />
            <span className="ml-2">
              {t("discover.page.back", "Back to home")}
            </span>
          </button>
        </div>

        {/* Step Guide Section */}
        <SectionHeading
          title={t("addons.page.guideHeading", "Discover & Install Addons")}
          icon={Icons.EXTENSION}
        />
        <div className="mb-8 rounded-2xl border border-dropdown-border bg-dropdown-contentBackground/40 p-6 shadow-xl backdrop-blur-md">
          <p className="mb-4 text-sm leading-relaxed text-dropdown-text">
            {t(
              "addons.page.guideIntro",
              "Addons help you browse media catalogs and streams tailored to your personal entertainment preferences:",
            )}
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-dropdown-border bg-dropdown-altBackground/60 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-white">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-buttons-purple font-bold text-xs text-white">
                  1
                </span>
                <span>
                  {t("addons.page.step1Title", "Explore Addon Catalog")}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-dropdown-text">
                {t(
                  "addons.page.step1DescPrefix",
                  "Visit the community catalog at ",
                )}
                <a
                  href="https://stremio-addons.net"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-type-link hover:underline"
                >
                  https://stremio-addons.net
                </a>
                {t(
                  "addons.page.step1DescSuffix",
                  " or similar standard addon providers.",
                )}
              </p>
            </div>

            <div className="rounded-xl border border-dropdown-border bg-dropdown-altBackground/60 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-white">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-buttons-purple font-bold text-xs text-white">
                  2
                </span>
                <span>{t("addons.page.step2Title", "Copy Manifest Link")}</span>
              </div>
              <p className="text-xs leading-relaxed text-dropdown-text">
                {t(
                  "addons.page.step2DescPrefix",
                  "Select your desired addon, customize options, and copy its manifest URL (standard example: ",
                )}
                <code className="rounded bg-dropdown-contentBackground px-1 py-0.5 text-white/90">
                  https://addon.example.com/manifest.json
                </code>
                {t("addons.page.step2DescSuffix", ").")}
              </p>
            </div>

            <div className="rounded-xl border border-dropdown-border bg-dropdown-altBackground/60 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-white">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-buttons-purple font-bold text-xs text-white">
                  3
                </span>
                <span>{t("addons.page.step3Title", "Add to Application")}</span>
              </div>
              <p className="text-xs leading-relaxed text-dropdown-text">
                {t(
                  "addons.page.step3DescPrefix",
                  "Paste the manifest path into the field below and press ",
                )}
                <span className="font-semibold text-white">
                  {t("addons.page.step3AddName", "Add")}
                </span>
                {t(
                  "addons.page.step3DescSuffix",
                  ". The addon will immediately activate to search for media sources.",
                )}
              </p>
            </div>
          </div>

          {/* Addon Input Form */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && url.trim()) void handleAdd();
              }}
              placeholder="https://addon.example.com/manifest.json"
              className="min-w-0 flex-1 rounded-xl border border-dropdown-border bg-dropdown-contentBackground px-4 py-3 text-sm text-white placeholder-dropdown-text/60 outline-none transition-colors focus:border-type-link"
              disabled={loading}
            />
            <button
              type="button"
              className={classNames(
                "flex w-full items-center justify-center gap-2 rounded-xl bg-buttons-purple px-6 py-3 font-semibold text-sm text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-buttons-purpleHover active:scale-95 sm:w-auto",
                (!url.trim() || loading) &&
                  "!cursor-not-allowed !scale-100 opacity-60 hover:bg-buttons-purple",
              )}
              onClick={() => void handleAdd()}
              disabled={!url.trim() || loading}
            >
              <Icon icon={Icons.PLUS} className="text-base" />
              <span>
                {loading
                  ? t("addons.page.processing", "Processing...")
                  : t("addons.page.addAddonButton", "Add Addon")}
              </span>
            </button>
          </div>
          {error ? (
            <p className="mt-2 font-medium text-red-400 text-sm">{error}</p>
          ) : null}
        </div>

        {/* Installed Addons List */}
        <SectionHeading
          title={t("addons.page.installedHeading", "Installed Addons")}
          icon={Icons.EXTENSION}
        />
        <div className="space-y-3 pb-16">
          {addons.length === 0 ? (
            <div className="rounded-2xl border border-dropdown-border border-dashed bg-dropdown-contentBackground/20 p-8 text-center text-dropdown-text">
              <Icon
                icon={Icons.EXTENSION}
                className="mx-auto mb-3 text-3xl opacity-50"
              />
              <p className="font-medium text-sm">
                {t(
                  "addons.page.emptyInstalled",
                  "No addons installed in the system yet.",
                )}
              </p>
            </div>
          ) : (
            addons.map((addon) => (
              <div
                key={addon.manifest.id}
                className="flex items-center gap-4 rounded-xl border border-dropdown-border bg-dropdown-contentBackground/60 p-4 transition-all duration-200 hover:border-dropdown-border/80 hover:bg-dropdown-contentBackground"
              >
                {addon.manifest.logo ? (
                  <img
                    src={addon.manifest.logo}
                    alt={addon.manifest.name}
                    className="h-11 w-11 rounded-lg bg-black/20 p-1 object-contain"
                  />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-pill-background text-white text-xl">
                    <Icon icon={Icons.EXTENSION} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-base text-white">
                      {addon.manifest.name}
                    </p>
                    {addon.manifest.version ? (
                      <span className="rounded bg-dropdown-altBackground px-2 py-0.5 text-dropdown-text text-xs">
                        v{addon.manifest.version}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-dropdown-text text-xs">
                    {addon.manifestUrl}
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
                  <button
                    type="button"
                    className="rounded-lg p-2 text-dropdown-text transition-colors hover:bg-red-500/20 hover:text-red-400"
                    onClick={() => removeAddon(addon.manifest.id)}
                    aria-label={t(
                      "addons.page.removeAddon",
                      "Remove this addon",
                    )}
                    title={t("addons.page.removeAddon", "Remove this addon")}
                  >
                    <Icon icon={Icons.X} className="text-base" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </WideContainer>
    </SubPageLayout>
  );
}
