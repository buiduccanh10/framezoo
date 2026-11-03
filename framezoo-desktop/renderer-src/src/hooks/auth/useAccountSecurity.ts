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
  completeEmailChange,
  completePasswordChange,
  requestEmailChange,
  requestPasswordChange,
  resendOtp as resendOtpApi,
  verifyEmailChangeOld,
} from "@/backend/accounts/emailOtp";
import { checkEmailExists } from "@/backend/accounts/user";
import { AccountWithToken, useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/interface/toast";

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d\W_]{8,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getFriendlyError(value: unknown, fallback: string): string {
  return (
    (value as any)?.data?.message ??
    (value as any)?.response?._data?.message ??
    (value as Error)?.message ??
    fallback
  );
}

export function useEmailChange(
  account: AccountWithToken,
  url: string | null,
  onClose: () => void,
) {
  const { t } = useTranslation();
  const setAccount = useAuthStore((state) => state.setAccount);
  const showToast = useToastStore((state) => state.showToast);

  const [step, setStep] = useState<"form" | "old" | "new">("form");
  const [newEmail, setNewEmail] = useState("");
  const [oldEmailChallenge, setOldEmailChallenge] =
    useState<OtpChallengeResponse | null>(null);
  const [newEmailChallenge, setNewEmailChallenge] =
    useState<OtpChallengeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setStep("form");
    setNewEmail("");
    setOldEmailChallenge(null);
    setNewEmailChallenge(null);
    setError(null);
    onClose();
  }, [onClose]);

  const [emailRequest, requestEmail] = useAsyncFn(async () => {
    if (!url) throw new Error("No backend URL");
    setError(null);

    const trimmedEmail = newEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail) || trimmedEmail.length > 255) {
      const msg = t(
        "auth.register.emailInvalid",
        "Enter a valid email address",
      );
      setError(msg);
      showToast(msg, "error");
      return;
    }

    if (trimmedEmail === (account.email ?? "").trim().toLowerCase()) {
      const msg = t(
        "settings.account.security.emailSame",
        "New email must be different from your current email",
      );
      setError(msg);
      showToast(msg, "error");
      return;
    }

    const exists = await checkEmailExists(url, trimmedEmail);
    if (exists) {
      const msg = t("auth.register.emailTaken", "Email is already registered");
      setError(msg);
      showToast(msg, "error");
      return;
    }

    try {
      const challenge = await requestEmailChange(url, account, trimmedEmail);
      setOldEmailChallenge(challenge);
      setStep("old");
      showToast(
        t("toasts.otpSent", "Verification code sent to your email!"),
        "info",
      );
    } catch (err) {
      const msg = getFriendlyError(
        err,
        t("auth.otp.requestFailed", "Unable to send verification code"),
      );
      setError(msg);
      showToast(msg, "error");
    }
  }, [account, newEmail, showToast, t, url]);

  const verifyOldEmailOtp = useCallback(
    async (challengeId: string, code: string) => {
      if (!url) return;
      const response = await verifyEmailChangeOld(
        url,
        account,
        challengeId,
        code,
      );
      setNewEmailChallenge(response);
      setStep("new");
      showToast(
        t("toasts.otpSent", "Verification code sent to your email!"),
        "info",
      );
    },
    [account, showToast, t, url],
  );

  const completeEmailChangeOtp = useCallback(
    async (flowId: string, code: string) => {
      if (!url) return;
      const response = await completeEmailChange(url, account, flowId, code);
      setAccount({ ...account, email: response.user.email });
      showToast(
        t("toasts.emailChangeSuccess", "Email updated successfully!"),
        "success",
      );
      handleClose();
    },
    [account, handleClose, setAccount, showToast, t, url],
  );

  const resendOtp = useCallback(
    async (challengeId: string) => {
      if (!url) throw new Error("No backend URL");
      return resendOtpApi(url, challengeId);
    },
    [url],
  );

  const resetToForm = useCallback(() => {
    setStep("form");
    setOldEmailChallenge(null);
    setNewEmailChallenge(null);
  }, []);

  return {
    step,
    setStep,
    newEmail,
    setNewEmail,
    oldEmailChallenge,
    newEmailChallenge,
    error,
    emailRequest,
    requestEmail,
    verifyOldEmailOtp,
    completeEmailChangeOtp,
    resendOtp,
    handleClose,
    resetToForm,
  };
}

export function usePasswordChange(
  account: AccountWithToken,
  url: string | null,
  onClose: () => void,
) {
  const { t } = useTranslation();
  const setAccount = useAuthStore((state) => state.setAccount);
  const showToast = useToastStore((state) => state.showToast);

  const [step, setStep] = useState<"form" | "otp">("form");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChallenge, setPasswordChallenge] =
    useState<OtpChallengeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setStep("form");
    setPassword("");
    setConfirmPassword("");
    setPasswordChallenge(null);
    setError(null);
    onClose();
  }, [onClose]);

  const [passwordRequest, requestPassword] = useAsyncFn(async () => {
    if (!url) throw new Error("No backend URL");
    setError(null);

    if (!PASSWORD_REGEX.test(password) || !verifyValidMnemonic(password)) {
      const msg = t(
        "auth.register.passwordWeak",
        "Password must be at least 8 characters with letters and numbers",
      );
      setError(msg);
      showToast(msg, "error");
      return;
    }

    if (password !== confirmPassword) {
      const msg = t("auth.register.passwordMismatch", "Passwords do not match");
      setError(msg);
      showToast(msg, "error");
      return;
    }

    try {
      const challenge = await requestPasswordChange(url, account);
      setPasswordChallenge(challenge);
      setStep("otp");
      showToast(
        t("toasts.otpSent", "Verification code sent to your email!"),
        "info",
      );
    } catch (err) {
      const msg = getFriendlyError(
        err,
        t("auth.otp.requestFailed", "Unable to send verification code"),
      );
      setError(msg);
      showToast(msg, "error");
    }
  }, [account, confirmPassword, password, showToast, t, url]);

  const completePasswordChangeOtp = useCallback(
    async (challengeId: string, code: string) => {
      if (!url) return;
      const keys = await keysFromMnemonic(password);
      const device = await encryptData("Browser", keys.seed);
      const response = await completePasswordChange(
        url,
        account,
        challengeId,
        code,
        bytesToBase64Url(keys.publicKey),
        device,
      );
      setAccount({
        ...account,
        seed: bytesToBase64(keys.seed),
        deviceName: device,
        nickname: response.user.nickname,
        email: response.user.email ?? account.email,
        profile: response.user.profile,
      });
      showToast(
        t("toasts.passwordChangeSuccess", "Password changed successfully!"),
        "success",
      );
      handleClose();
    },
    [account, handleClose, password, setAccount, showToast, t, url],
  );

  const resendOtp = useCallback(
    async (challengeId: string) => {
      if (!url) throw new Error("No backend URL");
      return resendOtpApi(url, challengeId);
    },
    [url],
  );

  return {
    step,
    setStep,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    passwordChallenge,
    error,
    passwordRequest,
    requestPassword,
    completePasswordChangeOtp,
    resendOtp,
    handleClose,
  };
}
