import { PlayerHoverState } from "@/stores/player/slices/interface";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

export function useShouldShowControls() {
  const hovering = usePlayerStore((s) => s.interface.hovering);
  const isPaused = usePlayerStore((s) => s.mediaPlaying.isPaused);
  const hasOpenOverlay = usePlayerStore((s) => s.interface.hasOpenOverlay);
  const isHoveringControls = usePlayerStore(
    (s) => s.interface.isHoveringControls,
  );

  const isHovering = hovering !== PlayerHoverState.NOT_HOVERING;
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const hasRenderedFrame = usePlayerStore((s) => s.mediaPlaying.hasRenderedFrame);
  const status = usePlayerStore((s) => s.status);

  // On player interface, controls must always show when:
  // 1. Cursor is hovering / moved recently (isHovering)
  // 2. Cursor is hovering any interactive control/button/bar (isHoveringControls)
  // 3. Any overlay/menu/settings is open (hasOpenOverlay)
  // 4. Video is paused (isPaused)
  // 5. Video is loading (isLoading)
  // 6. Video hasn't started rendering yet (!hasRenderedFrame)
  // NOTE: We only consider the unrendered frame state when the player is actually in the playing state.
  const isPendingStart = status === playerStatus.PLAYING && !hasRenderedFrame;

  const showTargets =
    isHovering || isHoveringControls || hasOpenOverlay || isPaused || isLoading || isPendingStart;

  return {
    showTouchTargets: showTargets,
    showTargets,
  };
}
