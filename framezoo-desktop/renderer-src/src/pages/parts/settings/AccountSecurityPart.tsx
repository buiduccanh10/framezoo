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
  OtpChallengeResponse,
  completeEmailChange,
  completePasswordChange,
  requestEmailChange,
  requestPasswordChange,
  resendOtp,
  verifyEmailChangeOld,
} from "@/backend/accounts/emailOtp";
import { checkEmailExists } from "@/backend/accounts/user";
import { Button } from "@/components/buttons/Button";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Icons } from "@/components/Icon";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { Modal } from "@/components/overlays/Modal";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { OtpVerificationPart } from "@/pages/parts/auth/OtpVerificationPart";
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

export function EmailChangeModal(props: {
  id: string;
  close: () => void;
  account: AccountWithToken;
}) {
  const { t } = useTranslation();
  const url = useBackendUrl();
  const setAccount = useAuthStore((state) => state.setAccount);
  const showToast = useToastStore((state) => state.showToast);

  const [step, setStep] = useState<"form" | "old" | "new">("form");
  const [newEmail, setNewEmail] = useState("");
  const [oldEmailChallenge, setOldEmailChallenge] =
    useState<OtpChallengeResponse | null>(null);
  const [newEmailChallenge, setNewEmailChallenge] =
    useState<OtpChallengeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setStep("form");
    setNewEmail("");
    setOldEmailChallenge(null);
    setNewEmailChallenge(null);
    setError(null);
    props.close();
  };

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

    if (trimmedEmail === (props.account.email ?? "").trim().toLowerCase()) {
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
      const challenge = await requestEmailChange(
        url,
        props.account,
        trimmedEmail,
      );
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
  }, [newEmail, props.account, showToast, t, url]);

  return (
    <Modal id={props.id}>
      <div className="relative pointer-events-auto w-full max-w-[34rem] p-4">
        <div className="absolute right-7 top-7 z-20">
          <button
            type="button"
            className="rounded-full p-2 text-type-secondary transition-colors hover:bg-white/10 hover:text-white"
            onClick={handleClose}
            aria-label={t("overlays.close", "Close")}
          >
            <IconPatch icon={Icons.X} />
          </button>
        </div>
        {step === "old" && oldEmailChallenge && url ? (
          <OtpVerificationPart
            title={t("auth.otp.emailOldTitle", "Confirm your current email")}
            description={t(
              "auth.otp.emailOldDescription",
              "Enter the code sent to your current email.",
            )}
            challenge={oldEmailChallenge}
            onVerify={async (challengeId, code) => {
              const response = await verifyEmailChangeOld(
                url,
                props.account,
                challengeId,
                code,
              );
              setNewEmailChallenge(response);
              setStep("new");
              showToast(
                t("toasts.otpSent", "Verification code sent to your email!"),
                "info",
              );
            }}
            onResend={(challengeId) => resendOtp(url, challengeId)}
            onBack={() => setStep("form")}
          />
        ) : step === "new" && newEmailChallenge && url ? (
          <OtpVerificationPart
            title={t("auth.otp.emailNewTitle", "Verify your new email")}
            description={t(
              "auth.otp.emailNewDescription",
              "Enter the code sent to your new email.",
            )}
            challenge={newEmailChallenge}
            submitLabel={t("auth.otp.finish", "Finish")}
            onVerify={async (flowId, code) => {
              const response = await completeEmailChange(
                url,
                props.account,
                flowId,
                code,
              );
              setAccount({ ...props.account, email: response.user.email });
              showToast(
                t("toasts.emailChangeSuccess", "Email updated successfully!"),
                "success",
              );
              handleClose();
            }}
            onResend={(challengeId) => resendOtp(url, challengeId)}
            onBack={() => {
              setStep("form");
              setOldEmailChallenge(null);
              setNewEmailChallenge(null);
            }}
          />
        ) : (
          <LargeCard compact className="!bg-modal-background">
            <LargeCardText
              compact
              title={t("settings.account.security.emailTitle", "Change email")}
            >
              {t(
                "settings.account.security.emailDescription",
                "We will verify your current and new email addresses.",
              )}
            </LargeCardText>
            <div className="space-y-4">
              {props.account.email ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-type-secondary">
                    {t(
                      "settings.account.security.currentEmailLabel",
                      "Current email",
                    )}
                  </p>
                  <p className="rounded-lg bg-authentication-inputBg/60 px-4 py-2.5 text-sm text-type-emphasis">
                    {props.account.email}
                  </p>
                </div>
              ) : null}
              <AuthInputBox
                label={t(
                  "settings.account.security.newEmailLabel",
                  "New email address",
                )}
                value={newEmail}
                onChange={setNewEmail}
                autoComplete="email"
                placeholder={t(
                  "auth.register.emailPlaceholder",
                  "Enter your email address",
                )}
              />
            </div>
            {error ? (
              <p className="mt-3 text-center text-authentication-errorText">
                {error}
              </p>
            ) : null}
            <LargeCardButtons compact splitAlign>
              <Button theme="secondary" onClick={handleClose}>
                {t("onboarding.defaultConfirm.cancel", "Cancel")}
              </Button>
              <Button
                theme="purple"
                loading={emailRequest.loading}
                disabled={!newEmail.trim()}
                onClick={requestEmail}
              >
                {t("auth.otp.send", "Send code")}
              </Button>
            </LargeCardButtons>
          </LargeCard>
        )}
      </div>
    </Modal>
  );
}

