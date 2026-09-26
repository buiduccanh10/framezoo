import { Link } from "react-router-dom";

import { BrandPill } from "@/components/layout/BrandPill";
import { WindowControls } from "@/components/layout/WindowControls";
import { useIsMacWindowed } from "@/hooks/useIsDesktopApp";
import { BlurEllipsis } from "@/pages/layouts/SubPageLayout";

export function MinimalPageLayout(props: { children: React.ReactNode }) {
  const isMacWindowed = useIsMacWindowed();

  return (
    <div
      className="bg-background-main min-h-screen relative"
      style={{
        backgroundImage:
          "linear-gradient(to bottom, var(--tw-gradient-from), var(--tw-gradient-to) 800px)",
      }}
    >
      <BlurEllipsis />
      {/* Top Header */}
      <div
        className="fixed top-0 left-0 right-0 h-16 z-20 flex items-center justify-between pointer-events-auto"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className={`py-5 ${isMacWindowed ? "pl-[88px] pr-7" : "px-7"}`}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Link
            className="block tabbable rounded-full text-xs ssm:text-base"
            to="/"
          >
            <BrandPill clickable />
          </Link>
        </div>
        <div
          className="px-7 py-5 pointer-events-auto"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <WindowControls />
        </div>
      </div>
      <div className="min-h-screen relative z-10">{props.children}</div>
    </div>
  );
}
