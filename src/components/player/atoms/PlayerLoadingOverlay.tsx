import { useEffect, useState } from "react";

import { LazyImage } from "@/components/utils/Image";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

const loadingMessages = [
  "Đang tìm đường trên internet...",
  "Đang gọi API về nhà...",
  "Đang hỏi ý kiến server...",
  "Đang tra dầu bánh răng...",
  "Đang vặn lại mấy con ốc server...",
  "Đang chỉnh lại dây điện...",
  "Đang đẩy dữ liệu qua đường ống...",
  "Đang kiểm tra lại mạch...",
  "Đợi chút, đang pha cà phê...",
  "Sắp được rồi... thật.",
  "Vẫn nhanh hơn window update...",
  "Cứ bình tĩnh...",
  "Đợi tí, đang tìm remote...",
  "Đợi chút, đang ăn mì gói...",
  "Đang hỏi Google...",
  "Xin kiên nhẫn, phép thuật đang được thi triển...",
];

function getRandomMessage(prev?: string) {
  if (loadingMessages.length <= 1) return loadingMessages[0] ?? "";
  let next = prev ?? "";
  while (next === prev) {
    next = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  }
  return next;
}

export function PlayerLoadingOverlay() {
  const status = usePlayerStore((s) => s.status);
  const meta = usePlayerStore((s) => s.meta);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const hasPlayedOnce = usePlayerStore((s) => s.mediaPlaying.hasPlayedOnce);
  const manualSourceSelection = usePreferencesStore(
    (s) => s.manualSourceSelection,
  );

  const showOverlay =
    status === playerStatus.IDLE ||
    (status === playerStatus.SCRAPING && !manualSourceSelection) ||
    (status === playerStatus.PLAYING && isLoading && !hasPlayedOnce);

  const [shouldRender, setShouldRender] = useState(showOverlay);
  const [isVisible, setIsVisible] = useState(showOverlay);
  const [hideLogo, setHideLogo] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(() =>
    getRandomMessage(),
  );
  const [messageVisible, setMessageVisible] = useState(true);

  useEffect(() => {
    setHideLogo(false);
  }, [meta?.logo]);

  useEffect(() => {
    if (showOverlay) {
      setLoadingMessage((prev) => getRandomMessage(prev));
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
  }, [showOverlay]);

  useEffect(() => {
    if (!showOverlay) return;

    const interval = window.setInterval(() => {
      setMessageVisible(false);
      window.setTimeout(() => {
        setLoadingMessage((prev) => getRandomMessage(prev));
        setMessageVisible(true);
      }, 260);
    }, 2600);

    return () => window.clearInterval(interval);
  }, [showOverlay]);

  if (!shouldRender) return null;

  const backgroundImage = meta?.backdrop ?? meta?.poster;
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

      <div className="absolute inset-0 bg-black/65" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/75" />

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
