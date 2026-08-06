import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/buttons/Button";
import { ColorPicker, initialColor } from "@/components/form/ColorPicker";
import { IconPicker, initialIcon } from "@/components/form/IconPicker";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { UserIcons } from "@/components/UserIcon";

export interface AccountProfile {
  profile: {
    colorA: string;
    colorB: string;
    icon: string;
  };
}

interface AccountCreatePartProps {
  onNext?: (data: AccountProfile) => void;
  compact?: boolean;
}

export function AccountCreatePart(props: AccountCreatePartProps) {
  const [colorA, setColorA] = useState(initialColor);
  const [colorB, setColorB] = useState(initialColor);
  const [userIcon, setUserIcon] = useState<UserIcons>(initialIcon);
  const { t } = useTranslation();

  const nextStep = useCallback(async () => {
    props.onNext?.({
      profile: {
        colorA,
        colorB,
        icon: userIcon,
      },
    });
  }, [props, colorA, colorB, userIcon]);

  return (
    <LargeCard compact={props.compact}>
      <LargeCardText
        compact={props.compact}
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
      </div>
      <LargeCardButtons compact={props.compact}>
        <Button theme="purple" onClick={() => nextStep()}>
          {t("actions.confirm")}
        </Button>
      </LargeCardButtons>
    </LargeCard>
  );
}
