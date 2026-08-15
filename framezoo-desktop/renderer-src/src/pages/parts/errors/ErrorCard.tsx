import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ButtonPlain } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { Modal } from "@/components/overlays/Modal";
import { DisplayError } from "@/components/player/display/displayInterface";
import {
  formatErrorDebugInfo,
  gatherErrorDebugInfo,
} from "@/utils/errorDebugInfo";

export function ErrorCard(props: {
  error: DisplayError | string;
  onClose: () => void;
}) {
  const [hasCopied, setHasCopied] = useState(false);
  const hasCopiedUnsetDebounce = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { t } = useTranslation();

  let errorMessage: string | null = null;
  if (typeof props.error === "string") errorMessage = props.error;
  else if (props.error.key)
    errorMessage = `${props.error.type}: ${t(props.error.key)}`;
  else if (props.error.message)
    errorMessage = `${props.error.type}: ${t(props.error.message)}`;

  function copyError() {
    if (!props.error || !navigator.clipboard) return;

    const debugInfo = gatherErrorDebugInfo(props.error);
    const formattedDebugInfo = formatErrorDebugInfo(debugInfo);

    const fullErrorReport = `\`\`\`\n${errorMessage}\n\n${formattedDebugInfo}\n\`\`\``;

    navigator.clipboard.writeText(fullErrorReport);

    setHasCopied(true);

    // Debounce unsetting the "has copied" label
    if (hasCopiedUnsetDebounce.current)
      clearTimeout(hasCopiedUnsetDebounce.current);
    hasCopiedUnsetDebounce.current = setTimeout(() => setHasCopied(false), 2e3);
  }

  return (
    <div className="bg-errors-card w-full rounded-lg p-4 sm:p-5 text-left border border-white/10 shadow-lg">
      <div className="border-errors-border flex items-center justify-between border-b pb-2">
        <span className="font-medium text-white text-sm sm:text-base">
          {t("errors.details")}
        </span>
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <ButtonPlain
            theme="secondary"
            padding="p-1.5 h-8 min-w-[36px] sm:h-9 sm:px-3"
            onClick={() => copyError()}
          >
            {hasCopied ? (
              <>
                <Icon
                  icon={Icons.CHECKMARK}
                  className="text-xs text-green-400"
                />
                <span className="hidden min-[400px]:inline-block ml-2 text-xs">
                  {t("actions.copied")}
                </span>
              </>
            ) : (
              <>
                <Icon icon={Icons.COPY} className="text-lg" />
                <span className="hidden min-[400px]:inline-block ml-2 text-xs">
                  {t("player.playbackError.copyDebugInfo")}
                </span>
              </>
            )}
          </ButtonPlain>
          <ButtonPlain
            theme="secondary"
            padding="p-1.5 h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center"
            onClick={props.onClose}
          >
            <Icon icon={Icons.X} className="text-lg" />
          </ButtonPlain>
        </div>
      </div>
      <div className="pointer-events-auto mt-3 max-h-36 select-text overflow-y-auto overflow-x-hidden break-words whitespace-pre-wrap rounded bg-black/30 p-2.5 font-mono text-xs leading-relaxed text-white/80 text-left border border-white/5">
        {errorMessage}
      </div>
      <p className="mt-2 text-xs text-white/50">
        {t("player.playbackError.debugInfo")}
      </p>
    </div>
  );
}

// use plain modal version if there is no access to history api (like in error boundary)
export function ErrorCardInPlainModal(props: {
  error?: DisplayError | string;
  onClose: () => void;
  show?: boolean;
}) {
  if (!props.show || !props.error) return null;
  return (
    <div className="fixed inset-0 flex h-full w-full items-center justify-center bg-black bg-opacity-30 p-12">
      <div className="w-full max-w-2xl">
        <ErrorCard error={props.error} onClose={props.onClose} />
      </div>
    </div>
  );
}

export function ErrorCardInModal(props: {
  error?: DisplayError | string;
  id: string;
  onClose: () => void;
}) {
  if (!props.error) return null;

  return (
    <Modal id={props.id}>
      <div className="pointer-events-auto w-11/12 max-w-2xl">
        <ErrorCard error={props.error} onClose={props.onClose} />
      </div>
    </Modal>
  );
}
