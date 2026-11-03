import { useTranslation } from "react-i18next";

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
import {
  useEmailChange,
  usePasswordChange,
} from "@/hooks/auth/useAccountSecurity";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { OtpVerificationPart } from "@/pages/parts/auth/OtpVerificationPart";
import { AccountWithToken } from "@/stores/auth";

export function EmailChangeModal(props: {
  id: string;
  close: () => void;
  account: AccountWithToken;
}) {
  const { t } = useTranslation();
  const url = useBackendUrl();
  const {
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
  } = useEmailChange(props.account, url, props.close);

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
            onVerify={verifyOldEmailOtp}
            onResend={resendOtp}
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
            onVerify={completeEmailChangeOtp}
            onResend={resendOtp}
            onBack={resetToForm}
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
  const {
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
  } = usePasswordChange(props.account, url, props.close);

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
            onVerify={completePasswordChangeOtp}
            onResend={resendOtp}
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
