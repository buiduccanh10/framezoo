import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { SessionResponse } from "@/backend/accounts/auth";
import { base64ToBuffer, decryptData } from "@/backend/accounts/crypto";
import { removeSession } from "@/backend/accounts/sessions";
import { Button } from "@/components/buttons/Button";
import { Loading } from "@/components/layout/Loading";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { SecondaryLabel } from "@/components/text/SecondaryLabel";
import { Heading2 } from "@/components/utils/Text";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useAuthStore } from "@/stores/auth";

export const signOutAllDevices = () => {
  const buttons = document.querySelectorAll(".logout-button");

  buttons.forEach((button) => {
    (button as HTMLElement).click();
  });
};

export function Device(props: {
  name: string;
  ids: string[];
  isCurrent?: boolean;
  createdAt?: string;
  accessedAt?: string;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const url = useBackendUrl();
  const token = useAuthStore((s) => s.account?.token);
  const [result, exec] = useAsyncFn(async () => {
    if (!token) throw new Error("No token present");
    if (!url) throw new Error("No backend set");
    await Promise.all(props.ids.map((id) => removeSession(url, token, id)));
    props.onRemove?.();
  }, [url, token, props.ids]);

  return (
    <SettingsCard
      className="flex justify-between items-center"
      paddingClass="px-6 py-4"
    >
      <div className="font-medium">
        <SecondaryLabel>
          {t("settings.account.devices.deviceNameLabel")}
        </SecondaryLabel>
        <p className="text-white">{props.name}</p>
        {(props.createdAt || props.accessedAt) && (
          <p className="text-xs text-gray-400 mt-1">
            {props.accessedAt
              ? t("settings.account.devices.lastActive", {
                  date: new Date(props.accessedAt).toLocaleString(),
                })
              : t("settings.account.devices.loggedInAt", {
                  date: new Date(props.createdAt as string).toLocaleString(),
                })}
          </p>
        )}
      </div>
      {!props.isCurrent ? (
        <Button
          theme="danger"
          className="logout-button"
          loading={result.loading}
          onClick={exec}
        >
          {t("settings.account.devices.removeDevice")}
        </Button>
      ) : null}
    </SettingsCard>
  );
}

export function DeviceListPart(props: {
  loading?: boolean;
  error?: boolean;
  sessions: SessionResponse[];
  onChange?: () => void;
}) {
  const { t } = useTranslation();
  const seed = useAuthStore((s) => s.account?.seed);
  const sessions = props.sessions;
  const currentSessionId = useAuthStore((s) => s.account?.sessionId);

  const getDeviceLabel = (
    session: SessionResponse,
    deviceSeed: string,
  ): string => {
    let decryptedName: string | null = null;
    try {
      decryptedName = decryptData(session.device, base64ToBuffer(deviceSeed));
    } catch (error) {
      console.warn(
        `Failed to decrypt device name for session ${session.id}:`,
        error,
      );
    }

    const ua = session.userAgent ?? "";
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);

    let os = "Unknown OS";
    if (/Windows NT 10\.0/.test(ua)) os = "Windows 10";
    else if (/Windows NT 11\.0/.test(ua)) os = "Windows 11";
    else if (/Mac OS X 10[._]\d+/.test(ua) || /Macintosh/.test(ua))
      os = "macOS";
    else if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Linux/.test(ua)) os = "Linux";

    let browser = "Browser";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = "Opera";
    else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = "Safari";
    else if (/Firefox\//.test(ua)) browser = "Firefox";

    const baseLabel = isMobile
      ? `${browser} · ${os} (mobile)`
      : `${browser} · ${os}`;

    if (decryptedName && decryptedName !== "Browser") {
      return `${decryptedName} · ${baseLabel}`;
    }

    if (!ua && !decryptedName) {
      return t("settings.account.devices.unknownDevice");
    }

    return baseLabel;
  };

  const deviceListSorted = useMemo(() => {
    if (!seed) return [];
    const groups = new Map<
      string,
      {
        current: boolean;
        ids: string[];
        name: string;
        createdAt?: string;
        accessedAt?: string;
      }
    >();

    sessions.forEach((session) => {
      const label = getDeviceLabel(session, seed);
      const key = `${label}__${session.userAgent}`;
      const existing = groups.get(key);

      if (existing) {
        existing.ids.push(session.id);
        if (session.id === currentSessionId) {
          existing.current = true;
        }
        if (
          new Date(session.accessedAt) >
          new Date(existing.accessedAt ?? existing.createdAt ?? 0)
        ) {
          existing.accessedAt = session.accessedAt;
        }
      } else {
        groups.set(key, {
          current: session.id === currentSessionId,
          ids: [session.id],
          name: label,
          createdAt: session.createdAt,
          accessedAt: session.accessedAt,
        });
      }
    });

    const list = Array.from(groups.values()).sort((a, b) => {
      if (a.current) return -1;
      if (b.current) return 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [seed, sessions, currentSessionId, t]);
  if (!seed) return null;

  return (
    <div>
      <Heading2 border className="mt-0 mb-9">
        {t("settings.account.devices.title")}
      </Heading2>
      {props.loading ? (
        <Loading />
      ) : props.error && deviceListSorted.length === 0 ? (
        <p>{t("settings.account.devices.failed")}</p>
      ) : (
        <div className="space-y-5">
          {deviceListSorted.map((session) => (
            <Device
              name={session.name}
              ids={session.ids}
              createdAt={session.createdAt}
              accessedAt={session.accessedAt}
              key={session.ids.join(",")}
              isCurrent={session.current}
              onRemove={props.onChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
