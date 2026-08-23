import classNames from "classnames";
import { useTranslation } from "react-i18next";

import { resolvePublicUrl } from "@/utils/publicUrl";

export interface MediaPlaceholderProps {
  className?: string;
  text?: string;
}

export function MediaPlaceholder({ className, text }: MediaPlaceholderProps) {
  const { t } = useTranslation();
  const displayText =
    text ??
    t("media.cannotFetchImage", "Could not fetch an image for this media");

  return (
    <div
      className={classNames(
        "absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-mediaCard-hoverBackground select-none",
        className,
      )}
    >
      <img
        src={resolvePublicUrl("/placeholder.png") ?? "/placeholder.png"}
        alt=""
        aria-hidden="true"
        className="w-16 sm:w-20 h-auto max-w-[60%] object-contain mb-3 opacity-90 pointer-events-none"
      />
      <p className="text-xs font-medium text-type-secondary leading-snug max-w-[12rem]">
        {displayText}
      </p>
    </div>
  );
}
