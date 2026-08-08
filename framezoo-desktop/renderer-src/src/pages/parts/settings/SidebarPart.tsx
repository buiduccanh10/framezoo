import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Icons } from "@/components/Icon";
import { SidebarLink, SidebarSection } from "@/components/layout/Sidebar";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";
import { useIsMobile } from "@/hooks/useIsMobile";
import { conf } from "@/setup/config";
import { checkForAppUpdate, requestAppUpdate } from "@/setup/pwa";
import { useAppUpdateStore } from "@/stores/appUpdate";

export function SidebarPart(props: {
  selectedCategory: string | null;
  setSelectedCategory: (category: string | null) => void;
  onCategoryChange?: (category: string | null) => void;
  searchQuery: string;
  showConnections: boolean;
}) {
  const { t } = useTranslation();
  const { isMobile } = useIsMobile();
  const isDesktopApp = useIsDesktopApp();
  const [activeLink, setActiveLink] = useState("");
  const appVersion = conf().APP_VERSION;
  const appUpdateStatus = useAppUpdateStore((s) => s.status);
  const isCheckingForUpdate = useAppUpdateStore((s) => s.isUpdating);
  const desktopUpdateActionLabel =
    appUpdateStatus === "downloaded"
      ? t("navigation.banner.appUpdate.restart")
      : appUpdateStatus === "available"
        ? t("navigation.banner.appUpdate.download")
        : t("settings.sidebar.info.checkForUpdates");

  const settingLinks = useMemo(
    () => [
      {
        textKey: "settings.account.title",
        id: "settings-account",
        icon: Icons.USER,
      },
      {
        textKey: "settings.preferences.title",
        id: "settings-preferences",
        icon: Icons.SETTINGS,
      },
      {
        textKey: "settings.appearance.title",
        id: "settings-appearance",
        icon: Icons.BRUSH,
      },
      {
        textKey: "settings.subtitles.title",
        id: "settings-captions",
        icon: Icons.CAPTIONS,
      },
      {
        textKey: "settings.torrent.title",
        id: "settings-torrent",
        icon: Icons.DOWNLOAD,
      },
      ...(props.showConnections
        ? [
            {
              textKey: "settings.connections.title",
              id: "settings-connection",
              icon: Icons.LINK,
            },
          ]
        : []),
    ],
    [props.showConnections],
  );

  useEffect(() => {
    // Only track active link when searching (to show all sections)
    if (props.searchQuery.trim()) {
      let ticking = false;
      const recheck = () => {
        if (!ticking) {
          window.requestAnimationFrame(() => {
            const windowHeight =
              window.innerHeight || document.documentElement.clientHeight;
            const centerTarget = windowHeight / 4;

            const viewList = settingLinks
              .map((link) => {
                const el = document.getElementById(link.id);
                if (!el) return { distance: Infinity, link: link.id };
                const rect = el.getBoundingClientRect();
                const distanceTop = Math.abs(centerTarget - rect.top);
                const distanceBottom = Math.abs(centerTarget - rect.bottom);
                const distance = Math.min(distanceBottom, distanceTop);
                return { distance, link: link.id };
              })
              .sort((a, b) => a.distance - b.distance);

            // Check if user has scrolled past the bottom of the page
            if (
              window.innerHeight + window.scrollY >=
              document.body.offsetHeight
            ) {
              setActiveLink(settingLinks[settingLinks.length - 1].id);
            } else {
              // shortest distance to the part of the screen we want is the active link
              setActiveLink(viewList[0]?.link ?? "");
            }
            ticking = false;
          });
          ticking = true;
        }
      };
      window.addEventListener("scroll", recheck, { passive: true });
      recheck();

      return () => {
        window.removeEventListener("scroll", recheck);
      };
    }
    // When not searching, set active link to selected category
    setActiveLink(props.selectedCategory || "");
  }, [props.searchQuery, props.selectedCategory, settingLinks]);

  const selectCategory = useCallback(
    (id: string | null) => {
      // Set the selected category when clicking a sidebar link
      // null means "All Settings" - show all sections
      props.setSelectedCategory(id);
      props.onCategoryChange?.(id);
    },
    [props],
  );

  return (
    <div className="text-settings-sidebar-type-inactive sidebar-boundary">
      <div
        className={
          isMobile ? "" : "sticky top-32 self-start will-change-transform"
        }
        style={
          isMobile
            ? undefined
            : {
                // Use CSS transform for better performance
                transform: "translateZ(0)",
              }
        }
      >
        <SidebarSection title={t("global.pages.settings")}>
          <SidebarLink
            icon={Icons.GEAR}
            active={
              (!props.searchQuery.trim() && props.selectedCategory === null) ||
              (props.searchQuery.trim() ? activeLink === "" : false)
            }
            onClick={() => selectCategory(null)}
          >
            {t("settings.all.title")}
          </SidebarLink>
          {settingLinks.map((v) => (
            <SidebarLink
              icon={v.icon}
              active={
                v.id === activeLink ||
                (!props.searchQuery.trim() && v.id === props.selectedCategory)
              }
              onClick={() => selectCategory(v.id)}
              key={v.id}
            >
              {t(v.textKey)}
            </SidebarLink>
          ))}
        </SidebarSection>
        <div className="mt-6 rounded-lg border border-settings-card-border bg-settings-card-background bg-opacity-[0.15] px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-settings-sidebar-type-secondary">
            {t("settings.sidebar.info.appVersion")}
          </p>
          <p className="mt-1 break-all text-sm text-white">
            {appVersion ? `v${appVersion}` : "N/A"}
          </p>
          {isDesktopApp ? (
            <div className="mt-3">
              <Button
                theme="secondary"
                padding="px-3 py-2"
                className="w-full text-sm"
                loading={isCheckingForUpdate}
                onClick={() => {
                  if (
                    appUpdateStatus === "available" ||
                    appUpdateStatus === "downloaded"
                  ) {
                    void requestAppUpdate();
                    return;
                  }

                  void checkForAppUpdate().then((hasUpdate) => {
                    if (!hasUpdate) {
                      window.alert(t("settings.sidebar.info.upToDate"));
                    }
                  });
                }}
              >
                {desktopUpdateActionLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
