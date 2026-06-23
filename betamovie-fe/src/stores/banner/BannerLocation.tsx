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
  dismissButtonClassName?: string;
  onDismiss?: () => void;
}) {
  const [ref] = useRegisterBanner<HTMLDivElement>(props.id);
  const hideBanner = useBannerStore((s) => s.hideBanner);
  const { t } = useTranslation();
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
          "relative flex items-start justify-center px-3 py-2 sm:items-center sm:px-4",
        ].join(" ")}
      >
        <div className="flex w-full justify-center">
          <div className="flex w-full max-w-screen-lg items-start gap-3 pr-8 sm:items-center sm:pr-10">
            <span className="mt-0.5 shrink-0 sm:mt-0">
              <Icon icon={icons[props.type]} />
            </span>
            <div className="min-w-0 flex-1">{props.children}</div>
          </div>
        </div>
        <button
          type="button"
          aria-label={t("overlays.close")}
          className={[
            "absolute right-1 top-1 flex h-10 w-10 items-center justify-center text-white/85 transition-colors hover:text-white",
            props.dismissButtonClassName ?? "",
          ].join(" ")}
          onClick={() => {
            if (props.onDismiss) {
              props.onDismiss();
              return;
            }

            hideBanner(props.id, props.persistDismiss !== false);
            if (props.persistDismiss !== false) {
              localStorage.setItem(`hideBanner-${props.id}`, "true");
            }
          }}
        >
          <Icon icon={Icons.X} />
        </button>
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
  const snoozeUpdate = useAppUpdateStore((s) => s.snoozeUpdate);
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

  const showOffline = !isOnline && !ignoredBannerIds.includes("offline");
  const showCustom = hasCustomBanner && !!customMessage;
  const showUpdate = !!hasUpdate;

  if (!showOffline && !showCustom && !showUpdate) return null;

  return (
    <div>
      {showOffline ? (
        <Banner id="offline" type="error">
          {t("navigation.banner.offline")}
        </Banner>
      ) : null}
      {showCustom ? (
        <Banner id={bannerId} type="info">
          {customMessage}
        </Banner>
      ) : null}
      {showUpdate ? (
        <Banner
          id="app-update-available"
          type="info"
          persistDismiss={false}
          dismissButtonClassName="hidden sm:flex"
          onDismiss={() => snoozeUpdate()}
        >
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span className="text-sm font-medium leading-5">
              {t("navigation.banner.appUpdate.available")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="min-h-11 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-0 sm:px-3 sm:py-1 sm:text-xs"
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
                  className="min-h-11 rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white sm:hidden"
                  onClick={() => snoozeUpdate()}
                >
                  {t("navigation.banner.appUpdate.later")}
                </button>
              ) : null}
            </div>
          </div>
        </Banner>
      ) : null}
    </div>
  );
}
