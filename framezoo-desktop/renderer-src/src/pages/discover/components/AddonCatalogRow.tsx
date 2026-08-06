import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getMediaFromExternalId } from "@/backend/metadata/tmdb";
import { WatchedMediaCard } from "@/components/media/WatchedMediaCard";
import {
  type AddonCatalogEntry,
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
  /** Human-readable section title override. Falls back to "From your addons" */
  title?: string;
  carouselRefs?: React.MutableRefObject<{
    [key: string]: HTMLDivElement | null;
  }>;
  onShowDetails?: (media: MediaItem) => void;
}

function CatalogRowSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="w-[10rem] md:w-[11.5rem] flex-shrink-0 rounded-xl bg-mediaCard-hoverBackground/30 animate-pulse"
          style={{ height: "17rem" }}
        />
      ))}
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
  title,
  carouselRefs,
  onShowDetails,
}: AddonCatalogRowProps) {
  const { t } = useTranslation();
  const addons = useInstalledAddons();
  // const scrollRef = useRef<HTMLDivElement>(null);
  const { ref: intersectionRef, hasIntersected } =
    useIntersectionObserver<HTMLDivElement>({
      threshold: 0.1,
      rootMargin: "50px",
    });

  const [items, setItems] = useState<AddonCatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasIntersected) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    loadAllAddonCatalogs(addons, type, catalogId)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        if (result.items.length === 0 && result.errors.length > 0) {
          setError(result.errors[0].message);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasIntersected, addons, type, catalogId]);

  // Register carousel ref for external scroll control
  // Use an internal MutableRefObject so CarouselNavButtons can call .current[key]
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
    return <div ref={intersectionRef} className="h-[20rem]" />;
  }

  // Don't render empty section after loading finishes
  if (!isLoading && items.length === 0 && !error) return null;

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

  return (
    <div ref={intersectionRef}>
      {isLoading && <CatalogRowSkeleton />}
      {error && (
        <p className="text-sm text-type-secondary px-4 md:px-[3.25rem] lg:px-[6.25rem] py-4">
          {error}
        </p>
      )}
      {!isLoading &&
        !error &&
        groups.map(([addonId, group], index) => {
          const rowKey = `addon-catalog-${type}-${catalogId || "default"}-${addonId}`;
          const finalTitle = title ? title : `${group.addonName}`;

          return (
            <div key={addonId} className={classNames(index > 0 ? "mt-4" : "")}>
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
                      key={`${addonId}:${item.id}:${i}`}
                      className="relative mt-4 group cursor-pointer user-select-none rounded-xl p-2 bg-transparent transition-colors duration-300 w-[10rem] md:w-[11.5rem] h-auto"
                    >
                      <WatchedMediaCard
                        media={{
                          id: item.id.toString(),
                          title: item.name || "",
                          poster: item.poster || "/placeholder.png",
                          type: type === "series" ? "show" : "movie",
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
                            year: item.year
                              ? parseInt(item.year.toString(), 10)
                              : item.releaseInfo
                                ? parseInt(item.releaseInfo.split("-")[0], 10)
                                : undefined,
                          };
                          let finalId = baseMedia.id;
                          if (
                            finalId.startsWith("tt") ||
                            finalId.startsWith("tmdb:")
                          ) {
                            const extId =
                              finalId.split(":")[1] &&
                              finalId.startsWith("tmdb:")
                                ? finalId.split(":")[1]
                                : finalId.split(":")[0];
                            const tmdbMedia =
                              await getMediaFromExternalId(extId);
                            if (tmdbMedia) {
                              finalId = tmdbMedia.id;
                            }
                          }
                          onShowDetails?.({
                            ...baseMedia,
                            id: finalId,
                          });
                        }}
                      />
                    </div>
                  ))}
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
