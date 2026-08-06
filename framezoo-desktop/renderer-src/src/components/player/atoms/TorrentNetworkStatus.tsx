import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { useActiveTorrentStatus } from "@/desktop/torrentPlaybackStore";

function formatSpeed(bytesPerSecond: number) {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function TorrentNetworkStatus(props: {
  iconSizeClass?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const status = useActiveTorrentStatus();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateLabel = status
    ? t(`player.torrent.states.${status.state}`, {
        defaultValue: status.state,
      })
    : "";

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!status) setOpen(false);
  }, [status]);

  if (!status) return null;

  return (
    <div ref={containerRef} className="relative">
      <VideoPlayerButton
        className={`text-white ${props.className ?? ""}`}
        iconSizeClass={props.iconSizeClass ?? "text-[24px]"}
        onClick={() => setOpen((value) => !value)}
        aria-label={t("player.torrent.networkStatus")}
        aria-expanded={open}
        title={t("player.torrent.networkStatus")}
        icon={Icons.WEB}
      />
      {open ? (
        <div className="absolute bottom-full right-0 z-[100] mb-2 w-max min-w-[16rem] max-w-[90vw] sm:max-w-md rounded-xl border border-dropdown-border bg-dropdown-altBackground p-3 text-xs text-dropdown-text shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-4 text-white">
            <span>{t("player.torrent.network")}</span>
            <span className="uppercase text-type-link">{stateLabel}</span>
          </div>
          <div className="space-y-1">
            <p>
              {t("player.torrent.progress", {
                progress: status.progress.toFixed(1),
              })}
            </p>
            <p>{t("player.torrent.peers", { count: status.peers })}</p>
            <p>
              {t("player.torrent.speed", {
                speed: formatSpeed(status.speedBytesPerSecond),
              })}
            </p>
            <p className="break-all">
              {t("player.torrent.infohash", {
                infoHash: status.infoHash ?? t("player.torrent.unknown"),
              })}
            </p>
            <p>
              {status.fileName
                ? t("player.torrent.file", { fileName: status.fileName })
                : null}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
