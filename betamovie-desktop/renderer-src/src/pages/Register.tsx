import { useEffect, useState } from "react";
import { GoogleReCaptchaProvider } from "react-google-recaptcha-v3";
import { Trans, useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { getBackendMeta } from "@/backend/accounts/meta";
import { Button } from "@/components/buttons/Button";
import { BackendSelector } from "@/components/form/BackendSelector";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { MwLink } from "@/components/text/Link";
import { useAuth } from "@/hooks/auth/useAuth";
import {
  AccountCreatePart,
  AccountProfile,
} from "@/pages/parts/auth/AccountCreatePart";
import {
  PasswordInputData,
  PasswordInputPart,
} from "@/pages/parts/auth/PasswordInputPart";
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

export function RegisterPanel() {
  const location = useLocation();
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
        email: passwordData.email ?? "",
        profile: data.profile,
      },
    })
      .then(() => {
        const state = location.state as
          | {
              from?: {
                pathname: string;
                search?: string;
                hash?: string;
              };
            }
          | undefined;
        const destination = state?.from
          ? `${state.from.pathname}${state.from.search || ""}${state.from.hash || ""}`
          : "/discover";
        navigate(destination, { replace: true });
      })
      .catch((err) => {
        console.error("Registration failed:", err);
      });
  };

  const content = (
    <>
      {step === -1 && (availableBackends.length > 1 || !defaultBackend) ? (
        <LargeCard compact>
          <LargeCardText compact title={t("auth.backendSelection.title")}>
            {t("auth.backendSelection.description")}
          </LargeCardText>
          <BackendSelector
            selectedUrl={selectedBackendUrl}
            onSelect={handleBackendSelect}
            availableUrls={availableBackends}
            showCustom
          />
          <LargeCardButtons compact>
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
        <PasswordInputPart
          forLogin={false}
          compact
          onNext={handlePasswordNext}
        />
      ) : null}

      {step === 2 ? (
        <AccountCreatePart compact onNext={handleAccountNext} />
      ) : null}

      <p className="text-center mt-6 text-type-text">
        <Trans i18nKey="auth.hasAccount">
          <MwLink
            onClick={() =>
              navigate("/login", {
                state: location.state,
                replace: true,
              })
            }
          >
            .
          </MwLink>
        </Trans>
      </p>
    </>
  );

  return <CaptchaProvider siteKey={siteKey}>{content}</CaptchaProvider>;
}
