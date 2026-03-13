import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { LazyImage } from "@/components/utils/Image";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

function getRandomMessage(messages: string[], prev?: string) {
  if (messages.length <= 1) return messages[0] ?? "";
  let next = prev ?? "";
  while (next === prev) {
    next = messages[Math.floor(Math.random() * messages.length)];
  }
  return next;
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

export function PlayerLoadingOverlay() {
  const { t } = useTranslation();
  const status = usePlayerStore((s) => s.status);
  const meta = usePlayerStore((s) => s.meta);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const isPlaying = usePlayerStore((s) => s.mediaPlaying.isPlaying);
  const hasPlayedOnce = usePlayerStore((s) => s.mediaPlaying.hasPlayedOnce);
  const manualSourceSelection = usePreferencesStore(
    (s) => s.manualSourceSelection,
  );

  const showOverlay =
    status === playerStatus.IDLE ||
    (status === playerStatus.SCRAPING && !manualSourceSelection) ||
    (status === playerStatus.PLAYING &&
      isLoading &&
      (!hasPlayedOnce || !isPlaying));

  const loadingMessages = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) =>
        t(`player.loadingOverlayMessages.${i + 1}`),
      ).filter(Boolean),
    [t],
  );
  const backgroundImage = meta?.backdrop ?? meta?.poster;

  const [shouldRender, setShouldRender] = useState(showOverlay);
  const [isVisible, setIsVisible] = useState(showOverlay);
  const [hideLogo, setHideLogo] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(() =>
    getRandomMessage(loadingMessages),
  );
  const [messageVisible, setMessageVisible] = useState(true);

  useEffect(() => {
    setHideLogo(false);
  }, [meta?.logo]);

  useEffect(() => {
    let cancelled = false;

    if (!showOverlay) {
      setAssetsReady(false);
      return () => {
        cancelled = true;
      };
    }

    const sources = [backgroundImage, meta?.logo].filter(Boolean) as string[];
    if (sources.length === 0) {
      setAssetsReady(true);
      return () => {
        cancelled = true;
      };
    }

    Promise.all(sources.map(preloadImage)).then(() => {
      if (!cancelled) setAssetsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [showOverlay, backgroundImage, meta?.logo]);

  const showOverlayWhenReady = showOverlay && assetsReady;

  useEffect(() => {
    setLoadingMessage((prev) => getRandomMessage(loadingMessages, prev));
  }, [loadingMessages]);

  useEffect(() => {
    if (showOverlayWhenReady) {
      setLoadingMessage((prev) => getRandomMessage(loadingMessages, prev));
      setMessageVisible(true);
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsVisible(false);
    const timeout = window.setTimeout(() => {
      setShouldRender(false);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [showOverlayWhenReady, loadingMessages]);

  useEffect(() => {
    if (!showOverlayWhenReady) return;

    const interval = window.setInterval(() => {
      setMessageVisible(false);
      window.setTimeout(() => {
        setLoadingMessage((prev) => getRandomMessage(loadingMessages, prev));
        setMessageVisible(true);
      }, 260);
    }, 2600);

    return () => window.clearInterval(interval);
  }, [showOverlayWhenReady, loadingMessages]);

  if (!shouldRender) return null;

  const showLogo = Boolean(meta?.logo && !hideLogo);
  const displayTitle = meta?.title || "Loading media";

  return (
    <div
      className={`absolute inset-0 z-0 pointer-events-none overflow-hidden transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      {backgroundImage ? (
        <LazyImage
          src={backgroundImage}
          alt={displayTitle}
          className="absolute inset-0 w-full h-full object-cover"
          showSkeleton={false}
          loading="eager"
          decoding="sync"
        />
      ) : (
        <div className="absolute inset-0 bg-background-main" />
      )}

      <div className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/45 to-black/45" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
        {showLogo ? (
          <div className="w-full max-w-[16rem] md:max-w-[20rem] lg:max-w-[30rem] max-h-[12rem] animate-pulse">
            <LazyImage
              src={meta?.logo}
              alt={displayTitle}
              className="w-full h-full object-contain drop-shadow-lg bg-transparent"
              loading="eager"
              decoding="sync"
              onError={() => setHideLogo(true)}
            />
          </div>
        ) : null}
        <p
          className={`text-[16px] text-white/60 font-medium transition-all duration-300 ${
            messageVisible
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-2"
          }`}
        >
          {loadingMessage}
        </p>
      </div>
    </div>
  );
}
