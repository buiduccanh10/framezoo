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
  const containerRef = useRef<HTMLDivElement>(null!);

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
        <div className="absolute bottom-full right-0 z-[100] mb-2 w-max min-w-[24rem] max-w-[90vw] sm:max-w-xl rounded-xl border border-dropdown-border bg-dropdown-altBackground p-5 text-sm shadow-xl">
          <div className="mb-6 text-lg font-bold text-white">
            {t("player.torrent.statistics", { defaultValue: "Statistics" })}
          </div>

          <div className="mb-6 flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span className="text-type-secondary text-base">Peers</span>
              <span className="text-white text-base">{status.peers}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-type-secondary text-base">
                {t("player.torrent.speedLabel", { defaultValue: "Speed" })}
              </span>
              <span className="text-white text-base">
                {formatSpeed(status.speedBytesPerSecond)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-type-secondary text-base">
                {t("player.torrent.completedLabel", {
                  defaultValue: "Completed",
                })}
              </span>
              <span className="text-white text-base">
                {status.progress.toFixed(0)} %
              </span>
            </div>
          </div>

          <div>
            <div className="mb-2 text-type-secondary text-base">
              {t("player.torrent.infohashLabel", { defaultValue: "Info hash" })}
            </div>
            <div className="break-all text-white text-base">
              {status.infoHash ?? t("player.torrent.unknown")}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
