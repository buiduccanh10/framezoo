import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useIntersection } from "react-use";

import { SearchBarInput } from "@/components/form/SearchBar";
import { Icon, Icons } from "@/components/Icon";
import { ThinContainer } from "@/components/layout/ThinContainer";
import { useSlashFocus } from "@/components/player/hooks/useSlashFocus";
import { HeroTitle } from "@/components/text/HeroTitle";
import { useIsIOS, useIsMobile, useIsPWA } from "@/hooks/useIsMobile";
import { useIsTV } from "@/hooks/useIsTv";
import { useRandomTranslation } from "@/hooks/useRandomTranslation";
import { useSearchQuery } from "@/hooks/useSearchQuery";

export interface HeroPartProps {
  setIsSticky: (val: boolean) => void;
  searchParams: ReturnType<typeof useSearchQuery>;
  showTitle?: boolean;
  isInFeatured?: boolean;
}

function getTimeOfDay(
  date: Date,
): "night" | "morning" | "day" | "420" | "69" | "halloween" {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month === 4 && day === 20) return "420";
  if (month === 6 && day === 9) return "69";
  if (month === 10 && day === 31) return "halloween";
  const hour = date.getHours();
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 19) return "day";
  return "night";
}

export function HeroPart({
  setIsSticky,
  searchParams,
  showTitle,
  isInFeatured,
}: HeroPartProps) {
  const { t } = useTranslation();
  const { t: randomT } = useRandomTranslation();
  const [search, setSearch, setSearchUnFocus, aiMode, setAiMode] = searchParams;
  const [showBg, setShowBg] = useState(false);
  const { isMobile } = useIsMobile();
  const { isTV } = useIsTV();

  const stickStateChanged = useCallback(
    (isFixed: boolean) => {
      setShowBg(isFixed);
      setIsSticky(isFixed);
    },
    [setIsSticky],
  );

  const isPWA = useIsPWA();
  const isIOS = useIsIOS();
  const isIOSPWA = isIOS && isPWA;

  // Navbar height is 80px (h-20)
  const navbarHeight = 80;
  // Keep the sticky search below the nav on desktop so it doesn't cover nav items.
  const topOffset = isMobile
    ? navbarHeight + (isIOSPWA ? 34 : 0)
    : navbarHeight + 14;

  const time = getTimeOfDay(new Date());
  const title = randomT(`home.titles.${time}`);
  const placeholder = aiMode
    ? t("home.search.aiPlaceholder", {
        defaultValue:
          "Describe what you want to watch (plot, mood, genre, country...)",
      })
    : randomT(`home.search.placeholder`);
  const inputRef = useRef<HTMLInputElement>(null!);
  const location = useLocation();
  useSlashFocus(inputRef);

  useEffect(() => {
    if (location.pathname === "/browse") {
      inputRef.current?.focus();
    }
  }, [location.pathname]);

  const observerRef = useRef<HTMLDivElement>(null!);
  const intersection = useIntersection(observerRef, {
    root: null,
    rootMargin: `-${Math.max(0, topOffset - 1)}px 0px 0px 0px`,
    threshold: 1,
  });

  const isSticky = intersection
    ? !intersection.isIntersecting || intersection.intersectionRatio < 1
    : false;

  useEffect(() => {
    stickStateChanged(isSticky);
  }, [isSticky, stickStateChanged]);

  const aiGuideExamples = useMemo(
    () => [
      {
        id: "plot",
        label: t("home.search.aiGuide.plotLabel", { defaultValue: "Plot" }),
        query: t("home.search.aiGuide.plotQuery", {
          defaultValue:
            "movie about a man with short-term memory loss who tattoos clues to find his wife's killer",
        }),
      },
      {
        id: "similar",
        label: t("home.search.aiGuide.similarLabel", {
          defaultValue: "Similar to",
        }),
        query: t("home.search.aiGuide.similarQuery", {
          defaultValue:
            "Korean psychological thriller with a plot twist like Parasite",
        }),
      },
      {
        id: "mood",
        label: t("home.search.aiGuide.moodLabel", { defaultValue: "Mood" }),
        query: t("home.search.aiGuide.moodQuery", {
          defaultValue: "emotional time-travel anime that makes you cry",
        }),
      },
      {
        id: "era",
        label: t("home.search.aiGuide.eraLabel", {
          defaultValue: "Country & era",
        }),
        query: t("home.search.aiGuide.eraQuery", {
          defaultValue: "90s Hong Kong action comedy",
        }),
      },
    ],
    [t],
  );

  return (
    <ThinContainer>
      <div
        className={classNames(
          "space-y-16 text-center",
          showTitle ? "mt-44" : "mt-4",
        )}
      >
        {showTitle && (!isTV || search.length === 0) ? (
          <div className="relative z-10 mb-16">
            <HeroTitle className="mx-auto max-w-md">{title}</HeroTitle>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="relative h-20 z-30">
            <div
              ref={observerRef}
              className="absolute inset-x-0 -top-[1px] h-[1px]"
            />
            <div
              className="sticky"
              style={{
                top: `${topOffset}px`,
              }}
            >
              <SearchBarInput
                ref={inputRef}
                onChange={setSearch}
                value={search}
                onUnFocus={setSearchUnFocus}
                placeholder={placeholder ?? ""}
                isSticky={showBg}
                isInFeatured={isInFeatured}
                aiMode={aiMode}
                onAiModeChange={setAiMode}
              />
            </div>
          </div>

          {aiMode && !search.trim() ? (
            <div className="mx-auto max-w-2xl space-y-2.5 pt-1 text-center">
              <p className="inline-flex items-center justify-center gap-1.5 text-xs text-white/65">
                <Icon
                  icon={Icons.AI_SPARKLES}
                  className="text-xs text-type-logo"
                />
                <span>
                  {t("home.search.aiGuide.title", {
                    defaultValue:
                      "Try natural-language search by plot, similar titles, mood, or era:",
                  })}
                </span>
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {aiGuideExamples.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    onClick={() => {
                      setSearch(example.query, true);
                      inputRef.current?.focus();
                    }}
                    className="group inline-flex max-w-full items-baseline gap-1.5 rounded-2xl border border-white/10 bg-search-background/75 px-3 py-1.5 text-left text-xs leading-snug transition-colors duration-200 hover:border-type-logo/60 hover:bg-search-background"
                  >
                    <span className="shrink-0 font-semibold text-type-logo">
                      {example.label}:
                    </span>
                    <span className="text-white/80 group-hover:text-white">
                      {example.query}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </ThinContainer>
  );
}
