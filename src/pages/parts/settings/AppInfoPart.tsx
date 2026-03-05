import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCopyToClipboard, useMountedState } from "react-use";

import { Icon, Icons } from "@/components/Icon";
import { SidebarSection } from "@/components/layout/Sidebar";
import { useAuthStore } from "@/stores/auth";

export function AppInfoPart() {
  const { t } = useTranslation();
  const { account } = useAuthStore();
  const [, copy] = useCopyToClipboard();
  const [hasCopied, setHasCopied] = useState(false);
  const isMounted = useMountedState();
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const copyUserId = useCallback(() => {
    if (!account?.userId) return;
    copy(account.userId);
    setHasCopied(true);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      if (isMounted()) setHasCopied(false);
    }, 2000);
  }, [account?.userId, copy, isMounted]);

  return (
    <SidebarSection
      className="text-sm"
      title={t("settings.sidebar.info.title")}
    >
      <div className="px-3 py-3.5 rounded-lg bg-largeCard-background bg-opacity-50 grid grid-cols-2 gap-4">
        {/* User ID */}
        <div className="col-span-2 space-y-1">
          <div className="flex flex-col gap-0.5">
            <p className="text-type-dimmed font-medium">
              {t("settings.sidebar.info.userId")}
            </p>
            <p className="text-[10px] text-type-dimmed opacity-60 leading-tight">
              {t("settings.sidebar.info.userIdDescription")}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-white">
              {account?.userId ?? t("settings.sidebar.info.notLoggedIn")}
            </p>
            {account?.userId && (
              <button
                type="button"
                className="text-type-dimmed hover:text-white transition-colors duration-200 flex items-center gap-1.5 shrink-0 px-2 py-1 -mr-1 rounded hover:bg-white/5"
                onClick={copyUserId}
              >
                <Icon
                  icon={hasCopied ? Icons.CHECKMARK : Icons.COPY}
                  className={hasCopied ? "text-[#4BB4D6]" : "text-xs"}
                />
                <span className="text-xs">
                  {hasCopied ? t("actions.copied") : t("actions.copy")}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* <div className="col-span-1 space-y-1">
          <p className="text-type-dimmed font-medium">
            {t("settings.sidebar.info.appVersion")}
          </p>
          <p className="text-type-dimmed px-2 py-1 rounded bg-settings-sidebar-badge inline-block">
            {conf().APP_VERSION}
          </p>
        </div>

        <div className="col-span-1 space-y-1">
          <p className="text-type-dimmed font-medium">
            {t("settings.sidebar.info.backendVersion")}
          </p>
          <p className="text-type-dimmed px-2 py-1 rounded bg-settings-sidebar-badge inline-flex items-center gap-1">
            {backendMeta.error ? (
              <Icon
                icon={Icons.WARNING}
                className="text-type-danger text-base"
              />
            ) : null}
            {backendMeta.loading ? (
              <span className="block h-4 w-12 bg-type-dimmed/20 rounded" />
            ) : (
              backendMeta?.value?.version ||
              t("settings.sidebar.info.unknownVersion")
            )}
          </p>
        </div> */}

        {/* <div className="col-span-2 space-y-1">
          <p className="text-type-dimmed font-medium">
            {t("settings.account.admin.title")}
          </p>
          <Button
            theme="secondary"
            onClick={() => navigate("/admin")}
            className="w-full !p-2 text-xs"
          >
            {t("settings.account.admin.text")}
          </Button>
        </div> */}
      </div>
    </SidebarSection>
  );
}
