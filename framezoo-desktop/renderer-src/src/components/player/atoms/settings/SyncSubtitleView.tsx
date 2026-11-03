import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { useToastStore } from "@/stores/interface/toast";

import type { SubtitleSelectionMode } from "./CaptionsView";

export function SyncSubtitleView({
  id,
  selectionMode: _selectionMode = "primary",
}: {
  id: string;
  selectionMode?: SubtitleSelectionMode;
}) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const showToast = useToastStore((s) => s.showToast);
  const { syncSelectedCaption, canSyncSelectedCaption } = useCaptions();

  const [isSyncCooldown, setIsSyncCooldown] = useState(false);

  const handleConfirmSync = async () => {
    if (isSyncCooldown) return;
    setIsSyncCooldown(true);
    router.close();

    try {
      const outcome = await syncSelectedCaption();
      if (outcome.status === "success") {
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
      } else if (
        detail &&
        (detail.includes("Failed to fetch") ||
          detail.includes("NetworkError") ||
          detail.includes("Network request failed") ||
          detail.includes("<no response>"))
      ) {
        detail = t("player.menus.subtitles.syncNetworkError", {
          defaultValue: "Network connection failed",
        });
      } else if (detail && detail.length > 100) {
        detail = undefined; // Hide overly verbose errors
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
          {t("player.menus.subtitles.autoSyncTitle", {
            defaultValue: "Auto sync",
          })}
        </span>
      </Menu.BackLink>
      <Menu.Section>
        <div className="flex flex-col gap-4 p-2 pb-0 pt-1">
          <div className="rounded-xl border border-video-context-type-accent/35 bg-video-context-type-accent/10 p-3.5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-video-context-type-accent/20 text-video-context-type-accent">
                <Icon icon={Icons.WAND} className="text-xl" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-white">
                    {t("player.menus.subtitles.autoSyncTitle", {
                      defaultValue: "Auto sync",
                    })}
                  </p>
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-video-context-type-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-video-context-type-accent">
                    {t("player.menus.subtitles.autoSyncBadge", {
                      defaultValue: "AI",
                    })}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-video-context-type-secondary">
                  {t("player.menus.subtitles.autoSyncDescription", {
                    defaultValue:
                      "Match subtitles to the spoken dialogue automatically",
                  })}
                </p>
              </div>
            </div>
          </div>

          <Button
            theme="purple"
            className="!mt-0 h-11 w-full gap-2 !bg-video-context-type-accent hover:!bg-video-context-type-accent/85"
            onClick={() => void handleConfirmSync()}
            disabled={!canSyncSelectedCaption || isSyncCooldown}
          >
            <Icon icon={Icons.WAND} className="text-base" />
            {t("player.menus.subtitles.autoSyncAction", {
              defaultValue: "Auto sync",
            })}
          </Button>

          <div className="flex items-start gap-1.5 px-1 text-video-context-type-secondary">
            <Icon
              icon={Icons.CIRCLE_EXCLAMATION}
              className="mt-0.5 shrink-0 text-xs"
            />
            <p className="text-xs leading-5">
              {t("player.menus.subtitles.syncSubtitleNoticeDescription", {
                defaultValue:
                  "Subtitle sync may take some time depending on your download speed to retrieve enough audio samples for alignment.",
              })}
            </p>
          </div>
        </div>
      </Menu.Section>
    </>
  );
}
