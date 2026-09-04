import { useCallback, useMemo } from "react";
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

type DeviceType = "desktop" | "mobile" | "tablet";

type DeviceMetadata = {
  browser: string;
  operatingSystem: string;
  type: DeviceType;
};

function getVersion(userAgent: string, pattern: RegExp) {
  return userAgent.match(pattern)?.[1]?.replace(/_/g, ".") ?? null;
}

function getDeviceMetadata(userAgent: string): DeviceMetadata {
  const ua = userAgent ?? "";
  const isTablet = /iPad|Tablet/i.test(ua);
  const isMobile =
    !isTablet && /Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua);
  const type: DeviceType = isTablet
    ? "tablet"
    : isMobile
      ? "mobile"
      : "desktop";

  let operatingSystem = "";
  if (/Windows NT 10\.0/i.test(ua)) operatingSystem = "Windows 10/11";
  else if (/Windows NT 6\.3/i.test(ua)) operatingSystem = "Windows 8.1";
  else if (/Windows NT 6\.2/i.test(ua)) operatingSystem = "Windows 8";
  else if (/Windows NT 6\.1/i.test(ua)) operatingSystem = "Windows 7";
  else if (/Windows NT/i.test(ua)) operatingSystem = "Windows";
  else if (/CrOS/i.test(ua)) operatingSystem = "ChromeOS";
  else if (/Android/i.test(ua)) {
    const version = getVersion(ua, /Android[ /]([\d._]+)/i);
    operatingSystem = version ? `Android ${version}` : "Android";
  } else if (/iPad|iPhone|iPod/i.test(ua)) {
    const version = getVersion(ua, /OS ([\d_]+)/i);
    operatingSystem = version ? `iOS ${version}` : "iOS";
  } else if (/Macintosh|Mac OS X|macOS/i.test(ua)) {
    operatingSystem = "macOS";
  } else if (/Linux/i.test(ua)) {
    operatingSystem = "Linux";
  }

  let browser = "";
  let browserVersion: string | null = null;
  if (/Electron\//i.test(ua)) {
    browser = "Framezoo Desktop";
    browserVersion = getVersion(ua, /Electron\/([\d.]+)/i);
  } else if (/Edg\//i.test(ua)) {
    browser = "Edge";
    browserVersion = getVersion(ua, /Edg\/([\d.]+)/i);
  } else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) {
    browser = "Opera";
    browserVersion = getVersion(ua, /(?:OPR|Opera)[ /]([\d.]+)/i);
  } else if (/CriOS\//i.test(ua)) {
    browser = "Chrome";
    browserVersion = getVersion(ua, /CriOS\/([\d.]+)/i);
  } else if (/Chrome\//i.test(ua)) {
    browser = "Chrome";
    browserVersion = getVersion(ua, /Chrome\/([\d.]+)/i);
  } else if (/FxiOS\//i.test(ua)) {
    browser = "Firefox";
    browserVersion = getVersion(ua, /FxiOS\/([\d.]+)/i);
  } else if (/Firefox\//i.test(ua)) {
    browser = "Firefox";
    browserVersion = getVersion(ua, /Firefox\/([\d.]+)/i);
  } else if (/Safari\//i.test(ua)) {
    browser = "Safari";
    browserVersion = getVersion(ua, /Version\/([\d.]+)/i);
  }

  return {
    browser: browserVersion ? `${browser} ${browserVersion}` : browser,
    operatingSystem,
    type,
  };
}

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
  browser: string;
  operatingSystem: string;
  type: DeviceType;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const url = useBackendUrl();
  const account = useAuthStore((s) => s.account);
  const [result, exec] = useAsyncFn(async () => {
    if (!account) throw new Error("No account present");
    if (!url) throw new Error("No backend set");
    await Promise.all(props.ids.map((id) => removeSession(url, account, id)));
    props.onRemove?.();
  }, [url, account, props.ids]);

  return (
    <SettingsCard
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      paddingClass="px-6 py-5"
    >
      <div className="min-w-0 font-medium">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SecondaryLabel>
            {t("settings.account.devices.deviceNameLabel")}
          </SecondaryLabel>
          {props.isCurrent ? (
            <span className="inline-flex items-center rounded-full bg-type-link/20 px-2.5 py-1 text-xs font-semibold text-type-link">
              {t("settings.account.devices.thisDevice")}
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-white">{props.name}</p>
        <p className="mt-2 text-sm text-gray-300">
          {props.browser} · {props.operatingSystem} ·{" "}
          {t(`settings.account.devices.types.${props.type}`)}
        </p>
        {(props.createdAt || props.accessedAt) && (
          <div className="mt-2 space-y-1 text-xs text-gray-400">
            {props.accessedAt ? (
              <p>
                {t("settings.account.devices.lastActive", {
                  date: new Date(props.accessedAt).toLocaleString(),
                })}
              </p>
            ) : null}
            {props.createdAt ? (
              <p>
                {t("settings.account.devices.loggedInAt", {
                  date: new Date(props.createdAt).toLocaleString(),
                })}
              </p>
            ) : null}
          </div>
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

  const getDeviceInfo = useCallback(
    (session: SessionResponse, deviceSeed: string) => {
      let decryptedName: string | null = null;
      try {
        decryptedName = decryptData(session.device, base64ToBuffer(deviceSeed));
      } catch (error) {
        console.warn(
          `Failed to decrypt device name for session ${session.id}:`,
          error,
        );
      }

      const metadata = getDeviceMetadata(session.userAgent);
      const browser =
        metadata.browser || t("settings.account.devices.unknownBrowser");
      const operatingSystem =
        metadata.operatingSystem ||
        t("settings.account.devices.unknownOperatingSystem");
      const name =
        decryptedName && decryptedName !== "Browser"
          ? decryptedName
          : session.userAgent
            ? `${browser} · ${operatingSystem}`
            : t("settings.account.devices.unknownDevice");

      return { name, ...metadata, browser, operatingSystem };
    },
    [t],
  );

  const deviceListSorted = useMemo(() => {
    if (!seed) return [];
    const groups = new Map<
      string,
      {
        current: boolean;
        ids: string[];
        name: string;
        browser: string;
        operatingSystem: string;
        type: DeviceType;
        createdAt?: string;
        accessedAt?: string;
      }
    >();

    sessions.forEach((session) => {
      const deviceInfo = getDeviceInfo(session, seed);
      const key = `${deviceInfo.name}__${session.userAgent}`;
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
          name: deviceInfo.name,
          browser: deviceInfo.browser,
          operatingSystem: deviceInfo.operatingSystem,
          type: deviceInfo.type,
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
  }, [seed, sessions, currentSessionId, getDeviceInfo]);
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
              browser={session.browser}
              operatingSystem={session.operatingSystem}
              type={session.type}
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
