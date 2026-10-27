import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Icon, Icons } from "@/components/Icon";

export function BackLink(props: { url: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center">
      <Link
        to={props.url}
        aria-label={t("player.back.default")}
        title={t("player.back.default")}
        className="tabbable flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 text-lg text-white/80 ring-1 ring-white/10 transition-colors duration-200 hover:bg-white/20 hover:text-white hover:ring-white/20"
      >
        <Icon icon={Icons.ARROW_LEFT} />
      </Link>
    </div>
  );
}
