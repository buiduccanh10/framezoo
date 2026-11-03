import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { SessionResponse } from "@/backend/accounts/auth";
import {
  base64ToBuffer,
  decryptData,
  encryptData,
} from "@/backend/accounts/crypto";
import { removeSession, updateSession } from "@/backend/accounts/sessions";
import { Button } from "@/components/buttons/Button";
import { Loading } from "@/components/layout/Loading";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { Heading2 } from "@/components/utils/Text";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useAuthStore } from "@/stores/auth";
import { getClientDeviceName } from "@/utils/deviceName";

type DeviceType = "desktop" | "mobile" | "tablet";

type DeviceMetadata = {
  browser: string;
  baseBrowser: string;
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
    browserVersion = getVersion(ua, /Framezoo\/([\d.]+)/i);
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
    baseBrowser: browser,
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

function DeviceIcon(props: { type: DeviceType }) {
  if (props.type === "mobile") {
    return (
      <svg
        className="h-5 w-5 text-gray-300"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  }
  if (props.type === "tablet") {
    return (
      <svg
        className="h-5 w-5 text-gray-300"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
        <line x1="12" x2="12.01" y1="18" y2="18" />
      </svg>
    );
  }
  return (
    <svg
      className="h-5 w-5 text-gray-300"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16" />
    </svg>
  );
}

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

  // Construct subtitle without duplicating tokens already present in props.name
  const subtitle = useMemo(() => {
    const parts: string[] = [];
    const lowerName = props.name.toLowerCase();

    if (props.browser && !lowerName.includes(props.browser.toLowerCase())) {
      parts.push(props.browser);
    }
    if (
      props.operatingSystem &&
      !lowerName.includes(props.operatingSystem.toLowerCase())
    ) {
      parts.push(props.operatingSystem);
    }
    if (parts.length === 0) {
      parts.push(t(`settings.account.devices.types.${props.type}`));
    }
    return parts.join(" · ");
  }, [props.name, props.browser, props.operatingSystem, props.type, t]);

  const formattedAccessedAt = useMemo(() => {
    if (!props.accessedAt) return null;
    return new Date(props.accessedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [props.accessedAt]);

  const formattedCreatedAt = useMemo(() => {
    if (!props.createdAt) return null;
    return new Date(props.createdAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [props.createdAt]);

  return (
    <SettingsCard
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      paddingClass="px-6 py-4"
    >
      <div className="flex min-w-0 items-start gap-4">
        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-authentication-inputBg text-type-dimmed">
          <DeviceIcon type={props.type} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-white">
              {props.name}
            </h3>
            {props.isCurrent ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t("settings.account.devices.thisDevice")}
              </span>
            ) : null}
            {props.ids.length > 1 ? (
              <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-300">
                {t("settings.account.devices.sessionCount", {
                  count: props.ids.length,
                  defaultValue: `${props.ids.length} sessions`,
                })}
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 text-sm text-gray-300">{subtitle}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            {props.isCurrent ? (
              <span className="font-medium text-emerald-400">
                {t("settings.account.devices.activeNow", "Active now")}
              </span>
            ) : formattedAccessedAt ? (
              <span>
                {t("settings.account.devices.lastActive", {
                  date: formattedAccessedAt,
                })}
              </span>
            ) : null}
            {formattedCreatedAt && (
              <span className="text-gray-400/80">
                {t("settings.account.devices.loggedInAt", {
                  date: formattedCreatedAt,
                })}
              </span>
            )}
          </div>
        </div>
      </div>
      {!props.isCurrent ? (
        <Button
          theme="danger"
          className="logout-button shrink-0 self-end sm:self-center"
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
  const account = useAuthStore((s) => s.account);
  const updateDeviceName = useAuthStore((s) => s.updateDeviceName);
  const seed = account?.seed;
  const sessions = props.sessions;
  const currentSessionId = account?.sessionId;
  const url = useBackendUrl();
  const hasHealedDeviceRef = useRef(false);

  // Self-heal current session device name if it is currently "Browser" or empty
  useEffect(() => {
    if (hasHealedDeviceRef.current || !account || !url || !account.seed) return;

    let currentDecrypted: string | null = null;
    try {
      currentDecrypted = decryptData(
        account.deviceName,
        base64ToBuffer(account.seed),
      );
    } catch {
      // ignore decryption errors for invalid seeds
    }

    if (!currentDecrypted || currentDecrypted === "Browser") {
      hasHealedDeviceRef.current = true;
      getClientDeviceName().then(async (realName) => {
        if (realName && realName !== "Browser") {
          try {
            const encrypted = await encryptData(
              realName,
              base64ToBuffer(account.seed),
            );
            await updateSession(url, account, { deviceName: encrypted });
            updateDeviceName(encrypted);
            props.onChange?.();
          } catch (err) {
            console.warn("Failed to update current device session name:", err);
          }
        }
      });
    }
  }, [account, url, props.onChange, updateDeviceName]);

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
      const hasCustomName = Boolean(
        decryptedName && decryptedName !== "Browser",
      );
      const name = hasCustomName
        ? decryptedName!
        : session.userAgent
          ? `${browser} · ${operatingSystem}`
          : t("settings.account.devices.unknownDevice");

      return { name, hasCustomName, ...metadata, browser, operatingSystem };
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
      const isCurrent = session.id === currentSessionId;
      // Key grouping: Keep current device session clearly designated.
      // Other sessions are grouped by device identity so multiple
      // logins from the same device merge into one card instead of flooding identical cards.
      const key = isCurrent
        ? `current_${session.id}`
        : deviceInfo.hasCustomName
          ? deviceInfo.name
          : `${deviceInfo.operatingSystem}__${deviceInfo.baseBrowser}__${deviceInfo.type}`;
      const existing = groups.get(key);

      if (existing) {
        existing.ids.push(session.id);
        if (
          new Date(session.accessedAt) >
          new Date(existing.accessedAt ?? existing.createdAt ?? 0)
        ) {
          existing.accessedAt = session.accessedAt;
        }
        if (
          !existing.createdAt ||
          new Date(session.createdAt) < new Date(existing.createdAt)
        ) {
          existing.createdAt = session.createdAt;
        }
      } else {
        groups.set(key, {
          current: isCurrent,
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
      const timeA = new Date(a.accessedAt ?? a.createdAt ?? 0).getTime();
      const timeB = new Date(b.accessedAt ?? b.createdAt ?? 0).getTime();
      return timeB - timeA;
    });
    return list;
  }, [seed, sessions, currentSessionId, getDeviceInfo]);

  if (!seed) return null;

  return (
    <div>
      <Heading2 border className="mb-9 mt-0">
        {t("settings.account.devices.title")}
      </Heading2>
      {props.loading ? (
        <Loading />
      ) : props.error && deviceListSorted.length === 0 ? (
        <p>{t("settings.account.devices.failed")}</p>
      ) : (
        <div className="space-y-4">
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
