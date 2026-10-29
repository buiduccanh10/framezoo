import { useCallback, useEffect, useMemo, useRef } from "react";

import { subscribeInstalledAddons } from "@/desktop/addons/storage";
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

  const previousSubtitleMediaKeyRef = useRef<string | null>(null);
  const previousLanguageMediaKeyRef = useRef<string | null>(null);
  const previousAppLanguageRef = useRef(appLanguage);

  // Decoupled external subtitle fetching:
  // As soon as mediaKey is available (entering player or changing episode),
  // fetch external subtitles immediately without waiting for stream selection or loading.
  useEffect(() => {
    if (!mediaKey) return;
    if (previousSubtitleMediaKeyRef.current === mediaKey) return;
    previousSubtitleMediaKeyRef.current = mediaKey;

    void addExternalSubtitles(undefined);
  }, [addExternalSubtitles, mediaKey]);

  useEffect(() => {
    if (
      sourceIdentifier &&
      sourceId &&
      previousLanguageMediaKeyRef.current !== mediaKey
    ) {
      previousLanguageMediaKeyRef.current = mediaKey;
      void selectLastUsedLanguageIfEnabled();
    }
  }, [sourceIdentifier, sourceId, mediaKey, selectLastUsedLanguageIfEnabled]);

  useEffect(() => {
    if (previousAppLanguageRef.current === appLanguage) return;
    previousAppLanguageRef.current = appLanguage;

    if (!mediaKey) return;
    void addExternalSubtitles(undefined, { forceRefresh: true });
  }, [addExternalSubtitles, appLanguage, mediaKey]);

  useEffect(() => {
    const unsubscribe = subscribeInstalledAddons(() => {
      if (!mediaKey) return;
      void addExternalSubtitles(undefined, { forceRefresh: true });
    });
    return () => {
      unsubscribe();
    };
  }, [addExternalSubtitles, mediaKey]);
}
