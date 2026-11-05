import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { getMediaFromExternalId } from "@/backend/metadata/tmdb";
import { Icon, Icons } from "@/components/Icon";
import { MediaCardSkeleton } from "@/components/media/MediaCard";
import { getReleaseQualityVariantFromLabel } from "@/components/media/ReleaseQualityBadge";
import { WatchedMediaCard } from "@/components/media/WatchedMediaCard";
import { Flare } from "@/components/utils/Flare";
import {
  type AddonCatalogEntry,
  getCatalogMediaIdentity,
  loadAllAddonCatalogs,
} from "@/desktop/addons/catalog";
import { useInstalledAddons } from "@/desktop/addons/store";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MediaItem } from "@/utils/mediaTypes";

import { CarouselNavButtons } from "./CarouselNavButtons";

interface AddonCatalogRowProps {
  /** "movie" | "series" */
  type: string;
  /** Stremio catalog id, e.g. "top", "popular", or a specific catalog id from the manifest */
  catalogId?: string;
  /** Optional specific addon ID to render */
  addonId?: string;
  /** Optional addon IDs to exclude from rendering */
  excludeAddonIds?: string[];
  /** Human-readable section title override. Falls back to "From your addons" */
  title?: string;
  carouselRefs?: React.MutableRefObject<{
    [key: string]: HTMLDivElement | null;
  }>;
  onShowDetails?: (media: MediaItem) => void;
}

function MoreCard({ link }: { link: string }) {
  const { t } = useTranslation();

  return (
    <div className="relative mt-4 group cursor-pointer user-select-none rounded-xl p-2 bg-transparent transition-colors duration-300 w-[10rem] md:w-[11.5rem] h-auto">
      <Link to={link} className="block">
        <Flare.Base className="group -m-[0.705em] hover:scale-95 transition-all rounded-xl bg-background-main duration-300 hover:bg-mediaCard-hoverBackground tabbable">
          <Flare.Light
            flareSize={300}
            cssColorVar="--colors-mediaCard-hoverAccent"
            backgroundClass="bg-mediaCard-hoverBackground duration-100"
            className="rounded-xl bg-background-main group-hover:opacity-100"
          />
          <Flare.Child className="pointer-events-auto relative mb-2 p-[0.4em] transition-transform duration-300">
            <div className="relative pb-[150%] w-full flex items-center justify-center">
              <div className="flex absolute inset-0 flex-col items-center justify-center">
                <Icon
                  icon={Icons.ARROW_RIGHT}
                  className="text-4xl mb-2 transition-transform duration-300"
                />
                <span className="text-sm text-center px-2">
                  {t("discover.carousel.more", "Xem thêm")}
                </span>
              </div>
            </div>
          </Flare.Child>
        </Flare.Base>
      </Link>
    </div>
  );
}

