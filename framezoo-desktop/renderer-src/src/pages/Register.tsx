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
import { useRegistrationOtp } from "@/hooks/auth/useRegistrationOtp";
import {
  AccountCreatePart,
  AccountProfile,
} from "@/pages/parts/auth/AccountCreatePart";
import { OtpVerificationPart } from "@/pages/parts/auth/OtpVerificationPart";
import {
  PasswordInputData,
  PasswordInputPart,
} from "@/pages/parts/auth/PasswordInputPart";
import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { usePreviewThemeStore } from "@/stores/theme";

function CaptchaProvider(props: {
  siteKey: string | null;
  children: React.ReactNode;
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
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(
    null,
  );
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [selectedBackendUrl, setSelectedBackendUrl] = useState<string | null>(
    currentBackendUrl ?? defaultBackend ?? null,
  );

  const activeBackendUrl = selectedBackendUrl ?? currentBackendUrl ?? "";
  const {
    challenge: registrationOtp,
    error: registrationError,
    requestOtp: requestRegistrationOtp,
    resendOtp,
  } = useRegistrationOtp(activeBackendUrl);

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

  const handleAccountNext = async (data: AccountProfile) => {
    setAccountProfile(data);
    if (!passwordData) return;
    try {
      await requestRegistrationOtp(passwordData.email ?? "");
      setStep(3);
    } catch {
      // Error handled in hook
    }
  };

  const completeRegistration = async (challengeId: string, code: string) => {
    if (!passwordData || !accountProfile) return;
    await register({
      nickname: passwordData.nickname,
      password: passwordData.credentialId ? undefined : passwordData.password,
      credentialId: passwordData.credentialId,
      userData: {
        email: passwordData.email ?? "",
        profile: accountProfile.profile,
      },
      emailOtp: { challengeId, code },
    });

    useOverlayStack.getState().hideModal("auth");
    const state = location.state as
      | { from?: { pathname: string; search?: string; hash?: string } }
      | undefined;
    const destination = state?.from
      ? `${state.from.pathname}${state.from.search || ""}${state.from.hash || ""}`
      : "/discover";
    navigate(destination, { replace: true });
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

      {step === 3 && registrationOtp ? (
        <OtpVerificationPart
          title={t("auth.otp.registrationTitle", "Verify your email")}
          description={t(
            "auth.otp.registrationDescription",
            "Enter the code sent to your email to finish creating your account.",
          )}
          email={passwordData?.email}
          challenge={registrationOtp}
          onVerify={completeRegistration}
          onResend={resendOtp}
          onBack={() => setStep(2)}
          submitLabel={t("auth.register.submit", "Create account")}
        />
      ) : null}

      {registrationError ? (
        <p className="mt-3 text-center text-authentication-errorText">
          {registrationError}
        </p>
      ) : null}

      <p className="text-center mt-6 text-type-text">
        <Trans i18nKey="auth.hasAccount">
          <MwLink
            onClick={() =>
              useOverlayStack.getState().showModal("auth", { mode: "login" })
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
