import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCopyToClipboard, useMountedState } from "react-use";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { useModal } from "@/components/overlays/Modal";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { UserIcons } from "@/components/UserIcon";
import { useAuth } from "@/hooks/auth/useAuth";
import { ProfileEditModal } from "@/pages/parts/settings/ProfileEditModal";
import { useAuthStore } from "@/stores/auth";

export function AccountEditPart(props: {
  deviceName: string;
  setDeviceName: (s: string) => void;
  nickname: string;
  setNickname: (s: string) => void;
  colorA: string;
  setColorA: (s: string) => void;
  colorB: string;
  setColorB: (s: string) => void;
  userIcon: UserIcons;
  setUserIcon: (s: UserIcons) => void;
}) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const { account } = useAuthStore();
  const profileEditModal = useModal("profile-edit");
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
    <SettingsCard paddingClass="px-8 py-10" className="!mt-8">
      <ProfileEditModal
        id={profileEditModal.id}
        close={profileEditModal.hide}
        colorA={props.colorA}
        setColorA={props.setColorA}
        colorB={props.colorB}
        setColorB={props.setColorB}
        userIcon={props.userIcon}
        setUserIcon={props.setUserIcon}
      />
      <div className="grid lg:grid-cols-[auto,1fr] gap-8">
        <div>
          <Avatar
            profile={{
              colorA: props.colorA,
              colorB: props.colorB,
              icon: props.userIcon,
            }}
            iconClass="text-5xl"
            sizeClass="w-32 h-32"
            bottom={
              <button
                type="button"
                className="tabbable whitespace-nowrap text-xs flex gap-2 items-center bg-editBadge-bg text-editBadge-text hover:bg-editBadge-bgHover py-1 px-3 rounded-full cursor-pointer"
                onClick={profileEditModal.show}
              >
                <Icon icon={Icons.EDIT} />
                {t("settings.account.accountDetails.editProfile")}
              </button>
            }
          />
        </div>
        <div>
          <div className="flex flex-col md:flex-row md:gap-4 gap-4">
            <div className="w-full min-w-0">
              <AuthInputBox
                label={t("settings.account.accountDetails.nicknameLabel")}
                placeholder={t(
                  "settings.account.accountDetails.nicknamePlaceholder",
                )}
                value={props.nickname}
                onChange={(value) => props.setNickname(value)}
                className="w-full"
              />
            </div>
            <div className="w-full">
              <div className="mb-2">
                <p className="text-type-dimmed font-medium mb-1">
                  {t("settings.sidebar.info.userId")}
                </p>
                <p className="text-[10px] text-type-dimmed opacity-60 leading-tight mb-2">
                  {t("settings.sidebar.info.userIdDescription")}
                </p>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 rounded-lg bg-largeCard-background bg-opacity-50 min-w-0 overflow-hidden w-full max-w-full">
                  <p className="text-white truncate min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {account?.userId ?? t("settings.sidebar.info.notLoggedIn")}
                  </p>
                  {account?.userId && (
                    <button
                      type="button"
                      className="text-type-dimmed hover:text-white transition-colors duration-200 inline-flex items-center justify-center shrink-0 p-1.5 rounded hover:bg-white/5"
                      onClick={copyUserId}
                      aria-label={
                        hasCopied ? t("actions.copied") : t("actions.copy")
                      }
                      title={
                        hasCopied ? t("actions.copied") : t("actions.copy")
                      }
                    >
                      <Icon
                        icon={hasCopied ? Icons.CHECKMARK : Icons.COPY}
                        className={hasCopied ? "text-[#4BB4D6]" : "text-xs"}
                      />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex space-x-3 mt-4">
            <Button className="logout-button" theme="danger" onClick={logout}>
              {t("settings.account.accountDetails.logoutButton")}
            </Button>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
