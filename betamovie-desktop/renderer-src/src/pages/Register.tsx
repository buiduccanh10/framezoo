import { useEffect, useState } from "react";
import { GoogleReCaptchaProvider } from "react-google-recaptcha-v3";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { getBackendMeta } from "@/backend/accounts/meta";
import { Button } from "@/components/buttons/Button";
import { BackendSelector } from "@/components/form/BackendSelector";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { useAuth } from "@/hooks/auth/useAuth";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";
import {
  AccountCreatePart,
  AccountProfile,
} from "@/pages/parts/auth/AccountCreatePart";
import {
  PasswordInputData,
  PasswordInputPart,
} from "@/pages/parts/auth/PasswordInputPart";
import { PageTitle } from "@/pages/parts/util/PageTitle";
import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";
import { usePreviewThemeStore } from "@/stores/theme";

function CaptchaProvider(props: {
  siteKey: string | null;
  children: JSX.Element;
}) {
  if (!props.siteKey) return props.children;
  return (
    <GoogleReCaptchaProvider reCaptchaKey={props.siteKey}>
      {props.children}
    </GoogleReCaptchaProvider>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { register } = useAuth();
  const setPreviewTheme = usePreviewThemeStore((s) => s.setPreviewTheme);
  const setBackendUrl = useAuthStore((s) => s.setBackendUrl);
  const currentBackendUrl = useAuthStore((s) => s.backendUrl);
  const config = conf();
  const availableBackends =
    config.BACKEND_URLS.length > 0
      ? config.BACKEND_URLS
      : config.BACKEND_URL
        ? [config.BACKEND_URL]
        : [];

  // If there's only one backend and user hasn't selected a custom one, auto-select it
  const defaultBackend =
    currentBackendUrl ??
    (availableBackends.length === 1 ? availableBackends[0] : null);

  const [step, setStep] = useState(
    availableBackends.length > 1 || !defaultBackend ? -1 : 1,
  );
  const [passwordData, setPasswordData] = useState<PasswordInputData | null>(
    null,
  );
  const [, setAccountProfile] = useState<AccountProfile | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [selectedBackendUrl, setSelectedBackendUrl] = useState<string | null>(
    currentBackendUrl ?? defaultBackend ?? null,
  );

  useEffect(() => {
    setPreviewTheme("ember");
    return () => {
      setPreviewTheme(null);
    };
  }, [setPreviewTheme]);

  useEffect(() => {
    if (selectedBackendUrl) {
      getBackendMeta(selectedBackendUrl)
        .then((meta) => {
          setSiteKey(
            meta.hasCaptcha && meta.captchaClientKey
              ? meta.captchaClientKey
              : null,
          );
        })
        .catch((err) => {
          console.error("Failed to fetch backend meta:", err);
        });
    }
  }, [selectedBackendUrl]);

  const handleBackendSelect = (url: string | null) => {
    setSelectedBackendUrl(url);
    if (url) {
      setBackendUrl(url);
    }
  };

  const handlePasswordNext = (data: PasswordInputData) => {
    setPasswordData(data);
    setStep(2);
  };

  const handleAccountNext = (data: AccountProfile) => {
    setAccountProfile(data);
    // Final step: register immediately after selecting profile
    if (!passwordData) return;
    register({
      nickname: passwordData.nickname,
      password: passwordData.credentialId ? undefined : passwordData.password,
      credentialId: passwordData.credentialId,
      userData: {
        inviteCode: passwordData.inviteCode ?? "",
        profile: data.profile,
      },
    })
      .then(() => {
        navigate("/");
      })
      .catch((err) => {
        console.error("Registration failed:", err);
      });
  };

  return (
    <CaptchaProvider siteKey={siteKey}>
      <SubPageLayout showFooter={false}>
        <Helmet>
          <body className="md:overflow-hidden" />
        </Helmet>
        <PageTitle subpage k="global.pages.register" />
        <div className="flex min-h-[calc(100dvh-12rem)] items-center justify-center px-4 py-6">
          <div className="w-full">
            {step === -1 &&
            (availableBackends.length > 1 || !defaultBackend) ? (
              <LargeCard>
                <LargeCardText title={t("auth.backendSelection.title")}>
                  {t("auth.backendSelection.description")}
                </LargeCardText>
                <BackendSelector
                  selectedUrl={selectedBackendUrl}
                  onSelect={handleBackendSelect}
                  availableUrls={availableBackends}
                  showCustom
                />
                <LargeCardButtons>
                  <span className="text-type-danger font-medium text-center">
                    {t("settings.connections.server.notice")}
                  </span>
                  <Button
                    theme="purple"
                    onClick={() => {
                      if (selectedBackendUrl) {
                        setStep(1);
                      }
                    }}
                    disabled={!selectedBackendUrl}
                  >
                    {t("auth.register.information.next")}
                  </Button>
                </LargeCardButtons>
              </LargeCard>
            ) : null}

            {step === 1 ? (
              <PasswordInputPart forLogin={false} onNext={handlePasswordNext} />
            ) : null}

            {step === 2 ? (
              <AccountCreatePart onNext={handleAccountNext} />
            ) : null}
          </div>
        </div>
      </SubPageLayout>
    </CaptchaProvider>
  );
}
