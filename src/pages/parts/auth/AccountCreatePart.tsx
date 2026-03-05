import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { checkUserExists } from "@/backend/accounts/user";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/buttons/Button";
import { ColorPicker, initialColor } from "@/components/form/ColorPicker";
import { IconPicker, initialIcon } from "@/components/form/IconPicker";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { UserIcons } from "@/components/UserIcon";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";

export interface AccountProfile {
  inviteCode: string;
  profile: {
    colorA: string;
    colorB: string;
    icon: string;
  };
}

interface AccountCreatePartProps {
  onNext?: (data: AccountProfile) => void;
}

export function AccountCreatePart(props: AccountCreatePartProps) {
  const [inviteCode, setInviteCode] = useState("");
  const [colorA, setColorA] = useState(initialColor);
  const [colorB, setColorB] = useState(initialColor);
  const [userIcon, setUserIcon] = useState<UserIcons>(initialIcon);
  const { t } = useTranslation();
  const [hasInviteError, setHasInviteError] = useState(false);
  const backendUrl = useBackendUrl();

  const [checkResult, checkInvite] = useAsyncFn(
    async (code: string) => {
      if (!backendUrl) return false;
      const exists = await checkUserExists(backendUrl, code);
      return exists;
    },
    [backendUrl],
  );

  const nextStep = useCallback(async () => {
    setHasInviteError(false);
    const validatedInvite = inviteCode.trim();
    if (validatedInvite.length === 0) {
      setHasInviteError(true);
      return;
    }

    const exists = await checkInvite(validatedInvite);
    if (!exists) {
      setHasInviteError(true);
      return;
    }

    props.onNext?.({
      inviteCode: validatedInvite,
      profile: {
        colorA,
        colorB,
        icon: userIcon,
      },
    });
  }, [inviteCode, props, colorA, colorB, userIcon, checkInvite]);

  return (
    <LargeCard>
      <LargeCardText
        icon={
          <Avatar
            profile={{ colorA, colorB, icon: userIcon }}
            iconClass="text-3xl"
            sizeClass="w-16 h-16"
          />
        }
        title={t("auth.register.information.title") ?? undefined}
      >
        {t("auth.register.information.header")}
      </LargeCardText>
      <div className="space-y-6">
        <AuthInputBox
          label={t("auth.inviteCodeLabel")}
          value={inviteCode}
          onChange={setInviteCode}
          placeholder={t("auth.inviteCodePlaceholder")}
        />
        <ColorPicker
          label={t("auth.register.information.color1")}
          value={colorA}
          onInput={setColorA}
        />
        <ColorPicker
          label={t("auth.register.information.color2")}
          value={colorB}
          onInput={setColorB}
        />
        <IconPicker
          label={t("auth.register.information.icon")}
          value={userIcon}
          onInput={setUserIcon}
        />
        {hasInviteError ? (
          <p className="text-authentication-errorText">
            {checkResult.value === false
              ? t("auth.inviteCodeInvalidError")
              : t("auth.inviteCodeRequiredError")}
          </p>
        ) : null}
      </div>
      <LargeCardButtons>
        <Button
          theme="purple"
          onClick={() => nextStep()}
          loading={checkResult.loading}
        >
          {t("auth.register.information.next")}
        </Button>
      </LargeCardButtons>
    </LargeCard>
  );
}
