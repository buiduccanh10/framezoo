import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import {
  bytesToBase64,
  bytesToBase64Url,
  encryptData,
  keysFromMnemonic,
  verifyValidMnemonic,
} from "@/backend/accounts/crypto";
import {
  completePasswordReset,
  requestPasswordReset,
  resendOtp,
  verifyPasswordReset,
} from "@/backend/accounts/emailOtp";
import { Button } from "@/components/buttons/Button";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { useAuth } from "@/hooks/auth/useAuth";
import { useAuthData } from "@/hooks/auth/useAuthData";
import { useToastStore } from "@/stores/interface/toast";

import { OtpVerificationPart } from "./OtpVerificationPart";

export function PasswordRecoveryPart(props: {
  backendUrl: string;
  onComplete?: () => void;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const { restore } = useAuth();
  const { login: saveAccount } = useAuthData();
  const showToast = useToastStore((s) => s.showToast);
  const [step, setStep] = useState<"email" | "otp" | "password">("email");
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<Awaited<
    ReturnType<typeof requestPasswordReset>
  > | null>(null);
  const [actionToken, setActionToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const [requestResult, request] = useAsyncFn(async () => {
    setMessage(null);
    try {
      const response = await requestPasswordReset(
        props.backendUrl,
        email.trim(),
      );
      if (!response.challengeId) {
        setMessage(response.message);
        showToast(response.message, "info");
        return;
      }
      setChallenge(response);
      setStep("otp");
      showToast(
        t("toasts.otpSent", "Verification code sent to your email!"),
        "info",
      );
    } catch (err) {
      const errMessage =
        (err as any)?.data?.message ??
        (err as any)?.response?._data?.message ??
        (err as Error)?.message ??
        t("auth.otp.requestFailed", "Unable to send verification code");
      showToast(errMessage, "error");
      throw err;
    }
  }, [email, props.backendUrl, showToast, t]);

  const [completeResult, complete] = useAsyncFn(async () => {
    if (!actionToken) return;
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d\W_]{8,}$/;
    if (!passwordRegex.test(password) || !verifyValidMnemonic(password)) {
      const weakMsg = t(
        "auth.register.passwordWeak",
        "Password must be at least 8 characters with letters and numbers",
      );
      showToast(weakMsg, "error");
      throw new Error(weakMsg);
    }
    if (password !== confirmPassword) {
      const mismatchMsg = t(
        "auth.register.passwordMismatch",
        "Passwords do not match",
      );
      showToast(mismatchMsg, "error");
      throw new Error(mismatchMsg);
    }

    try {
      const keys = await keysFromMnemonic(password);
      const response = await completePasswordReset(
        props.backendUrl,
        actionToken,
        bytesToBase64Url(keys.publicKey),
        await encryptData("Browser", keys.seed),
      );
      const account = await saveAccount(
        response,
        response.user,
        response.session,
        bytesToBase64(keys.seed),
      );
      await restore(account);
      showToast(
        t("toasts.passwordResetSuccess", "Password reset successfully!"),
        "success",
      );
      props.onComplete?.();
    } catch (err) {
      const errMessage =
        (err as any)?.data?.message ??
        (err as any)?.response?._data?.message ??
        (err as Error)?.message ??
        t("toasts.passwordResetError", "Failed to reset password");
      showToast(errMessage, "error");
      throw err;
    }
  }, [
    actionToken,
    confirmPassword,
    password,
    props,
    restore,
    saveAccount,
    showToast,
    t,
  ]);

  if (step === "otp" && challenge) {
    return (
      <OtpVerificationPart
        title={t("auth.otp.resetTitle", "Reset your password")}
        description={t(
          "auth.otp.resetDescription",
          "Enter the code sent to your email.",
        )}
        challenge={challenge}
        onVerify={async (challengeId, code) => {
          const response = await verifyPasswordReset(
            props.backendUrl,
            challengeId,
            code,
          );
          setActionToken(response.actionToken);
          setStep("password");
        }}
        onResend={(challengeId) => resendOtp(props.backendUrl, challengeId)}
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
            onClick={complete}
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
      {message ? (
        <p className="mt-3 text-center text-type-text">{message}</p>
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
          onClick={request}
        >
          {t("auth.otp.send", "Send code")}
        </Button>
      </LargeCardButtons>
    </LargeCard>
  );
}
