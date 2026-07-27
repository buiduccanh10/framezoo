import React, { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Dropdown, type OptionItem } from "@/components/form/Dropdown";
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

function getStreamQuality(stream: AddonStream): string {
  const text = [stream.name, stream.title, stream.description, stream.fileName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(4k|2160p|uhd)\b/.test(text)) return "4K";
  if (/\b(1440p|2k|qhd)\b/.test(text)) return "1440p";
  if (/\b(1080p|1080i|fhd|full\s*hd)\b/.test(text)) return "1080p";
  if (/\b(720p|720i|hd)\b/.test(text)) return "720p";
  if (/\b(480p|480i|360p|240p|sd|dvd|cam|ts)\b/.test(text)) return "480p";
  return "other";
}

function AddonIcon(props: { name: string; logo?: string }) {
  if (props.logo) {
    return (
      <LazyImage
        src={props.logo}
        alt=""
        className="h-10 w-10 shrink-0 rounded-lg object-contain"
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
  rightSide?: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="flex items-center justify-between border-b border-video-context-border pb-3 pt-5 font-bold text-video-context-type-main">
        <div className="flex min-w-0 flex-1 items-center">
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
            <span className="min-w-0 truncate">
              {props.addon.manifest.name}
            </span>
          </div>
        </div>
        {props.rightSide ? (
          <div className="ml-3 shrink-0">{props.rightSide}</div>
        ) : null}
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addons = useInstalledAddons();
  const progressItems = useProgressStore((state) => state.items);
  const { playMedia } = usePlayer();
  const currentSourceId = usePlayerStore((state) => state.sourceId);
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

  const qualityOptions: OptionItem[] = useMemo(
    () => [
      { id: "all", name: t("addons.player.qualities.all", "All Qualities") },
      { id: "4K", name: t("addons.player.qualities.4k", "4K") },
      { id: "1440p", name: t("addons.player.qualities.1440p", "1440p") },
      { id: "1080p", name: t("addons.player.qualities.1080p", "1080p") },
      { id: "720p", name: t("addons.player.qualities.720p", "720p") },
      { id: "480p", name: t("addons.player.qualities.480p", "480p / SD") },
      { id: "other", name: t("addons.player.qualities.other", "Other") },
    ],
    [t],
  );
  const [selectedQuality, setSelectedQuality] = React.useState<OptionItem>(
    qualityOptions[0],
  );

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
    setSelectedQuality(qualityOptions[0]);
  }, [addonMedia, qualityOptions]);

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
          const duration = session.duration ?? undefined;
          const playbackStartAt = session.startAt ?? startAt;
          const mediaSource: SourceSliceSource = {
            id: stream.id,
            type: "file",
            qualities: {
              unknown: {
                type: "mp4",
                url: session.streamUrl,
              },
            },
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
  const filteredAddonStreams = useMemo(() => {
    if (selectedQuality.id === "all") return addonStreams;
    return addonStreams.filter(
      (stream) => getStreamQuality(stream) === selectedQuality.id,
    );
  }, [addonStreams, selectedQuality]);
  const selectedAddonStreams = useMemo(() => {
    if (!selectedAddonId) return [];
    return filteredAddonStreams.filter(
      (stream) =>
        stream.addonId === selectedAddonId &&
        (!isInitialSelection || stream.kind === "torrent"),
    );
  }, [filteredAddonStreams, isInitialSelection, selectedAddonId]);
  const streamCountByAddon = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stream of filteredAddonStreams) {
      if (isInitialSelection && stream.kind !== "torrent") continue;
      counts.set(stream.addonId, (counts.get(stream.addonId) ?? 0) + 1);
    }
    return counts;
  }, [filteredAddonStreams, isInitialSelection]);
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

  const inlineDropdown = (
    <Dropdown
      options={qualityOptions}
      selectedItem={selectedQuality}
      setSelectedItem={setSelectedQuality}
      className="!my-0 text-xs font-normal"
      side="right"
    />
  );

  const content = (
    <Menu.CardWithScrollable>
      {showAddonList && (isInitialSelection || !onCancel) ? (
        <Menu.Title rightSide={inlineDropdown}>
          {t("addons.player.chooseAddon", "Choose an addon")}
        </Menu.Title>
      ) : showAddonList ? (
        <Menu.BackLink onClick={onCancel} rightSide={inlineDropdown}>
          {t("addons.player.sources", "Sources")}
        </Menu.BackLink>
      ) : (
        <SelectedAddonHeader
          addon={selectedAddon}
          onBack={() => {
            setSelectedAddonId(null);
            setAddonLoadErrors([]);
            setAddonError(null);
          }}
          rightSide={inlineDropdown}
        />
      )}
      <>
        {showAddonList ? (
          enabledAddons.length === 0 ? (
            <Menu.Section>
              <Menu.TextDisplay
                noIcon
                title={t(
                  "addons.player.emptyTitle",
                  "No stream addons available",
                )}
              >
                <div className="flex flex-col items-center gap-4 pt-2 pb-4">
                  <p className="max-w-md text-sm leading-relaxed text-video-context-type-main text-opacity-80">
                    {t(
                      "addons.player.emptyExplanation",
                      "No stream addon is installed or enabled. Add a manifest URL you choose in the Addons Manager.",
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onCancel?.();
                      navigate("/addons");
                    }}
                    className="flex items-center gap-2 rounded-xl bg-buttons-purple px-6 py-3 text-sm font-bold text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-buttons-purpleHover active:scale-95"
                  >
                    <Icon icon={Icons.EXTENSION} className="text-lg" />
                    <span>
                      {t(
                        "addons.player.manageAddonsButton",
                        "Manage Addon List",
                      )}
                    </span>
                    <Icon icon={Icons.CHEVRON_RIGHT} className="ml-1 text-sm" />
                  </button>
                </div>
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
                            ? t(
                                "addons.player.unableToLoad",
                                "Unable to load streams",
                              )
                            : loading
                              ? t(
                                  "addons.player.loadingStreams",
                                  "Loading streams...",
                                )
                              : streamCount > 0
                                ? t(
                                    streamCount === 1
                                      ? "addons.player.streamCount"
                                      : "addons.player.streamCount_plural",
                                    "{{count}} streams",
                                    { count: streamCount },
                                  )
                                : t(
                                    "addons.player.viewStreams",
                                    "View streams",
                                  )}
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
            <Menu.TextDisplay
              noIcon
              title={t("addons.player.title", "Desktop addons")}
            >
              {isInitialSelection
                ? t(
                    "addons.player.noTorrentStreams",
                    "No torrent streams returned for this addon.",
                  )
                : t(
                    "addons.player.noAddonStreams",
                    "No addon streams returned for this title.",
                  )}
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
