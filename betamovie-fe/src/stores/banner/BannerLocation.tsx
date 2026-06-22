import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { conf } from "@/setup/config";
import { requestAppUpdate } from "@/setup/pwa";
import { useAppUpdateStore } from "@/stores/appUpdate";
import { useBannerStore, useRegisterBanner } from "@/stores/banner";

export function Banner(props: {
  children: React.ReactNode;
  type: "error" | "info";
  id: string;
  persistDismiss?: boolean;
}) {
  const [ref] = useRegisterBanner<HTMLDivElement>(props.id);
  const hideBanner = useBannerStore((s) => s.hideBanner);
  const styles = {
    error: "bg-[#C93957] text-white",
    info: "bg-[#126FD3] text-white",
  };
  const icons = {
    error: Icons.CIRCLE_EXCLAMATION,
    info: Icons.CIRCLE_EXCLAMATION,
  };

  useEffect(() => {
    if (props.persistDismiss === false) return;
    const hideBannerFlag = localStorage.getItem(`hideBanner-${props.id}`);
    if (hideBannerFlag) {
      hideBanner(props.id, true);
    }
  }, [hideBanner, props.id, props.persistDismiss]);

  return (
    <div ref={ref}>
      <div
        className={[
          styles[props.type],
          "flex items-center justify-center p-1",
        ].join(" ")}
      >
        <div className="flex items-center space-x-3">
          <Icon icon={icons[props.type]} />
          <div>{props.children}</div>
        </div>
        <span
          className="absolute right-4 hover:cursor-pointer"
          onClick={() => {
            hideBanner(props.id, props.persistDismiss !== false);
            if (props.persistDismiss !== false) {
              localStorage.setItem(`hideBanner-${props.id}`, "true");
            }
          }}
        >
          <Icon icon={Icons.X} />
        </span>
      </div>
    </div>
  );
}

export function BannerLocation(props: { location?: string }) {
  const { t } = useTranslation();
  const isOnline = useBannerStore((s) => s.isOnline);
  const setLocation = useBannerStore((s) => s.setLocation);
  const ignoredBannerIds = useBannerStore((s) => s.ignoredBannerIds);
  const currentLocation = useBannerStore((s) => s.location);
  const banners = useBannerStore((s) => s.banners);
  const showBanner = useBannerStore((s) => s.showBanner);
  const hasUpdate = useAppUpdateStore((s) => s.hasUpdate);
  const isUpdatingApp = useAppUpdateStore((s) => s.isUpdating);
  const clearUpdate = useAppUpdateStore((s) => s.clearUpdate);
  const loc = props.location ?? null;

  useEffect(() => {
    if (!loc) return;
    setLocation(loc);
    return () => {
      setLocation(null);
    };
  }, [setLocation, loc]);

  useEffect(() => {
    const config = conf();
    const customMessage = config.BANNER_MESSAGE;
    const bannerId = config.BANNER_ID || "custom-message";
    const shouldShow = customMessage && loc === null;

    if (shouldShow) {
      showBanner(bannerId);
    }
  }, [loc, showBanner]);

  if (currentLocation !== loc) return null;

  const config = conf();
  const customMessage = config.BANNER_MESSAGE;
  const bannerId = config.BANNER_ID || "custom-message";
  const hasCustomBanner = banners.some((b) => b.id === bannerId);

  return (
    <div>
      {!isOnline && !ignoredBannerIds.includes("offline") ? (
        <Banner id="offline" type="error">
          {t("navigation.banner.offline")}
        </Banner>
      ) : null}
      {hasCustomBanner && customMessage ? (
        <Banner id={bannerId} type="info">
          {customMessage}
        </Banner>
      ) : null}
      {hasUpdate ? (
        <Banner id="app-update-available" type="info" persistDismiss={false}>
          <div className="flex flex-wrap items-center gap-3 pr-8">
            <span>{t("navigation.banner.appUpdate.available")}</span>
            <button
              type="button"
              className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-70"
              onClick={() => {
                void requestAppUpdate();
              }}
              disabled={isUpdatingApp}
            >
              {isUpdatingApp
                ? t("navigation.banner.appUpdate.updating")
                : t("navigation.banner.appUpdate.action")}
            </button>
            {!isUpdatingApp ? (
              <button
                type="button"
                className="text-xs font-medium text-white/80 transition-colors hover:text-white"
                onClick={() => clearUpdate()}
              >
                {t("overlays.close")}
              </button>
            ) : null}
          </div>
        </Banner>
      ) : null}
    </div>
  );
}
