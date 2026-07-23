import React, { useCallback, useEffect, useMemo } from "react";

import { Icon, Icons } from "@/components/Icon";
import { Loading } from "@/components/layout/Loading";
import { Spinner } from "@/components/layout/Spinner";
import { usePlayer } from "@/components/player/hooks/usePlayer";
import { Menu } from "@/components/player/internals/ContextMenu";
import { SelectableLink } from "@/components/player/internals/ContextMenu/Links";
import { LazyImage } from "@/components/utils/Image";
import { loadAddonStreams } from "@/desktop/addons/client";
import { useInstalledAddons } from "@/desktop/addons/store";
import { loadAllAddonStreamsDetailed } from "@/desktop/addons/streams";
import type {
  AddonStream,
  AddonStreamLoadError,
  InstalledAddon,
} from "@/desktop/addons/types";
import { startTorrent } from "@/desktop/torrentClient";
import {
  clearTorrentSession,
  getActiveTorrentSessionId,
  registerTorrentSession,
  scheduleTorrentStop,
} from "@/desktop/torrentPlaybackStore";
import type { PlayerMeta } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import type { SourceSliceSource } from "@/stores/player/utils/qualities";
import { useProgressStore } from "@/stores/progress";
import { getSavedProgressTime } from "@/stores/progress/selectors";

function addonMediaId(meta: PlayerMeta) {
  const imdbId = meta.imdbId?.trim();
  if (imdbId && /^tt\d+$/i.test(imdbId)) return imdbId;
  return `tmdb:${meta.tmdbId}`;
}

function addonCaptions(stream: AddonStream) {
  return stream.subtitles.flatMap((subtitle, index) => {
    if (!subtitle.url) return [];
    return [
      {
        id: `addon-caption:${stream.id}:${subtitle.id ?? index}`,
        language: subtitle.lang ?? subtitle.language ?? "und",
        url: subtitle.url,
        needsProxy: false,
        display: subtitle.label,
        source: stream.addonName,
      },
    ];
  });
}

function addonDirectSource(stream: AddonStream): SourceSliceSource {
  if (stream.kind === "hls") {
    return {
      id: stream.id,
      type: "hls",
      url: stream.url,
      headers: stream.headers,
    };
  }
  if (stream.kind === "dash") {
    return {
      id: stream.id,
      type: "dash",
      url: stream.url,
      headers: stream.headers,
    };
  }
  return {
    id: stream.id,
    type: "file",
    qualities: {
      unknown: {
        type: "mp4",
        url: stream.url,
      },
    },
    headers: stream.headers,
  };
}

function streamLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function AddonIcon(props: { name: string; logo?: string }) {
  if (props.logo) {
    return (
      <LazyImage
        src={props.logo}
        alt=""
        className="h-10 w-10 shrink-0 rounded-lg bg-black/30 p-1 object-contain"
        showSkeleton={false}
        loading="eager"
        decoding="sync"
      />
    );
  }

  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xl text-white"
      aria-label={`${props.name} addon icon`}
    >
      <Icon icon={Icons.WEB} />
    </span>
  );
}

function SelectedAddonHeader(props: {
  addon: InstalledAddon;
  onBack: () => void;
}) {
  return (
    <div>
      <h3 className="flex items-center border-b border-video-context-border pb-3 pt-5 font-bold text-video-context-type-main">
        <button
          type="button"
          className="-ml-2 shrink-0 rounded p-2 tabbable hover:bg-video-context-light hover:bg-opacity-10"
          onClick={props.onBack}
          aria-label="Back to addons"
        >
          <Icon className="text-xl" icon={Icons.ARROW_LEFT} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <AddonIcon
            name={props.addon.manifest.name}
            logo={props.addon.manifest.logo}
          />
          <span className="min-w-0 truncate">{props.addon.manifest.name}</span>
        </div>
      </h3>
    </div>
  );
}

