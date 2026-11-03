import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { usePasswordRecovery } from "@/hooks/auth/usePasswordRecovery";

import { OtpVerificationPart } from "./OtpVerificationPart";

export function PasswordRecoveryPart(props: {
  backendUrl: string;
  onComplete?: () => void;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const {
    step,
    setStep,
    email,
    setEmail,
    challenge,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    infoMessage,
    requestResult,
    completeResult,
    requestReset,
    verifyOtp,
    resendOtp,
    completeReset,
  } = usePasswordRecovery(props.backendUrl, props.onComplete);

  if (step === "otp" && challenge) {
    return (
      <OtpVerificationPart
        title={t("auth.otp.resetTitle", "Reset your password")}
        description={t(
          "auth.otp.resetDescription",
          "Enter the code sent to your email.",
        )}
        challenge={challenge}
        onVerify={verifyOtp}
        onResend={resendOtp}
        onBack={() => setStep("email")}
      />
    );
  }

  if (step === "password") {
    return (
      <LargeCard compact>
        <LargeCardText
          compact
          title={t("auth.otp.newPasswordTitle", "Create a new password")}
        >
          {t(
            "auth.otp.newPasswordDescription",
            "Choose a new password for your account.",
          )}
        </LargeCardText>
        <div className="space-y-4">
          <AuthInputBox
            label={t("auth.login.passwordLabel", "Password")}
            value={password}
            onChange={setPassword}
            passwordToggleable
            autoComplete="new-password"
          />
          <AuthInputBox
            label={t(
              "auth.register.confirmPasswordPlaceholder",
              "Confirm password",
            )}
            value={confirmPassword}
            onChange={setConfirmPassword}
            passwordToggleable
            autoComplete="new-password"
          />
        </div>
        {completeResult.error ? (
          <p className="mt-3 text-authentication-errorText">
            {(completeResult.error as any)?.data?.message ??
              completeResult.error.message}
          </p>
        ) : null}
        <LargeCardButtons compact splitAlign>
          <Button theme="secondary" onClick={() => setStep("otp")}>
            {t("actions.back", "Back")}
          </Button>
          <Button
            theme="purple"
            loading={completeResult.loading}
            onClick={completeReset}
          >
            {t("auth.otp.finish", "Finish")}
          </Button>
        </LargeCardButtons>
      </LargeCard>
    );
  }

  return (
    <LargeCard compact>
      <LargeCardText
        compact
        title={t("auth.otp.forgotTitle", "Forgot password?")}
      >
        {t(
          "auth.otp.forgotDescription",
          "Enter your account email to receive a verification code.",
        )}
      </LargeCardText>
      <AuthInputBox
        label={t("auth.register.emailLabel", "Email")}
        value={email}
        onChange={setEmail}
        autoComplete="email"
        placeholder={t("auth.register.emailPlaceholder", "Enter your email")}
      />
      {infoMessage ? (
        <p className="mt-3 text-center text-type-text">{infoMessage}</p>
      ) : null}
      {requestResult.error ? (
        <p className="mt-3 text-authentication-errorText">
          {(requestResult.error as any)?.data?.message ??
            requestResult.error.message}
        </p>
      ) : null}
      <LargeCardButtons compact splitAlign>
        <Button theme="secondary" onClick={props.onBack}>
          {t("actions.back", "Back")}
        </Button>
        <Button
          theme="purple"
          loading={requestResult.loading}
          disabled={!email.trim()}
          onClick={requestReset}
        >
          {t("auth.otp.send", "Send code")}
        </Button>
      </LargeCardButtons>
    </LargeCard>
  );
}
