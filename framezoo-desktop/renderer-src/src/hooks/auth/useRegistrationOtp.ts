import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  OtpChallengeResponse,
  resendOtp as resendOtpApi,
} from "@/backend/accounts/emailOtp";
import { requestRegistrationOtp } from "@/backend/accounts/register";
import { useToastStore } from "@/stores/interface/toast";

export function useRegistrationOtp(backendUrl: string) {
  const { t } = useTranslation();
  const showToast = useToastStore((s) => s.showToast);
  const [challenge, setChallenge] = useState<OtpChallengeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestOtp = useCallback(
    async (email: string) => {
      setError(null);
      try {
        const resp = await requestRegistrationOtp(backendUrl, email);
        setChallenge(resp);
        showToast(
          t("toasts.otpSent", "Verification code sent to your email!"),
          "info",
        );
        return resp;
      } catch (err) {
        const errMessage =
          (err as any)?.data?.message ??
          (err as any)?.response?._data?.message ??
          (err as Error)?.message ??
          t("auth.otp.requestFailed", "Unable to send verification code");
        setError(errMessage);
        showToast(errMessage, "error");
        throw err;
      }
    },
    [backendUrl, showToast, t],
  );

  const resendOtp = useCallback(
    async (challengeId: string) => {
      return resendOtpApi(backendUrl, challengeId);
    },
    [backendUrl],
  );

  return {
    challenge,
    setChallenge,
    error,
    setError,
    requestOtp,
    resendOtp,
  };
}
