import { ReactNode, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { getCachedMetadata } from "@/backend/helpers/providerApi";
import { useProviderMetadataVersion } from "@/backend/providers/runtimeMetadata";
import { Loading } from "@/components/layout/Loading";
import {
  useEmbedScraping,
  useSourceScraping,
} from "@/components/player/hooks/useSourceSelection";
import { Menu } from "@/components/player/internals/ContextMenu";
import { SelectableLink } from "@/components/player/internals/ContextMenu/Links";
import {
  buildOpenMovieStreamId,
  getOpenMovieVariantLabelFromStreamId,
} from "@/components/player/utils/openMovieVariant";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

export interface SourceSelectionViewProps {
  id: string;
  onChoose?: (id: string) => void;
}

export interface EmbedSelectionViewProps {
  id: string;
  sourceId: string | null;
}

export function EmbedOption(props: {
  embedId: string;
  url: string;
  sourceId: string;
  routerId: string;
}) {
  const { t } = useTranslation();
  const currentEmbedId = usePlayerStore((s) => s.embedId);
  const unknownEmbedName = t("player.menus.sources.unknownOption");

  const embedName = useMemo(() => {
    // For OpenMovie embeds, parse the stream name from the encoded URL
    if (
      props.embedId === "openmovie-embed" &&
      props.url?.startsWith("openmovie://")
    ) {
      try {
        const encoded = props.url.replace("openmovie://", "");
        const info = JSON.parse(decodeURIComponent(encoded));
        return info.title || info.name || "OpenMovie Stream";
      } catch {
        // Fall through to default
      }
    }
    if (!props.embedId) return unknownEmbedName;
    const sourceMeta = getCachedMetadata().find((s) => s.id === props.embedId);
    return sourceMeta?.name ?? unknownEmbedName;
  }, [props.embedId, props.url, unknownEmbedName]);

  const { run, errored, loading, notFound } = useEmbedScraping(
    props.routerId,
    props.sourceId,
    props.url,
    props.embedId,
  );

  let rightSide;
  if (loading) {
    rightSide = undefined; // Let SelectableLink handle loading
  } else if (notFound) {
    rightSide = (
      <div className="flex items-center text-video-scraping-noresult">
        <div className="w-4 h-4 rounded-full border-2 border-current bg-current flex items-center justify-center">
          <div className="w-2 h-0.5 bg-background-main rounded-full" />
        </div>
      </div>
    );
  }

  const activeStreamId = usePlayerStore((s) => s.source?.id);
  const isSelected = useMemo(() => {
    if (
      props.embedId === "openmovie-embed" &&
      props.url?.startsWith("openmovie://")
    ) {
      try {
        const encoded = props.url.replace("openmovie://", "");
        const info = JSON.parse(decodeURIComponent(encoded));
        return (
          !!activeStreamId &&
          activeStreamId ===
            buildOpenMovieStreamId({
              provider: info.provider,
              url: info.url,
              quality: info.quality,
            })
        );
      } catch {
        return false;
      }
    }
    return props.embedId === currentEmbedId;
  }, [props.embedId, props.url, currentEmbedId, activeStreamId]);

  return (
    <SelectableLink
      loading={loading}
      error={errored && !notFound}
      onClick={run}
      selected={isSelected}
      rightSide={rightSide}
    >
      <span className="flex flex-col">
        <span>{embedName}</span>
      </span>
    </SelectableLink>
  );
}

export function EmbedSelectionView({ sourceId, id }: EmbedSelectionViewProps) {
  const { t } = useTranslation();
  useProviderMetadataVersion();
  const router = useOverlayRouter(id);
  const { run, watching, notfound, loading, items, errored } =
    useSourceScraping(sourceId, id);

  const sourceName = useMemo(() => {
    if (!sourceId) return "...";
    const sourceMeta = getCachedMetadata().find((s) => s.id === sourceId);
    return sourceMeta?.name ?? "...";
  }, [sourceId]);

  const lastSourceId = useRef<string | null>(null);
  useEffect(() => {
    if (lastSourceId.current === sourceId) return;
    lastSourceId.current = sourceId;
    if (!sourceId) return;
    run();
  }, [run, sourceId]);

  let content: ReactNode = null;
  if (loading)
    content = (
      <Menu.TextDisplay noIcon>
        <Loading />
      </Menu.TextDisplay>
    );
  else if (notfound)
    content = (
      <Menu.TextDisplay
        title={t("player.menus.sources.noStream.title") ?? undefined}
      >
        {t("player.menus.sources.noStream.text")}
      </Menu.TextDisplay>
    );
  else if (items?.length === 0)
    content = (
      <>
        <Menu.TextDisplay
          title={t("player.menus.sources.noEmbeds.title") ?? undefined}
        >
          {t("player.menus.sources.noEmbeds.text")}
        </Menu.TextDisplay>
      </>
    );
  else if (errored)
    content = (
      <>
        <Menu.TextDisplay
          title={t("player.menus.sources.failed.title") ?? undefined}
        >
          {t("player.menus.sources.failed.text")}
        </Menu.TextDisplay>
      </>
    );
  else if (watching)
    content = null; // when it starts watching, empty the display
  else if (items && sourceId)
    content = items.map((v) => (
      <EmbedOption
        key={`${v.embedId}-${v.url}`}
        embedId={v.embedId}
        url={v.url}
        routerId={id}
        sourceId={sourceId}
      />
    ));

  return (
    <>
      <Menu.BackLink onClick={() => router.navigate("/source")}>
        {sourceName}
      </Menu.BackLink>
      <Menu.Section>{content}</Menu.Section>
    </>
  );
}

export function SourceSelectionView({
  id,
  onChoose,
}: SourceSelectionViewProps) {
  const { t } = useTranslation();
  useProviderMetadataVersion();
  const router = useOverlayRouter(id);
  const metaType = usePlayerStore((s) => s.meta?.type);
  const currentSourceId = usePlayerStore((s) => s.sourceId);
  const setResumeFromSourceId = usePlayerStore((s) => s.setResumeFromSourceId);
  const setStatus = usePlayerStore((s) => s.setStatus);
  const manualSourceSelection = usePreferencesStore(
    (s) => s.manualSourceSelection,
  );
  const sourceMaintainText = t("player.menus.sources.maintain");

  const sources = useMemo(() => {
    if (!metaType) return [];
    const allSources = getCachedMetadata()
      .filter((v) => v.type === "source")
      .filter(
        (v) => !Array.isArray(v.mediaTypes) || v.mediaTypes.includes(metaType),
      )
      .sort(
        (left, right) =>
          (left.rank ?? 0) - (right.rank ?? 0) ||
          left.name.localeCompare(right.name),
      );

    return allSources;
  }, [metaType]);

  const handleFindNextSource = () => {
    if (!currentSourceId) return;
    // Set the resume source ID in the store
    setResumeFromSourceId(currentSourceId);
    // Close the settings overlay
    router.close();
    // Set status to SCRAPING to trigger scraping from next source
    setStatus(playerStatus.SCRAPING);
  };

  const activeStreamId = usePlayerStore((s) => s.source?.id);

  return (
    <>
      <Menu.BackLink
        onClick={() => router.navigate("/")}
        rightSide={
          <div className="flex items-center gap-2">
            {currentSourceId && !manualSourceSelection && (
              <button
                type="button"
                onClick={handleFindNextSource}
                className="-mr-2 -my-1 px-2 p-[0.4em] rounded tabbable hover:bg-video-context-light hover:bg-opacity-10"
              >
                {t("player.menus.sources.findNextSource")}
              </button>
            )}
          </div>
        }
      >
        {t("player.menus.sources.title")}
      </Menu.BackLink>
      <Menu.Section className="pb-4">
        {sources.map((v) => {
          const isSelected = v.id === currentSourceId;
          let subSourceLabel = null;

          if (isSelected && v.id === "openmovie") {
            subSourceLabel =
              getOpenMovieVariantLabelFromStreamId(activeStreamId);
          }

          return (
            <SelectableLink
              key={v.id}
              disabled={v.disabled}
              onClick={() => {
                if (v.disabled) return;
                onChoose?.(v.id);
                router.navigate("/source/embeds");
              }}
              selected={isSelected}
              rightSide={
                v.disabled ? (
                  <span className="text-[0.72em] uppercase tracking-wide opacity-70">
                    {sourceMaintainText}
                  </span>
                ) : undefined
              }
            >
              <div className="flex flex-col">
                <span>{v.name}</span>
                {subSourceLabel && (
                  <span className="text-[0.7em] opacity-60 font-medium">
                    {subSourceLabel}
                  </span>
                )}
              </div>
            </SelectableLink>
          );
        })}
      </Menu.Section>
    </>
  );
}
