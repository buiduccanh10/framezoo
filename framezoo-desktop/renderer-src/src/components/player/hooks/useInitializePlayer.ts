import { useCallback, useEffect, useMemo, useRef } from "react";

import { useLanguageStore } from "@/stores/language";
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
  const source = usePlayerStore((s) => s.source);
  const sourceId = usePlayerStore((s) => s.sourceId);
  const addExternalSubtitles = usePlayerStore((s) => s.addExternalSubtitles);
  const appLanguage = useLanguageStore((s) => s.language);
  const sourceIdentifier = useMemo(
    () => (source ? JSON.stringify(source) : null),
    [source],
  );
  const { selectLastUsedLanguageIfEnabled } = useCaptions();

  // Only select subtitles on initial load, not when source changes
  const hasInitializedRef = useRef(false);
  const previousAppLanguageRef = useRef(appLanguage);

  useEffect(() => {
    if (sourceIdentifier && sourceId && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      selectLastUsedLanguageIfEnabled();
    }
  }, [sourceIdentifier, sourceId, selectLastUsedLanguageIfEnabled]);

  useEffect(() => {
    if (previousAppLanguageRef.current === appLanguage) return;
    previousAppLanguageRef.current = appLanguage;

    if (!sourceIdentifier || !sourceId) return;
    void addExternalSubtitles();
  }, [addExternalSubtitles, appLanguage, sourceIdentifier, sourceId]);
}