function CatalogRowSkeleton() {
  return (
    <div aria-busy="true">
      <div className="ml-4 md:ml-8 lg:ml-[100px] mt-2 animate-pulse">
        <div className="h-7 w-48 rounded bg-mediaCard-hoverBackground" />
        <div className="mt-2 h-4 w-20 rounded bg-mediaCard-hoverBackground" />
      </div>
      <div className="grid grid-flow-col auto-cols-max gap-4 overflow-hidden md:pl-8 md:pr-8">
        <div className="lg:w-12" />
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="relative mt-4 rounded-xl p-2 w-[10rem] md:w-[11.5rem]"
          >
            <MediaCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * AddonCatalogRow
 *
 * A horizontally scrollable carousel that displays catalog items from all
 * installed addons that declare the "catalog" resource for the given
 * content type and catalog id.
 *
 * Resource consumed: `catalog`
 * Used in: Discover page ("From your addons" section)
 */
export function AddonCatalogRow({
  type,
  catalogId,
  addonId,
  excludeAddonIds,
  title,
  carouselRefs,
  onShowDetails,
}: AddonCatalogRowProps) {
  const { t } = useTranslation();
  const addons = useInstalledAddons();
  const { ref: intersectionRef, hasIntersected } =
    useIntersectionObserver<HTMLDivElement>({
      threshold: 0.1,
      rootMargin: "50px",
    });

  const [items, setItems] = useState<AddonCatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!hasIntersected) return;

    let cancelled = false;
    let retryTimer: NodeJS.Timeout | null = null;
    let retryDelay = 3000;

    const fetchCatalogs = async () => {
      setIsLoading(true);

      try {
        const result = await loadAllAddonCatalogs(addons, type, catalogId, {
          addonId,
          excludeAddonIds,
        });

        if (cancelled) return;

        if (result.items.length > 0) {
          setItems(result.items);
        }
        setIsLoading(result.items.length === 0 && result.errors.length > 0);

        // If there were any errors or some addons timed out, retry in background without showing errors to user
        if (result.errors.length > 0) {
          console.debug(
            "[desktop-addon] catalog error, retrying in background in",
            retryDelay,
            "ms",
            result.errors,
          );
          retryTimer = setTimeout(() => {
            if (!cancelled) {
              retryDelay = Math.min(retryDelay * 1.5, 15000);
              fetchCatalogs();
            }
          }, retryDelay);
        }
      } catch (err) {
        console.warn("[desktop-addon] catalog fetch failed, retrying...", err);
        if (!cancelled) {
          setIsLoading(true);
          retryTimer = setTimeout(() => {
            if (!cancelled) {
              retryDelay = Math.min(retryDelay * 1.5, 15000);
              fetchCatalogs();
            }
          }, retryDelay);
        }
      }
    };

    fetchCatalogs();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [hasIntersected, addons, type, catalogId, addonId, excludeAddonIds]);

  // Register carousel ref for external scroll control
  const internalCarouselRefs = useRef<{ [key: string]: HTMLDivElement | null }>(
    {},
  );
  const setRef = (key: string, el: HTMLDivElement | null) => {
    internalCarouselRefs.current[key] = el;
    if (carouselRefs) carouselRefs.current[key] = el;
  };

  const { isMobile } = useIsMobile();

  // Render placeholder if not intersected yet to trigger observer
  if (!hasIntersected) {
    return (
      <div ref={intersectionRef}>
        <CatalogRowSkeleton />
      </div>
    );
  }

  // Group items by addon
  const groupedItems = items.reduce(
    (acc, entry) => {
      if (!acc[entry.addonId]) {
        acc[entry.addonId] = {
          addonName: entry.addonName,
          items: [],
        };
      }
      acc[entry.addonId].items.push(entry.item);
      return acc;
    },
    {} as Record<
      string,
      { addonName: string; items: AddonCatalogEntry["item"][] }
    >,
  );

  const groups = Object.entries(groupedItems);

  // Don't render empty section after loading finishes and no items found
  if (!isLoading && groups.length === 0) return null;

  return (
    <div ref={intersectionRef}>
      {isLoading && items.length === 0 && <CatalogRowSkeleton />}
      {groups.map(([currentAddonId, group], index) => {
        const rowKey = `addon-catalog-${type}-${catalogId || "default"}-${currentAddonId}`;
        const finalTitle = title ? title : `${group.addonName}`;
        const targetAddon = addons.find(
          (a) => a.manifest.id === currentAddonId,
        );
        const targetCatalogId =
          catalogId ??
          (targetAddon?.manifest.catalogs?.find((c) => c.type === type)?.id as
            string | undefined) ??
          "top";
        const moreLink = `/discover/more/addon/${currentAddonId}/${type}/${encodeURIComponent(targetCatalogId)}`;

        return (
          <div
            key={currentAddonId}
            className={classNames(index > 0 ? "mt-4" : "")}
          >
            <div className="flex items-center justify-between ml-2 md:ml-8 mt-2">
              <div className="flex flex-col pl-2 lg:pl-[68px]">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl cursor-default font-bold text-white md:text-2xl pl-0 text-balance">
                    {finalTitle}
                  </h2>
                  <span className="rounded bg-pill-background px-2 py-0.5 text-xs text-type-secondary">
                    {t("addons.catalog.badge", "Addons")}
                  </span>
                </div>
                <Link
                  to={moreLink}
                  className="flex items-center hover:text-type-link transition-colors mt-1"
                >
                  <span className="text-sm">
                    {t("discover.carousel.more", "Xem thêm")}
                  </span>
                  <Icon className="text-sm ml-1" icon={Icons.ARROW_RIGHT} />
                </Link>
              </div>
            </div>

            {/* Content */}
            <div className="relative overflow-hidden carousel-container md:pb-4">
              <div
                ref={(el) => setRef(rowKey, el)}
                className="grid grid-flow-col auto-cols-max gap-4 pt-0 overflow-x-scroll scrollbar-none rounded-xl overflow-y-hidden md:pl-8 md:pr-8"
              >
                <div className="lg:w-12" />
                {group.items.map((item, i) => (
                  <div
                    key={`${currentAddonId}:${item.id}:${i}`}
                    className="relative mt-4 group cursor-pointer user-select-none rounded-xl p-2 bg-transparent transition-colors duration-300 w-[10rem] md:w-[11.5rem] h-auto"
                  >
                    <WatchedMediaCard
                      media={{
                        id: item.id.toString(),
                        title: item.name || "",
                        poster: item.poster || "/placeholder.png",
                        type: type === "series" ? "show" : "movie",
                        releaseQuality: getReleaseQualityVariantFromLabel(
                          item.releaseInfo,
                        ),
                        year: item.year
                          ? parseInt(item.year.toString(), 10)
                          : item.releaseInfo
                            ? parseInt(item.releaseInfo.split("-")[0], 10)
                            : undefined,
                      }}
                      onShowDetails={async () => {
                        const baseMedia: MediaItem = {
                          id: item.id.toString(),
                          title: item.name || "",
                          poster: item.poster || "/placeholder.png",
                          type: type === "series" ? "show" : "movie",
                          releaseQuality: getReleaseQualityVariantFromLabel(
                            item.releaseInfo,
                          ),
                          year: item.year
                            ? parseInt(item.year.toString(), 10)
                            : item.releaseInfo
                              ? parseInt(item.releaseInfo.split("-")[0], 10)
                              : undefined,
                        };
                        let finalId = baseMedia.id;
                        let finalType = baseMedia.type;
                        const identity = getCatalogMediaIdentity(item);
                        if (identity?.kind === "tmdb") {
                          finalId = identity.id;
                        } else if (identity?.kind === "imdb") {
                          const tmdbMedia = await getMediaFromExternalId(
                            identity.id,
                          );
                          if (tmdbMedia) {
                            finalId = tmdbMedia.id;
                            finalType =
                              tmdbMedia.type === "show" ? "show" : "movie";
                          }
                        }
                        onShowDetails?.({
                          ...baseMedia,
                          id: finalId,
                          type: finalType,
                        });
                      }}
                    />
                  </div>
                ))}
                {group.items.length >= 8 && <MoreCard link={moreLink} />}
                <div className="lg:w-12" />
              </div>
              {!isMobile && (
                <CarouselNavButtons
                  categorySlug={rowKey}
                  carouselRefs={internalCarouselRefs}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
