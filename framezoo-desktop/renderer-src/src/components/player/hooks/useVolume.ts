import { usePlayerStore } from "@/stores/player/store";
import { useVolumeStore } from "@/stores/volume";

let persistTimeout: ReturnType<typeof setTimeout> | undefined;

function debouncedSetStoredVolume(vol: number) {
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    useVolumeStore.getState().setVolume(vol);
  }, 250);
}

export function useVolume() {
  const volume = usePlayerStore((s) => s.mediaPlaying.volume);
  const lastVolume = usePlayerStore((s) => s.interface.lastVolume);
  const setLastVolume = usePlayerStore((s) => s.setLastVolume);
  const display = usePlayerStore((s) => s.display);
  const setStoredVolume = useVolumeStore((s) => s.setVolume);

  const toggleVolume = () => {
    let newVolume = 0;

    if (volume > 0) {
      newVolume = 0;
      setLastVolume(volume);
    } else if (lastVolume > 0) newVolume = lastVolume;
    else newVolume = 1;

    display?.setVolume(newVolume);
    setStoredVolume(newVolume);
  };

  return {
    toggleMute() {
      toggleVolume();
    },
    setVolume(vol: number) {
      display?.setVolume(vol);
      setLastVolume(vol);
      debouncedSetStoredVolume(vol);
    },
  };
}
