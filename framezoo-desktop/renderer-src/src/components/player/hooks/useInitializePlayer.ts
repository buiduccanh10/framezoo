import { useCallback, useEffect, useMemo, useRef } from "react";

import { useLanguageStore } from "@/stores/language";
import { getMediaKey } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { useVolumeStore } from "@/stores/volume";

import { useCaptions } from "./useCaptions";

export function useInitializePlayer() {
  const display = usePlayerStore((s) => s.display);
  const volume = useVolumeStore((s) => s.volume);

  const init = useCallback(() => {
    display?.setVolume(volume);
  }, [display, volume]);

  return {
    init,
  };
}

export function useInitializeSource() {
  const meta = usePlayerStore((s) => s.meta);
  const mediaKey = useMemo(() => getMediaKey(meta), [meta]);
  const source = usePlayerStore((s) => s.source);
  const sourceId = usePlayerStore((s) => s.sourceId);
  const addExternalSubtitles = usePlayerStore((s) => s.addExternalSubtitles);
  const appLanguage = useLanguageStore((s) => s.language);
  const sourceIdentifier = useMemo(
    () => (source ? JSON.stringify(source) : null),
    [source],
  );
  const { selectLastUsedLanguageIfEnabled } = useCaptions();

  const previousMediaKeyRef = useRef<string | null>(null);
  const previousAppLanguageRef = useRef(appLanguage);

  useEffect(() => {
    if (
      sourceIdentifier &&
      sourceId &&
      previousMediaKeyRef.current !== mediaKey
    ) {
      previousMediaKeyRef.current = mediaKey;
      void selectLastUsedLanguageIfEnabled();
    }
  }, [sourceIdentifier, sourceId, mediaKey, selectLastUsedLanguageIfEnabled]);

  useEffect(() => {
    if (previousAppLanguageRef.current === appLanguage) return;
    previousAppLanguageRef.current = appLanguage;

    if (!sourceIdentifier || !sourceId) return;
    void addExternalSubtitles(undefined, { forceRefresh: true });
  }, [addExternalSubtitles, appLanguage, sourceIdentifier, sourceId]);
}