export function PasswordChangeModal(props: {
  id: string;
  close: () => void;
  account: AccountWithToken;
}) {
  const { t } = useTranslation();
  const url = useBackendUrl();
  const setAccount = useAuthStore((state) => state.setAccount);
  const showToast = useToastStore((state) => state.showToast);

  const [step, setStep] = useState<"form" | "otp">("form");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChallenge, setPasswordChallenge] =
    useState<OtpChallengeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setStep("form");
    setPassword("");
    setConfirmPassword("");
    setPasswordChallenge(null);
    setError(null);
    props.close();
  };

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
      const challenge = await requestPasswordChange(url, props.account);
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
  }, [confirmPassword, password, props.account, showToast, t, url]);

  return (
    <Modal id={props.id}>
      <div className="relative pointer-events-auto w-full max-w-[34rem] p-4">
        <div className="absolute right-7 top-7 z-20">
          <button
            type="button"
            className="rounded-full p-2 text-type-secondary transition-colors hover:bg-white/10 hover:text-white"
            onClick={handleClose}
            aria-label={t("overlays.close", "Close")}
          >
            <IconPatch icon={Icons.X} />
          </button>
        </div>
        {step === "otp" && passwordChallenge && url ? (
          <OtpVerificationPart
            title={t("auth.otp.passwordChangeTitle", "Confirm password change")}
            description={t(
              "auth.otp.passwordChangeDescription",
              "Enter the code sent to your email.",
            )}
            challenge={passwordChallenge}
            submitLabel={t("auth.otp.finish", "Finish")}
            onVerify={async (challengeId, code) => {
              const keys = await keysFromMnemonic(password);
              const device = await encryptData("Browser", keys.seed);
              const response = await completePasswordChange(
                url,
                props.account,
                challengeId,
                code,
                bytesToBase64Url(keys.publicKey),
                device,
              );
              setAccount({
                ...props.account,
                seed: bytesToBase64(keys.seed),
                deviceName: device,
                nickname: response.user.nickname,
                email: response.user.email ?? props.account.email,
                profile: response.user.profile,
              });
              showToast(
                t(
                  "toasts.passwordChangeSuccess",
                  "Password changed successfully!",
                ),
                "success",
              );
              handleClose();
            }}
            onResend={(challengeId) => resendOtp(url, challengeId)}
            onBack={() => setStep("form")}
          />
        ) : (
          <LargeCard compact className="!bg-modal-background">
            <LargeCardText
              compact
              title={t(
                "settings.account.security.passwordTitle",
                "Change password",
              )}
            >
              {t(
                "settings.account.security.passwordDescription",
                "We will send a verification code to your account email.",
              )}
            </LargeCardText>
            <div className="space-y-4">
              <AuthInputBox
                label={t("auth.login.passwordLabel", "Password")}
                value={password}
                onChange={setPassword}
                passwordToggleable
                autoComplete="new-password"
                placeholder={t(
                  "auth.register.passwordPlaceholder",
                  "Create a password",
                )}
              />
              <AuthInputBox
                label={t(
                  "auth.register.confirmPasswordLabel",
                  "Confirm Password",
                )}
                value={confirmPassword}
                onChange={setConfirmPassword}
                passwordToggleable
                autoComplete="new-password"
                placeholder={t(
                  "auth.register.confirmPasswordPlaceholder",
                  "Confirm your password",
                )}
              />
            </div>
            {error ? (
              <p className="mt-3 text-center text-authentication-errorText">
                {error}
              </p>
            ) : null}
            <LargeCardButtons compact splitAlign>
              <Button theme="secondary" onClick={handleClose}>
                {t("onboarding.defaultConfirm.cancel", "Cancel")}
              </Button>
              <Button
                theme="purple"
                loading={passwordRequest.loading}
                disabled={!password || !confirmPassword}
                onClick={requestPassword}
              >
                {t("auth.otp.send", "Send code")}
              </Button>
            </LargeCardButtons>
          </LargeCard>
        )}
      </div>
    </Modal>
  );
}
