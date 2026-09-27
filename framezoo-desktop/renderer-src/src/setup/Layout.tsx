import { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { useBannerSize, useBannerStore } from "@/stores/banner";
import { BannerLocation } from "@/stores/banner/BannerLocation";

export function Layout(props: { children: ReactNode }) {
  const routerLocation = useLocation();
  const isPlayerRoute = routerLocation.pathname.startsWith("/media/");
  const bannerSize = useBannerSize();
  const location = useBannerStore((s) => s.location);

  const shouldShowBanner = !isPlayerRoute && location === null;

  return (
    <div>
      {shouldShowBanner ? (
        <div className="fixed inset-x-0 bottom-0 z-[1000]">
          <BannerLocation />
        </div>
      ) : null}
      <div
        style={{
          paddingBottom: shouldShowBanner ? `${bannerSize}px` : "0px",
        }}
        className="flex min-h-screen flex-col"
      >
        {props.children}
      </div>
    </div>
  );
}
