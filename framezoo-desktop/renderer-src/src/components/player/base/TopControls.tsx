import { useEffect } from "react";

import { Transition } from "@/components/utils/Transition";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";

export function TopControls(props: {
  show?: boolean;
  children: React.ReactNode;
}) {
  const setHoveringAnyControls = usePlayerStore(
    (s) => s.setHoveringAnyControls,
  );
  const backgroundBlurEnabled = useSubtitleStore(
    (s) => s.styling.backgroundBlurEnabled,
  );

  useEffect(() => {
    return () => {
      setHoveringAnyControls(false);
    };
  }, [setHoveringAnyControls]);

  return (
    <div className="w-full text-white">
      {backgroundBlurEnabled && (
        <Transition
          animation="fade"
          show={props.show}
          className="pointer-events-none flex justify-end pb-32 bg-gradient-to-b from-black to-transparent [margin-bottom:env(safe-area-inset-bottom)] transition-opacity duration-200 absolute top-0 w-full"
        />
      )}
      <div
        onMouseOver={() => setHoveringAnyControls(true)}
        onMouseOut={() => setHoveringAnyControls(false)}
        className="pointer-events-none absolute top-0 left-0 right-0 z-[500]"
      >
        {/* Top window drag strip in the empty space above controls (y: 0 -> 20px) */}
        <div
          className="absolute top-0 left-0 right-0 h-5 pointer-events-auto"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        <Transition animation="fade" show={props.show} className="text-white">
          <div
            className="absolute top-5 left-0 right-0 flex items-center pointer-events-auto"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <div className="px-1 pb-5 sm:px-4 md:px-6 lg:px-7 relative z-[60] flex flex-1 items-center">
              {props.children}
            </div>
          </div>
        </Transition>
      </div>
    </div>
  );
}
