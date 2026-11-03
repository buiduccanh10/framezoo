import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { useModal } from "@/components/overlays/Modal";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { UserIcons } from "@/components/UserIcon";
import { useAuth } from "@/hooks/auth/useAuth";
import {
  EmailChangeModal,
  PasswordChangeModal,
} from "@/pages/parts/settings/AccountSecurityPart";
import { ProfileEditModal } from "@/pages/parts/settings/ProfileEditModal";
import { AccountWithToken } from "@/stores/auth";

export function AccountEditPart(props: {
  account: AccountWithToken;
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
  const profileEditModal = useModal("profile-edit");
  const emailChangeModal = useModal("account-email-change");
  const passwordChangeModal = useModal("account-password-change");

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
      <EmailChangeModal
        id={emailChangeModal.id}
        close={emailChangeModal.hide}
        account={props.account}
      />
      <PasswordChangeModal
        id={passwordChangeModal.id}
        close={passwordChangeModal.hide}
        account={props.account}
      />
      <div className="grid lg:grid-cols-[auto_1fr] gap-8">
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
        <div className="min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="w-full min-w-0">
              <p className="font-bold text-type-emphasis mb-2">
                {t("settings.account.accountDetails.emailLabel", "Email")}
              </p>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-authentication-inputBg px-4 py-2.5 min-h-[46px]">
                <span className="truncate text-sm text-white/90">
                  {props.account.email ||
                    t(
                      "settings.account.accountDetails.noEmail",
                      "No email linked",
                    )}
                </span>
                <button
                  type="button"
                  className="tabbable whitespace-nowrap text-xs flex gap-2 items-center bg-editBadge-bg text-editBadge-text hover:bg-editBadge-bgHover py-1 px-3 rounded-full cursor-pointer shrink-0"
                  onClick={emailChangeModal.show}
                >
                  <Icon icon={Icons.EDIT} />
                  {t("settings.account.accountDetails.editEmail", "Edit")}
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 mt-5">
            <Button theme="purple" onClick={passwordChangeModal.show}>
              <Icon icon={Icons.LOCK} className="mr-2" />
              {t("settings.account.security.passwordTitle", "Change password")}
            </Button>
            <Button className="logout-button" theme="danger" onClick={logout}>
              {t("settings.account.accountDetails.logoutButton")}
            </Button>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
