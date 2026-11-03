import { useCallback, useState } from "react";
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
  OtpChallengeResponse,
  completePasswordReset,
  requestPasswordReset,
  resendOtp as resendOtpApi,
  verifyPasswordReset,
} from "@/backend/accounts/emailOtp";
import { useAuth } from "@/hooks/auth/useAuth";
import { useAuthData } from "@/hooks/auth/useAuthData";
import { useToastStore } from "@/stores/interface/toast";
import { getClientDeviceName } from "@/utils/deviceName";

export type PasswordRecoveryStep = "email" | "otp" | "password";

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d\W_]{8,}$/;

export function usePasswordRecovery(
  backendUrl: string,
  onComplete?: () => void,
) {
  const { t } = useTranslation();
  const { restore } = useAuth();
  const { login: saveAccount } = useAuthData();
  const showToast = useToastStore((s) => s.showToast);

  const [step, setStep] = useState<PasswordRecoveryStep>("email");
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<OtpChallengeResponse | null>(null);
  const [actionToken, setActionToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [requestResult, requestReset] = useAsyncFn(async () => {
    setInfoMessage(null);
    try {
      const response = await requestPasswordReset(backendUrl, email.trim());
      if (!response.challengeId) {
        setInfoMessage(response.message);
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
  }, [backendUrl, email, showToast, t]);

  const verifyOtp = useCallback(
    async (challengeId: string, code: string) => {
      const response = await verifyPasswordReset(backendUrl, challengeId, code);
      setActionToken(response.actionToken);
      setStep("password");
    },
    [backendUrl],
  );

  const resendOtp = useCallback(
    async (challengeId: string) => {
      return resendOtpApi(backendUrl, challengeId);
    },
    [backendUrl],
  );

  const [completeResult, completeReset] = useAsyncFn(async () => {
    if (!actionToken) return;

    if (!PASSWORD_REGEX.test(password) || !verifyValidMnemonic(password)) {
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
      const clientDeviceName = await getClientDeviceName();
      const response = await completePasswordReset(
        backendUrl,
        actionToken,
        bytesToBase64Url(keys.publicKey),
        await encryptData(clientDeviceName, keys.seed),
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
      onComplete?.();
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
    backendUrl,
    confirmPassword,
    onComplete,
    password,
    restore,
    saveAccount,
    showToast,
    t,
  ]);

  return {
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
  };
}
