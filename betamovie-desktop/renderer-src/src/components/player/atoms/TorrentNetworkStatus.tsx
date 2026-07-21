import { useEffect, useRef, useState } from "react";

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
  const status = useActiveTorrentStatus();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        aria-label="Torrent network status"
        aria-expanded={open}
        title="Torrent network status"
        icon={Icons.WEB}
      />
      {open ? (
        <div className="absolute bottom-full right-0 z-[100] mb-2 w-max min-w-[16rem] max-w-[90vw] sm:max-w-md rounded-xl border border-dropdown-border bg-dropdown-altBackground p-3 text-xs text-dropdown-text shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-4 text-white">
            <span>Torrent network</span>
            <span className="uppercase text-type-link">{status.state}</span>
          </div>
          <div className="space-y-1">
            <p>Progress: {status.progress.toFixed(1)}%</p>
            <p>Peers: {status.peers}</p>
            <p>Speed: {formatSpeed(status.speedBytesPerSecond)}</p>
            <p className="break-all">
              Infohash: {status.infoHash ?? "unknown"}
            </p>
            {status.fileName ? <p>File: {status.fileName}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
