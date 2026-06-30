import { useState } from "react";
import { useGoogleReCaptcha } from "react-google-recaptcha-v3";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { updateSettings } from "@/backend/accounts/settings";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { useAuth } from "@/hooks/auth/useAuth";
import { AccountProfile } from "@/pages/parts/auth/AccountCreatePart";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useLanguageStore } from "@/stores/language";
import { usePreferencesStore } from "@/stores/preferences";
import { useProgressStore } from "@/stores/progress";
import { useSubtitleStore } from "@/stores/subtitles";
import { useThemeStore } from "@/stores/theme";

import { PasswordInputData } from "./PasswordInputPart";

interface VerifyPasswordProps {
  passwordData: PasswordInputData;
  accountProfile: AccountProfile;
  hasCaptcha?: boolean;
  backendUrl: string | null;
  onNext?: () => void;
}

export function VerifyPasswordPart(props: VerifyPasswordProps) {
  const [password, setPassword] = useState("");
  const { register, restore, importData } = useAuth();
  const progressItems = useProgressStore((store) => store.items);
  const bookmarkItems = useBookmarkStore((store) => store.bookmarks);

  const applicationLanguage = useLanguageStore((store) => store.language);
  const defaultSubtitleLanguage = useSubtitleStore(
    (store) => store.lastSelectedLanguage,
  );
  const applicationTheme = useThemeStore((store) => store.theme);

  const preferences = usePreferencesStore((store) => ({
    enableAutoplay: store.enableAutoplay,
    enableSkipCredits: store.enableSkipCredits,
    enableDiscover: store.enableDiscover,
    enableFeatured: store.enableFeatured,
    enableDetailsModal: store.enableDetailsModal,
    enableImageLogos: store.enableImageLogos,
    enableCarouselView: store.enableCarouselView,
    forceCompactEpisodeView: store.forceCompactEpisodeView,
    sourceOrder: store.sourceOrder,
    enableSourceOrder: store.enableSourceOrder,
    embedOrder: store.embedOrder,
    enableEmbedOrder: store.enableEmbedOrder,
    proxyTmdb: store.proxyTmdb,
    febboxKey: store.febboxKey,
    debridToken: store.debridToken,
    debridService: store.debridService,
    enableHoldToBoost: store.enableHoldToBoost,
    homeSectionOrder: store.homeSectionOrder,
    enableDoubleClickToSeek: store.enableDoubleClickToSeek,
    manualSourceSelection: store.manualSourceSelection,
    enableAutoResumeOnPlaybackError: store.enableAutoResumeOnPlaybackError,
  }));

  const { t } = useTranslation();

  const { executeRecaptcha } = useGoogleReCaptcha();

  const [result, execute] = useAsyncFn(
    async (inputPassword: string) => {
      if (!props.backendUrl)
        throw new Error(t("auth.verify.noBackendUrl") ?? undefined);
      if (!props.passwordData || !props.accountProfile)
        throw new Error(t("auth.verify.invalidData") ?? undefined);

      let recaptchaToken: string | undefined;
      if (props.hasCaptcha) {
        recaptchaToken = executeRecaptcha
          ? await executeRecaptcha()
          : undefined;
        if (!recaptchaToken)
          throw new Error(t("auth.verify.recaptchaFailed") ?? undefined);
      }

      if (inputPassword !== props.passwordData.password)
        throw new Error(t("auth.verify.noMatch") ?? undefined);

      const account = await register({
        nickname: props.passwordData.nickname,
        password: props.passwordData.password,
        userData: {
          inviteCode: props.passwordData.inviteCode ?? "",
          profile: props.accountProfile.profile,
        },
        recaptchaToken,
      });

      if (!account)
        throw new Error(t("auth.verify.registrationFailed") ?? undefined);

      await importData(account, progressItems, bookmarkItems);

      await updateSettings(props.backendUrl, account, {
        applicationLanguage,
        defaultSubtitleLanguage: defaultSubtitleLanguage ?? undefined,
        applicationTheme: applicationTheme ?? undefined,
        proxyUrls: undefined,
        ...preferences,
      });

      await restore(account);

      props.onNext?.();
    },
    [
      props,
      register,
      restore,
      executeRecaptcha,
      applicationLanguage,
      defaultSubtitleLanguage,
      applicationTheme,
      preferences,
    ],
  );

  return (
    <LargeCard>
      <form>
        <LargeCardText
          icon={<Icon icon={Icons.CIRCLE_CHECK} />}
          title={t("auth.verify.title")}
        >
          {t("auth.verify.description")}
        </LargeCardText>
        <AuthInputBox
          label={t("auth.verify.passwordLabel") ?? "Confirm Password"}
          autoComplete="username"
          name="username"
          value={password}
          onChange={setPassword}
          passwordToggleable
        />
        {result.error ? (
          <p className="mt-3 text-authentication-errorText">
            {result.error.message}
          </p>
        ) : null}
        <LargeCardButtons>
          <Button
            theme="purple"
            loading={result.loading}
            onClick={() => execute(password)}
          >
            {t("auth.verify.register")}
          </Button>
        </LargeCardButtons>
      </form>
    </LargeCard>
  );
}
