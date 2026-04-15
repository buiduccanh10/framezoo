import { useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { MwLink } from "@/components/text/Link";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { Heading1 } from "@/components/utils/Text";
import { conf } from "@/setup/config";
import { usePreferencesStore } from "@/stores/preferences";

interface TIDBKeyProps {
  tidbKey: string | null;
  setTIDBKey: (value: string | null) => void;
}

export function TIDBEdit({ tidbKey, setTIDBKey }: TIDBKeyProps) {
  const { t } = useTranslation();
  const config = conf();
  const preferences = usePreferencesStore();
  const initializedRef = useRef(false);

  // Enable TIDB key when component loads
  useEffect(() => {
    if (!initializedRef.current && tidbKey === null && preferences.tidbKey) {
      initializedRef.current = true;
      setTIDBKey(preferences.tidbKey);
    }
  }, [tidbKey, preferences.tidbKey, setTIDBKey]);

  const isEnvSet = !!config.TIDB_API_KEY;
  return (
    <SettingsCard>
      <div className="my-3">
        <p className="text-white font-bold mb-3">TheIntroDB</p>
        <p className="max-w-[40rem] font-medium mb-6">
          <Trans i18nKey="settings.connections.tidb.description">
            <MwLink to="https://theintrodb.org/" />
          </Trans>
        </p>
        <p className="text-white font-bold mb-3">
          {t("settings.connections.tidb.tokenLabel")}
        </p>
        <div className="flex items-center w-full">
          {isEnvSet ? (
            <div className="flex-grow p-4 rounded-lg bg-authentication-inputBg border border-type-success/50 text-type-success flex items-center gap-2">
              <Icon icon={Icons.CHECKMARK} />
              <span>
                {t(
                  "settings.connections.tidb.envSet",
                  "API Key is set via environment variable",
                )}
              </span>
            </div>
          ) : (
            <AuthInputBox
              onChange={(newToken) => {
                setTIDBKey(newToken);
              }}
              value={tidbKey ?? ""}
              placeholder="theintrodb:user..."
              passwordToggleable
              className="flex-grow"
            />
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

export function ConnectionsPart(props: TIDBKeyProps) {
  const { t } = useTranslation();
  return (
    <div>
      <Heading1 border>{t("settings.connections.title")}</Heading1>
      <div className="space-y-6">
        <TIDBEdit tidbKey={props.tidbKey} setTIDBKey={props.setTIDBKey} />
      </div>
    </div>
  );
}
