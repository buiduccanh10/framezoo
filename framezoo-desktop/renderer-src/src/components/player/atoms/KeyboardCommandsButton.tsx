import { useTranslation } from "react-i18next";

import { Icons } from "@/components/Icon";
import { useOverlayStack } from "@/stores/interface/overlayStack";

import { VideoPlayerButton } from "../internals/Button";

export function KeyboardCommandsButton() {
  const { t } = useTranslation();
  const showModal = useOverlayStack((s) => s.showModal);

  return (
    <VideoPlayerButton
      icon={Icons.KEYBOARD}
      iconSizeClass="text-base"
      className="p-2"
      onClick={() => showModal("keyboard-commands")}
      aria-label={t("global.keyboardShortcuts.title")}
      title={t("global.keyboardShortcuts.subtitle")}
    />
  );
}