// Addon torrent selection view.
export function SourceSelectPart(props: {
  meta: PlayerMeta;
  mode?: "initial" | "full";
  onCancel?: () => void;
  onSelected?: () => void;
  onLoadingChange?: (loading: boolean) => void;
  onStateChange?: (state: "addons" | "streams") => void;
}) {
  const { meta, mode, onCancel, onSelected, onLoadingChange, onStateChange } =
    props;
  const addons = useInstalledAddons();
  const currentSourceId = usePlayerStore((state) => state.sourceId);
  const progressItems = useProgressStore((state) => state.items);
  const { playMedia } = usePlayer();
  const [addonStreams, setAddonStreams] = React.useState<AddonStream[]>([]);
  const [addonLoadErrors, setAddonLoadErrors] = React.useState<
    AddonStreamLoadError[]
  >([]);
  const [loadingAddonIds, setLoadingAddonIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [addonError, setAddonError] = React.useState<string | null>(null);
  const [startingAddonId, setStartingAddonId] = React.useState<string | null>(
    null,
  );
  const [selectedAddonId, setSelectedAddonId] = React.useState<string | null>(
    null,
  );
  const isInitialSelection = mode === "initial";

  const addonMedia = useMemo(
    () => ({
      type: meta.type === "show" ? ("series" as const) : ("movie" as const),
      id: addonMediaId(meta),
      season: meta.season?.number,
      episode: meta.episode?.number,
    }),
    [meta],
  );

  const selectedAddon = useMemo(
    () => addons.find((addon) => addon.manifest.id === selectedAddonId) ?? null,
    [addons, selectedAddonId],
  );

  useEffect(() => {
    setSelectedAddonId(null);
    setAddonStreams([]);
    setAddonLoadErrors([]);
    setAddonError(null);
    setLoadingAddonIds(new Set());
  }, [addonMedia]);

  useEffect(() => {
    onStateChange?.(selectedAddonId ? "streams" : "addons");
  }, [selectedAddonId, onStateChange]);

  useEffect(() => {
    let cancelled = false;
    const enabledAddonIds = new Set(
      addons.filter((addon) => addon.enabled).map((addon) => addon.manifest.id),
    );
    console.debug("[desktop-addon] loading streams", {
      addons: addons
        .filter((addon) => enabledAddonIds.has(addon.manifest.id))
        .map((addon) => ({
          id: addon.manifest.id,
          name: addon.manifest.name,
          manifestUrl: addon.manifestUrl,
        })),
      media: addonMedia,
    });
    setLoadingAddonIds(enabledAddonIds);
    void loadAllAddonStreamsDetailed(addons, addonMedia, loadAddonStreams)
      .then((result) => {
        if (cancelled) return;
        setAddonStreams(result.streams);
        setAddonLoadErrors(result.errors);
      })
      .catch((reason) => {
        if (cancelled) return;
        setAddonError(
          reason instanceof Error
            ? reason.message
            : "Unable to load addon streams",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingAddonIds(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [addons, addonMedia]);

  const selectAddonStream = useCallback(
    async (stream: AddonStream) => {
      setStartingAddonId(stream.id);
      onLoadingChange?.(true);
      setAddonError(null);
      const previousTorrentSessionId = getActiveTorrentSessionId();

      try {
        if (stream.kind === "torrent") {
          const startAt = getSavedProgressTime(progressItems, meta);
          const session = await startTorrent({
            sourceId: stream.id,
            url: stream.url,
            infoHash: stream.infoHash ?? undefined,
            fileIdx: stream.fileIdx ?? undefined,
            fileName: stream.fileName ?? undefined,
            startAt,
          });
          registerTorrentSession(session.sessionId);
          const isDirectFile = session.streamType === "file";
          const duration = session.duration ?? undefined;
          const playbackStartAt = session.startAt ?? startAt;
          const mediaSource: SourceSliceSource = isDirectFile
            ? {
                id: stream.id,
                type: "file",
                qualities: {
                  unknown: {
                    type: "mp4",
                    url: session.streamUrl,
                  },
                },
                duration,
              }
            : {
                id: stream.id,
                type: "hls",
                url: session.streamUrl,
                duration,
                isTorrent: true,
              };

          playMedia(
            mediaSource,
            addonCaptions(stream),
            stream.id,
            playbackStartAt,
          );
          onSelected?.();

          // Chromium can issue one more Range request for the old source after
          // the new source is selected. Keep the old route alive briefly.
          if (
            previousTorrentSessionId &&
            previousTorrentSessionId !== session.sessionId
          ) {
            scheduleTorrentStop(previousTorrentSessionId);
          }
        } else {
          playMedia(
            addonDirectSource(stream),
            addonCaptions(stream),
            stream.id,
          );
          onSelected?.();
          if (previousTorrentSessionId) {
            await clearTorrentSession(previousTorrentSessionId);
          }
        }
      } catch (reason) {
        setAddonError(
          reason instanceof Error ? reason.message : "Unable to start stream",
        );
      } finally {
        onLoadingChange?.(false);
        setStartingAddonId(null);
      }
    },
    [meta, onLoadingChange, onSelected, playMedia, progressItems],
  );

  const enabledAddons = useMemo(
    () => addons.filter((addon) => addon.enabled),
    [addons],
  );
  const selectedAddonStreams = useMemo(() => {
    if (!selectedAddonId) return [];
    return addonStreams.filter(
      (stream) =>
        stream.addonId === selectedAddonId &&
        (!isInitialSelection || stream.kind === "torrent"),
    );
  }, [addonStreams, isInitialSelection, selectedAddonId]);
  const streamCountByAddon = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stream of addonStreams) {
      if (isInitialSelection && stream.kind !== "torrent") continue;
      counts.set(stream.addonId, (counts.get(stream.addonId) ?? 0) + 1);
    }
    return counts;
  }, [addonStreams, isInitialSelection]);
  const selectedAddonError = useMemo(
    () =>
      addonLoadErrors.find((error) => error.addonId === selectedAddonId) ??
      null,
    [addonLoadErrors, selectedAddonId],
  );
  const selectedAddonLoading = selectedAddonId
    ? loadingAddonIds.has(selectedAddonId)
    : false;
  const showAddonList = !selectedAddonId || !selectedAddon;
  const showBackdrop = isInitialSelection;
  const backgroundImage = meta.backdrop ?? meta.poster;

  const content = (
    <Menu.CardWithScrollable>
      {showAddonList && (isInitialSelection || !onCancel) ? (
        <Menu.Title>Choose an addon</Menu.Title>
      ) : showAddonList ? (
        <Menu.BackLink onClick={onCancel}>Nguồn</Menu.BackLink>
      ) : (
        <SelectedAddonHeader
          addon={selectedAddon}
          onBack={() => {
            setSelectedAddonId(null);
            setAddonLoadErrors([]);
            setAddonError(null);
          }}
        />
      )}
      <>
        {showAddonList ? (
          enabledAddons.length === 0 ? (
            <Menu.Section>
              <Menu.TextDisplay noIcon title="Desktop addons">
                Install an addon from the plus button in the navigation.
              </Menu.TextDisplay>
            </Menu.Section>
          ) : (
            <Menu.Section>
              {enabledAddons.map((addon) => {
                const streamCount =
                  streamCountByAddon.get(addon.manifest.id) ?? 0;
                const loading = loadingAddonIds.has(addon.manifest.id);
                const loadError = addonLoadErrors.find(
                  (error) => error.addonId === addon.manifest.id,
                );

                return (
                  <SelectableLink
                    key={addon.manifest.id}
                    rightSide={
                      <Icon
                        className="ml-2 text-xl"
                        icon={Icons.CHEVRON_RIGHT}
                      />
                    }
                    onClick={() => setSelectedAddonId(addon.manifest.id)}
                  >
                    <span className="inline-flex h-full min-w-0 items-center gap-3 align-middle">
                      <AddonIcon
                        name={addon.manifest.name}
                        logo={addon.manifest.logo}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-white">
                          {addon.manifest.name}
                        </span>
                        <span className="truncate text-sm text-video-context-type-main text-opacity-60">
                          {loadError
                            ? "Unable to load streams"
                            : loading
                              ? "Loading streams..."
                              : streamCount > 0
                                ? `${streamCount} stream${
                                    streamCount === 1 ? "" : "s"
                                  }`
                                : "View streams"}
                        </span>
                      </span>
                    </span>
                  </SelectableLink>
                );
              })}
            </Menu.Section>
          )
        ) : selectedAddonLoading ? (
          <Menu.Section>
            <Menu.TextDisplay noIcon>
              <Loading />
            </Menu.TextDisplay>
          </Menu.Section>
        ) : selectedAddonStreams.length === 0 ? (
          <Menu.Section>
            <Menu.TextDisplay noIcon title="Desktop addons">
              {isInitialSelection
                ? "No torrent streams returned for this addon."
                : "No addon streams returned for this title."}
            </Menu.TextDisplay>
          </Menu.Section>
        ) : (
          <Menu.Section>
            {selectedAddonStreams.map((stream) => {
              const selected = currentSourceId === stream.id;
              const isStartingThisStream = startingAddonId === stream.id;
              const size = formatSize(stream.videoSize);
              const nameLines = streamLines(stream.name || stream.addonName);
              const titleLines = streamLines(stream.title || "");
              const descLines = stream.description
                ? streamLines(stream.description)
                : [];
              const fallbackDetails = [
                size ? `💾 ${size}` : null,
                stream.fileName ? `⚙ ${stream.fileName}` : null,
              ].filter(Boolean) as string[];

              const detailsLines = [
                ...titleLines,
                ...descLines,
                ...(titleLines.length === 0 && descLines.length === 0
                  ? fallbackDetails
                  : []),
              ];

              return (
                <Menu.Link
                  key={stream.id}
                  active={selected || isStartingThisStream}
                  clickable={!startingAddonId}
                  disabled={startingAddonId !== null && !isStartingThisStream}
                  className="items-center gap-4 px-3 py-3"
                  onClick={() => void selectAddonStream(stream)}
                >
                  <div className="grid min-w-0 flex-1 grid-cols-[minmax(8rem,12rem),minmax(0,1fr)] items-center gap-6">
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-2">
                        {isStartingThisStream ? (
                          <Spinner className="text-[14px] shrink-0 text-white/90" />
                        ) : null}
                        <span className="min-w-0 whitespace-pre-line text-[15px] font-medium leading-5 text-white/90">
                          {nameLines.join("\n")}
                        </span>
                      </div>
                    </div>
                    <span className="min-w-0 whitespace-pre-line text-[14px] leading-5 text-white/70 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5] overflow-hidden">
                      {detailsLines.map((line, i) => (
                        <span
                          key={i}
                          className={`block ${i === 0 ? "text-white/90 font-medium text-[15px]" : ""}`}
                        >
                          {line}
                        </span>
                      ))}
                    </span>
                  </div>
                </Menu.Link>
              );
            })}
          </Menu.Section>
        )}
        {addonError ? (
          <p className="px-1 pt-2 text-sm text-video-context-error">
            {addonError}
          </p>
        ) : null}
        {selectedAddonError ? (
          <p className="px-1 pt-2 text-sm text-video-context-error">
            {selectedAddonError.message}
          </p>
        ) : null}
      </>
    </Menu.CardWithScrollable>
  );

  if (mode === "full") {
    return content;
  }

  if (startingAddonId) return null;

  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden bg-black">
      {showBackdrop ? (
        <>
          {backgroundImage ? (
            <LazyImage
              src={backgroundImage}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-55"
              showSkeleton={false}
              loading="eager"
              decoding="sync"
            />
          ) : null}
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/55 to-black/80" />
        </>
      ) : null}
      <div className="pointer-events-auto relative flex h-full w-full items-center justify-center px-6 py-8">
        <div className="h-[min(58vh,42rem)] w-full max-w-2xl">{content}</div>
      </div>
    </div>
  );
}
