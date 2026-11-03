import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { OtpChallengeResponse } from "@/backend/accounts/emailOtp";
import { Button } from "@/components/buttons/Button";
import { OtpInput } from "@/components/form/OtpInput";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { useToastStore } from "@/stores/interface/toast";

export function OtpVerificationPart(props: {
  title: string;
  description: string;
  challenge: OtpChallengeResponse;
  onVerify: (challengeId: string, code: string) => Promise<void>;
  onResend: (challengeId: string) => Promise<OtpChallengeResponse>;
  onBack?: () => void;
  submitLabel?: string;
}) {
  const { t } = useTranslation();
  const showToast = useToastStore((s) => s.showToast);
  const [challengeId, setChallengeId] = useState(props.challenge.challengeId);
  const [code, setCode] = useState("");
  const [expiresIn, setExpiresIn] = useState(props.challenge.expiresIn);
  const [resendAfter, setResendAfter] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChallengeId(props.challenge.challengeId);
    setExpiresIn(props.challenge.expiresIn);
    setResendAfter(0);
    setCode("");
  }, [props.challenge.challengeId, props.challenge.expiresIn]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setExpiresIn((current) => Math.max(0, current - 1));
      setResendAfter((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const [verifyResult, verify] = useAsyncFn(async () => {
    if (code.length !== 6 || expiresIn <= 0) return;
    setError(null);
    try {
      await props.onVerify(challengeId, code);
    } catch (verifyError) {
      const errMessage =
        (verifyError as any)?.data?.message ??
        (verifyError as any)?.response?._data?.message ??
        (verifyError as Error)?.message ??
        t("auth.otp.invalid", "Invalid verification code");
      setError(errMessage);
      showToast(errMessage, "error");
    }
  }, [challengeId, code, expiresIn, props, showToast, t]);

  const [resendResult, resend] = useAsyncFn(async () => {
    setError(null);
    try {
      const next = await props.onResend(challengeId);
      setChallengeId(next.challengeId);
      setExpiresIn(next.expiresIn);
      setResendAfter(next.resendAfter > 0 ? next.resendAfter : 60);
      setCode("");
      showToast(
        t("toasts.otpResent", "Verification code has been resent!"),
        "info",
      );
    } catch (resendError) {
      const errMessage =
        (resendError as any)?.data?.message ??
        (resendError as any)?.response?._data?.message ??
        (resendError as Error)?.message ??
        t("auth.otp.resendFailed", "Unable to resend the code");
      setError(errMessage);
      showToast(errMessage, "error");
    }
  }, [challengeId, props, showToast, t]);

  return (
    <LargeCard compact>
      <LargeCardText compact title={props.title}>
        {props.description}
      </LargeCardText>
      <OtpInput
        value={code}
        onChange={setCode}
        autoFocus
        label={t("auth.otp.codeLabel", "Verification code")}
        disabled={
          verifyResult.loading || resendResult.loading || expiresIn <= 0
        }
      />
      <div
        className="mt-4 space-y-1 text-center text-sm text-type-text"
        aria-live="polite"
      >
        <p
          className={
            expiresIn <= 0 ? "text-authentication-errorText" : undefined
          }
        >
          {expiresIn > 0
            ? t("auth.otp.expiresIn", "Code expires in {{time}}", {
                time: `${Math.floor(expiresIn / 60)}:${String(
                  expiresIn % 60,
                ).padStart(2, "0")}`,
              })
            : t("auth.otp.expired", "Verification code expired")}
        </p>
        {resendAfter > 0 ? (
          <p>
            {t("auth.otp.resendIn", "Resend available in {{seconds}}s", {
              seconds: resendAfter,
            })}
          </p>
        ) : (
          <button
            type="button"
            className="text-type-link hover:underline"
            onClick={resend}
            disabled={resendResult.loading}
          >
            {t("auth.otp.resend", "Resend code")}
          </button>
        )}
      </div>
      {error ? (
        <p className="mt-3 text-center text-authentication-errorText">
          {error}
        </p>
      ) : null}
      <LargeCardButtons compact splitAlign>
        {props.onBack ? (
          <Button theme="secondary" onClick={props.onBack}>
            {t("actions.back", "Back")}
          </Button>
        ) : (
          <span />
        )}
        <Button
          theme="purple"
          loading={verifyResult.loading}
          disabled={code.length !== 6 || expiresIn <= 0 || resendResult.loading}
          onClick={verify}
        >
          {props.submitLabel ?? t("auth.otp.continue", "Continue")}
        </Button>
      </LargeCardButtons>
    </LargeCard>
  );
}
