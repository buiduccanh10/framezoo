import classNames from "classnames";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Icon, Icons } from "@/components/Icon";
import { AddonManager } from "@/components/layout/AddonManager";
import { WideContainer } from "@/components/layout/WideContainer";
import { Heading1 } from "@/components/utils/Text";
import { AddonLogo } from "@/desktop/addons/AddonLogo";
import { getAddonGuideUrl, openAddonGuide } from "@/desktop/addons/guide";
import { getAddonResources } from "@/desktop/addons/manifest";
import {
  removeAddon,
  setAddonEnabled,
  useInstalledAddons,
} from "@/desktop/addons/store";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";

export function AddonsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addons = useInstalledAddons();

  return (
    <SubPageLayout>
      <WideContainer>
        <div className="flex items-center justify-between gap-8">
          <Heading1 className="text-4xl font-bold text-white">
            {t("addons.page.title", "Addons Manager")}
          </Heading1>
          <div className="flex flex-wrap justify-end gap-8">
            <a
              href={getAddonGuideUrl()}
              onClick={(event) => {
                event.preventDefault();
                void openAddonGuide();
              }}
              className="inline-flex items-center border-0 bg-transparent p-0 text-sm font-semibold text-type-link transition-colors hover:text-type-linkHover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-type-link/60"
            >
              {t("addons.page.createGuideLink", "Create addon guide")}
            </a>
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
        <div className="space-y-3 pb-16">
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
            addons.map((addon) => (
              <div
                key={addon.manifest.id}
                className="flex items-center gap-4 rounded-xl border border-dropdown-border bg-dropdown-contentBackground/60 p-4 transition-all duration-200 hover:border-dropdown-border/80 hover:bg-dropdown-contentBackground"
              >
                <AddonLogo
                  name={addon.manifest.name}
                  logo={addon.manifest.logo}
                  className="h-11 w-11 rounded-lg bg-black/20 p-1"
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
                    <p className="min-w-0 flex-1 truncate text-[11px] text-dropdown-text opacity-60 ml-1">
                      {addon.manifestUrl}
                    </p>
                  </div>
                  {/* Resource capability badges */}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {getAddonResources(addon).map((resource) => {
                      const badgeColors: Record<string, string> = {
                        stream: "bg-purple-500/20 text-purple-300",
                        catalog: "bg-blue-500/20 text-blue-300",
                        meta: "bg-yellow-500/20 text-yellow-300",
                        subtitles: "bg-green-500/20 text-green-300",
                      };
                      const color =
                        badgeColors[resource] ??
                        "bg-dropdown-altBackground text-dropdown-text";
                      return (
                        <span
                          key={resource}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${color}`}
                        >
                          {resource}
                        </span>
                      );
                    })}
                  </div>
                  {addon.manifest.description ? (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-dropdown-text opacity-90">
                      {addon.manifest.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {addon.manifest.behaviorHints?.configurable ? (
                    <button
                      type="button"
                      className="rounded-lg p-2 text-dropdown-text transition-colors hover:bg-green-500/20 hover:text-green-400"
                      onClick={() =>
                        window.open(
                          `${addon.baseUrl.replace(/\/+$/, "")}/configure`,
                          "_blank",
                        )
                      }
                      title={t(
                        "addons.page.configureAddon",
                        "Configure this addon",
                      )}
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
