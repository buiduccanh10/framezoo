import { useInitializePlayer } from "@/components/player/hooks/useInitializePlayer";
import {
  CaptionListItem,
  PlayerMeta,
  PlayerStatus,
  playerStatus,
} from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { SourceSliceSource } from "@/stores/player/utils/qualities";
import { useProgressStore } from "@/stores/progress";
import { getSavedProgressTime } from "@/stores/progress/selectors";

export interface Source {
  url: string;
  type: "hls" | "mp4";
}

export function usePlayer() {
  const setStatus = usePlayerStore((s) => s.setStatus);
  const setMeta = usePlayerStore((s) => s.setMeta);
  const setSource = usePlayerStore((s) => s.setSource);
  const setCaption = usePlayerStore((s) => s.setCaption);
  const setSourceId = usePlayerStore((s) => s.setSourceId);
  const status = usePlayerStore((s) => s.status);
  const setEmbedId = usePlayerStore((s) => (s as any).setEmbedId);
  const shouldStartFromBeginning = usePlayerStore(
    (s) => s.interface.shouldStartFromBeginning,
  );
  const setShouldStartFromBeginning = usePlayerStore(
    (s) => s.setShouldStartFromBeginning,
  );
  const reset = usePlayerStore((s) => s.reset);
  const meta = usePlayerStore((s) => s.meta);
  const { init } = useInitializePlayer();
  const progressStore = useProgressStore();

  return {
    meta,
    reset,
    status,
    shouldStartFromBeginning,
    setShouldStartFromBeginning,
    setStatus,
    setMeta(m: PlayerMeta, newStatus?: PlayerStatus) {
      setMeta(m, newStatus);
    },
    playMedia(
      source: SourceSliceSource,
      captions: CaptionListItem[],
      sourceId: string | null,
      startAtOverride?: number,
    ) {
      const start =
        startAtOverride ?? getSavedProgressTime(progressStore.items, meta);
      setCaption(null);
      setEmbedId(null);
      setSource(source, captions, start);
      setSourceId(sourceId);
      setStatus(playerStatus.PLAYING);
      init();
    },
    setScrapeStatus() {
      setStatus(playerStatus.SCRAPING);
    },
    setScrapeNotFound() {
      setStatus(playerStatus.SCRAPE_NOT_FOUND);
    },
  };
}
