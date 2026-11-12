import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { OtpChallengeResponse } from "@/backend/accounts/emailOtp";
import { Button } from "@/components/buttons/Button";
import { OtpInput } from "@/components/form/OtpInput";
import { Icon, Icons } from "@/components/Icon";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { useOtpCountdown } from "@/hooks/auth/useOtpCountdown";
import { useToastStore } from "@/stores/interface/toast";

export function OtpVerificationPart(props: {
  title: string;
  description: string;
  email?: string | null;
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
  const [error, setError] = useState<string | null>(null);

  const countdown = useOtpCountdown(props.challenge.expiresIn, 0);

  useEffect(() => {
    setChallengeId(props.challenge.challengeId);
    countdown.reset(props.challenge.expiresIn, 0);
    setCode("");
  }, [props.challenge.challengeId, props.challenge.expiresIn, countdown]);

  const [verifyResult, verify] = useAsyncFn(async () => {
    if (code.length !== 6 || countdown.isExpired) return;
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
  }, [challengeId, code, countdown.isExpired, props, showToast, t]);

  const [resendResult, resend] = useAsyncFn(async () => {
    setError(null);
    try {
      const next = await props.onResend(challengeId);
      setChallengeId(next.challengeId);
      countdown.reset(next.expiresIn, next.resendAfter);
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
  }, [challengeId, countdown, props, showToast, t]);

  return (
    <LargeCard compact>
      <LargeCardText compact title={props.title}>
        <div className="space-y-3">
          {props.email ? (
            <div className="space-y-1">
              <p className="text-type-text">
                {t(
                  "auth.otp.sentToPrompt",
                  "Verification code has been sent to:",
                )}
              </p>
              <p
                className="font-bold text-white select-all whitespace-nowrap overflow-hidden text-ellipsis max-w-full px-2"
                title={props.email}
              >
                {props.email}
              </p>
            </div>
          ) : (
            <p className="text-type-text">{props.description}</p>
          )}
          <div className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
            <Icon
              icon={Icons.WARNING}
              className="text-amber-400 shrink-0 text-xs"
            />
            <span>
              {t(
                "auth.otp.spamNotice",
                "Can't find the email? Please check your spam or junk folder.",
              )}
            </span>
          </div>
        </div>
      </LargeCardText>
      <OtpInput
        value={code}
        onChange={setCode}
        autoFocus
        label={t("auth.otp.codeLabel", "Verification code")}
        disabled={
          verifyResult.loading || resendResult.loading || countdown.isExpired
        }
      />
      <div
        className="mt-4 space-y-1 text-center text-sm text-type-text"
        aria-live="polite"
      >
        <p
          className={
            countdown.isExpired ? "text-authentication-errorText" : undefined
          }
        >
          {!countdown.isExpired
            ? t("auth.otp.expiresIn", "Code expires in {{time}}", {
                time: countdown.formattedTime,
              })
            : t("auth.otp.expired", "Verification code expired")}
        </p>
        {!countdown.canResend ? (
          <p>
            {t("auth.otp.resendIn", "Resend available in {{seconds}}s", {
              seconds: countdown.resendAfter,
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
          disabled={
            code.length !== 6 || countdown.isExpired || resendResult.loading
          }
          onClick={verify}
        >
          {props.submitLabel ?? t("auth.otp.continue", "Continue")}
        </Button>
      </LargeCardButtons>
    </LargeCard>
  );
}
