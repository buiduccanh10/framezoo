import { useTranslation } from "react-i18next";

import { Loading } from "@/components/layout/Loading";
import { LargeTextPart } from "@/pages/parts/util/LargeTextPart";

export function MigrationPart() {
  const { t } = useTranslation();
  return (
    <LargeTextPart iconSlot={<Loading />}>
      {t("screens.migration.inProgress")}
    </LargeTextPart>
  );
}

