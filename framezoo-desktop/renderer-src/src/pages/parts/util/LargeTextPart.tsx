import { BrandPill } from "@/components/layout/BrandPill";
import { WindowControls } from "@/components/layout/WindowControls";
import { useIsMacWindowed } from "@/hooks/useIsDesktopApp";
import { BlurEllipsis } from "@/pages/layouts/SubPageLayout";

export function LargeTextPart(props: {
  iconSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isMacWindowed = useIsMacWindowed();

  return (
    <div
      className="flex flex-col justify-center items-center h-screen text-center font-medium relative select-none"
      data-app-region="drag"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Overlayed elements */}
      <BlurEllipsis />

      {/* Top Header / Window Drag Region */}
      <div
        className="fixed top-0 left-0 right-0 z-20 flex items-center pointer-events-auto"
        data-app-region="drag"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="px-1 py-5 sm:px-4 md:px-6 lg:px-7 relative z-[60] flex flex-1 items-center justify-between">
          <div className="pointer-events-auto flex items-center min-h-[40px] gap-1 sm:gap-2 md:gap-3">
            {isMacWindowed && (
              <div
                className="w-[72px] shrink-0 pointer-events-none"
                aria-hidden="true"
              />
            )}
            <div
              className="block shrink-0 tabbable rounded-full text-xs ssm:text-base"
              data-app-region="no-drag"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <BrandPill header />
            </div>
          </div>
          <div
            className="relative pointer-events-auto ml-auto flex items-center"
            data-app-region="no-drag"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <WindowControls />
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        className="relative z-10 flex flex-col items-center pointer-events-auto"
        data-app-region="no-drag"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {props.iconSlot ? props.iconSlot : null}
        <div className="max-w-[19rem] mt-3 mb-12 text-type-secondary">
          {props.children}
        </div>
      </div>
    </div>
  );
}

