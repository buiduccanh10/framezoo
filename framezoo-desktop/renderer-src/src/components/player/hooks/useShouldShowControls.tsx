import { PlayerHoverState } from "@/stores/player/slices/interface";
import { usePlayerStore } from "@/stores/player/store";

export function useShouldShowControls() {
  const hovering = usePlayerStore((s) => s.interface.hovering);
  const isPaused = usePlayerStore((s) => s.mediaPlaying.isPaused);
  const hasOpenOverlay = usePlayerStore((s) => s.interface.hasOpenOverlay);
  const isHoveringControls = usePlayerStore(
    (s) => s.interface.isHoveringControls,
  );

  const isHovering = hovering !== PlayerHoverState.NOT_HOVERING;

  // On player interface, controls must always show when:
  // 1. Cursor is hovering / moved recently (isHovering)
  // 2. Cursor is hovering any interactive control/button/bar (isHoveringControls)
  // 3. Any overlay/menu/settings is open (hasOpenOverlay)
  // 4. Video is paused (isPaused)
  const showTargets =
    isHovering || isHoveringControls || hasOpenOverlay || isPaused;

  return {
    showTouchTargets: showTargets,
    showTargets,
  };
}
