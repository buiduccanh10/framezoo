import classNames from "classnames";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { Menu } from "@/components/player/internals/ContextMenu";
import {
  makeQueId,
  sanitize,
  tryParseCanonicalVtt,
} from "@/components/player/utils/captions";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { useToastStore } from "@/stores/interface/toast";
import { usePlayerStore } from "@/stores/player/store";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

import type { SubtitleSelectionMode } from "./CaptionsView";

function formatVttMs(ms: number) {
  const date = new Date(ms);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  const milliseconds = date.getUTCMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  return `${minutes}:${seconds}`;
}

const MOONSHINE_AUDIO_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "zh", label: "Mandarin" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "vi", label: "Vietnamese" },
  { code: "uk", label: "Ukrainian" },
  { code: "ar", label: "Arabic" },
] as const;

export function SyncSubtitleView({
  id,
  selectionMode = "primary",
}: {
  id: string;
  selectionMode?: SubtitleSelectionMode;
}) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const primaryCaption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const setCaption = usePlayerStore((s) => s.setCaption);
  const setSecondaryCaption = usePlayerStore((s) => s.setSecondaryCaption);
  const showToast = useToastStore((s) => s.showToast);
  const { syncSelectedCaption, canSyncSelectedCaption } = useCaptions();
  const timeDuration = usePlayerStore((s) => s.progress.duration);

  const activeCaption =
    selectionMode === "secondary" ? secondaryCaption : primaryCaption;

  const [isSyncCooldown, setIsSyncCooldown] = useState(false);
  const [selectedAnchorIndex, setSelectedAnchorIndex] = useState<number>(0);

  const parsedCaptions = useMemo(
    () => tryParseCanonicalVtt(activeCaption?.vttData),
    [activeCaption],
  );

  const showHours = useMemo(() => {
    const subtitleDuration =
      (parsedCaptions[parsedCaptions.length - 1]?.end ?? 0) / 1000;
    return durationExceedsHour(Math.max(timeDuration, subtitleDuration));
  }, [parsedCaptions, timeDuration]);

  const transcriptItems = useMemo(
    () =>
      parsedCaptions.slice(0, 10).map((cue, i) => {
        const html = sanitize((cue.content || "").replaceAll(/\r?\n/g, " "), {
          ALLOWED_TAGS: ["c", "b", "i", "u", "span", "ruby", "rt", "br"],
          ADD_TAGS: ["v", "lang"],
          ALLOWED_ATTR: ["title", "lang"],
        });
        return {
          key: makeQueId(i, cue.start, cue.end),
          originalIndex: i,
          cue,
          html,
        };
      }),
    [parsedCaptions],
  );

  const handleConfirmSync = async () => {
    if (isSyncCooldown) return;
    setIsSyncCooldown(true);

    if (activeCaption && selectedAnchorIndex > 0) {
      const cuesToKeep = parsedCaptions.slice(selectedAnchorIndex);
      const newVttText =
        "WEBVTT\n\n" +
        cuesToKeep
          .map(
            (c) =>
              `${formatVttMs(c.start)} --> ${formatVttMs(c.end)}\n${c.content}`,
          )
          .join("\n\n");

      if (selectionMode === "primary") {
        setCaption({ ...activeCaption, vttData: newVttText });
      } else {
        setSecondaryCaption({ ...activeCaption, vttData: newVttText });
      }

      // Wait a tick for Zustand to update
      await new Promise((r) => setTimeout(r, 0));
    }

    router.close();

    try {
      const outcome = await syncSelectedCaption();
      if (outcome.status === "success") {
        if (outcome.warningMessage) {
          showToast(
            t("player.menus.subtitles.syncSubtitleServerFallback", {
              defaultValue:
                "Local sync does not support this audio language; synced using server.",
            }),
            "info",
          );
          return;
        }
        showToast(
          t("player.menus.subtitles.syncSubtitleSuccess", {
            defaultValue: "Subtitle synced successfully",
          }),
          "success",
        );
        return;
      }
      if (outcome.status === "cancelled") return;

      const isRateLimit =
        Boolean(outcome.errorMessage) &&
        /rate limit|too many|429/i.test(outcome.errorMessage!);
      const isServerBusy =
        Boolean(outcome.errorMessage) &&
        /capacity|busy|503/i.test(outcome.errorMessage!);

      let detail = outcome.errorMessage;
      if (isRateLimit) {
        detail = t("player.menus.subtitles.syncRateLimit");
      } else if (isServerBusy) {
        detail = t("player.menus.subtitles.syncServerBusy");
      }

      showToast(
        detail
          ? t("player.menus.subtitles.syncSubtitleFailedWithDetail", {
              defaultValue: "Could not sync subtitle: {{detail}}",
              detail,
            })
          : t("player.menus.subtitles.syncSubtitleFailed", {
              defaultValue: "Could not sync subtitle",
            }),
        "error",
      );
    } finally {
      setTimeout(() => {
        setIsSyncCooldown(false);
      }, 3000);
    }
  };

  return (
    <>
      <Menu.BackLink onClick={() => router.navigate("/captions/transcript")}>
        <span className="flex min-w-0 items-center gap-2">
          {t("player.menus.subtitles.syncSubtitleConfirmTitle", {
            defaultValue: "Sync subtitle with AI",
          })}
        </span>
      </Menu.BackLink>
      <Menu.Section>
        <div className="flex flex-col gap-4 p-2 pb-0 pt-1">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs uppercase tracking-wide text-video-context-type-secondary">
              {t("player.menus.subtitles.syncSubtitleSupportedLanguages", {
                defaultValue: "Supported audio languages",
              })}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-video-context-type-main">
              {MOONSHINE_AUDIO_LANGUAGES.map((language, index) => (
                <span key={language.code}>
                  {index > 0 ? ", " : ""}
                  {language.label}
                </span>
              ))}
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-sm font-medium text-white mb-1">
              {t("player.menus.subtitles.syncSubtitleSelectAnchor", {
                defaultValue:
                  "To increase accuracy, which is the first dialogue in the video?",
              })}
            </p>
            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto pr-1">
              {transcriptItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedAnchorIndex(item.originalIndex)}
                  className={classNames(
                    "group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150",
                    selectedAnchorIndex === item.originalIndex
                      ? "bg-video-context-light/20 text-white shadow-sm"
                      : "text-video-context-type-main hover:bg-white/10 hover:text-white",
                  )}
                >
                  <span
                    className={classNames(
                      "flex-none h-6 px-1.5 flex items-center justify-center rounded text-xs font-mono whitespace-nowrap transition-colors",
                      selectedAnchorIndex === item.originalIndex
                        ? "bg-white/20 text-white font-semibold"
                        : "bg-video-context-light/20 text-video-context-type-secondary group-hover:text-white group-hover:bg-white/15",
                      showHours ? "min-w-[4.25rem]" : "min-w-[3.25rem]",
                    )}
                  >
                    {item.cue.start < 0 || !Number.isFinite(item.cue.start)
                      ? "N/A"
                      : formatSeconds(item.cue.start / 1000, showHours)}
                  </span>
                  <span
                    className={
                      selectedAnchorIndex === item.originalIndex
                        ? "flex-1 min-w-0 break-words text-white font-semibold text-sm leading-snug py-0.5"
                        : "flex-1 min-w-0 break-words text-video-context-type-main text-sm leading-snug py-0.5 hover:text-white transition-colors"
                    }
                  >
                    <span
                      dangerouslySetInnerHTML={{ __html: item.html }}
                      dir="ltr"
                    />
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Button
            theme="purple"
            className="w-full mt-1"
            onClick={() => void handleConfirmSync()}
            disabled={!canSyncSelectedCaption}
          >
            {t("player.menus.subtitles.syncSubtitleAction", {
              defaultValue: "Sync",
            })}
          </Button>
        </div>
      </Menu.Section>
    </>
  );
}
