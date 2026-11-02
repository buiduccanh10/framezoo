import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { usePlayerStore } from "@/stores/player/store";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

export function DualSubtitlesView({ id }: { id: string }) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const primaryCaption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const dualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);

  const languageName = (language?: string) =>
    language
      ? (getPrettyLanguageNameFromLocale(language) ?? language)
      : t("player.menus.subtitles.offChoice");

  return (
    <Menu.Card>
      <Menu.BackLink onClick={() => router.navigate("/captions")}>
        {t("player.menus.subtitles.dualSub")}
      </Menu.BackLink>
      <Menu.Section>
        <p className="mb-2 px-1 text-xs leading-relaxed text-video-context-type-secondary">
          {t("player.menus.subtitles.dualSubSelectHint", {
            defaultValue:
              "Choose a primary and secondary subtitle. Dual subtitles turn on automatically.",
          })}
        </p>
        <Menu.ChevronLink
          onClick={() => router.navigate("/captions/dual/primary")}
        >
          <span className="flex min-w-0 flex-col">
            <span>{t("player.menus.subtitles.primary")}</span>
            <span className="mt-0.5 text-xs text-video-context-type-secondary">
              {primaryCaption
                ? languageName(primaryCaption.language)
                : t("player.menus.subtitles.offChoice")}
            </span>
          </span>
        </Menu.ChevronLink>
        <Menu.ChevronLink
          onClick={() => router.navigate("/captions/dual/secondary")}
        >
          <span className="flex min-w-0 flex-col">
            <span>{t("player.menus.subtitles.secondary")}</span>
            <span className="mt-0.5 text-xs text-video-context-type-secondary">
              {secondaryCaption
                ? languageName(secondaryCaption.language)
                : t("player.menus.subtitles.offChoice")}
            </span>
          </span>
        </Menu.ChevronLink>
      </Menu.Section>
      {dualSubEnabled && (
        <Menu.Section>
          <div className="flex items-center gap-2 px-1 text-xs text-video-context-type-accent">
            <Icon icon={Icons.CIRCLE_CHECK} className="text-sm" />
            {t("player.menus.subtitles.dualSubEnabled", {
              defaultValue: "Dual subtitles enabled",
            })}
          </div>
        </Menu.Section>
      )}
    </Menu.Card>
  );
}
