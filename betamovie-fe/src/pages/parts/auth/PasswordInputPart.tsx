import { type KeyboardEvent, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { createPasskey, isPasskeySupported } from "@/backend/accounts/crypto";
import { checkNicknameExists, checkUserExists } from "@/backend/accounts/user";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";

export interface PasswordInputData {
  nickname: string;
  password: string;
  inviteCode?: string;
  credentialId?: string;
}

interface PasswordInputPartProps {
  onNext?: (data: PasswordInputData) => void;
  forLogin?: boolean;
  externalNicknameError?: string | null;
  externalPasswordError?: string | null;
  submitLoading?: boolean;
}

export function PasswordInputPart(props: PasswordInputPartProps) {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hasNicknameError, setHasNicknameError] = useState(false);
  const [hasPasswordError, setHasPasswordError] = useState(false);
  const [nicknameErrorText, setNicknameErrorText] = useState("");
  const [passwordErrorText, setPasswordErrorText] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [hasInviteError, setHasInviteError] = useState(false);
  const [inviteErrorText, setInviteErrorText] = useState("");
  const { t } = useTranslation();
  const backendUrl = useBackendUrl();

  const [checkResult, checkNickname] = useAsyncFn(
    async (name: string) => {
      if (!backendUrl) return null;
      return await checkNicknameExists(backendUrl, name);
    },
    [backendUrl],
  );

  const [, checkInvite] = useAsyncFn(
    async (code: string) => {
      if (!backendUrl) return false;
      const exists = await checkUserExists(backendUrl, code);
      return exists;
    },
    [backendUrl],
  );

  const [passkeyResult, createPasskeyForAccount] = useAsyncFn(
    async (name: string) => {
      if (!isPasskeySupported()) {
        throw new Error("Passkeys are not supported in this browser");
      }

      const credential = await createPasskey(
        `${backendUrl ?? window.location.origin}:${name}`,
        name,
      );

      return credential.id;
    },
    [backendUrl],
  );

  const validatePassword = useCallback((pwd: string): boolean => {
    // Password must be at least 8 characters and contain at least one letter and one digit
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d\W_]{8,}$/;
    return passwordRegex.test(pwd);
  }, []);

  const validateAccountFields = useCallback(
    async (options?: { skipPassword?: boolean }) => {
      setHasNicknameError(false);
      setHasPasswordError(false);
      setHasInviteError(false);

      const trimmedNickname = nickname.trim();
      if (trimmedNickname.length === 0) {
        setHasNicknameError(true);
        setNicknameErrorText(
          t("auth.login.nicknameRequired") ?? "Nickname is required",
        );
        return null;
      }

      if (props.forLogin) {
        // Login: only require nickname and password (no async checks)
        if (!options?.skipPassword && !password) {
          setHasPasswordError(true);
          setPasswordErrorText(
            t("auth.login.passwordRequired") ?? "Password is required",
          );
          return null;
        }
      } else {
        // For registration, check if nickname is already taken
        const exists = await checkNickname(trimmedNickname);
        if (exists) {
          setHasNicknameError(true);
          setNicknameErrorText(
            t("auth.register.nicknameTaken") ?? "Nickname is already taken",
          );
          return null;
        }

        if (!options?.skipPassword) {
          // Validate password for registration
          if (!validatePassword(password)) {
            setHasPasswordError(true);
            setPasswordErrorText(
              t("auth.register.passwordWeak") ??
                "Password must be at least 8 characters with letters and numbers",
            );
            return null;
          }

          if (password !== confirmPassword) {
            setHasPasswordError(true);
            setPasswordErrorText(
              t("auth.register.passwordMismatch") ?? "Passwords do not match",
            );
            return null;
          }
        }

        // Invite code required and must be a valid user id
        const trimmedInvite = inviteCode.trim();
        if (trimmedInvite.length === 0) {
          setHasInviteError(true);
          setInviteErrorText(
            t("auth.inviteCodeRequiredError") ?? "Invite code is required",
          );
          return null;
        }

        const inviteExists = await checkInvite(trimmedInvite);
        if (!inviteExists) {
          setHasInviteError(true);
          setInviteErrorText(
            t("auth.inviteCodeInvalidError") ??
              "Invalid invite code (User ID not found)",
          );
          return null;
        }
      }

      return {
        nickname: trimmedNickname,
        inviteCode: inviteCode.trim(),
      };
    },
    [
      nickname,
      password,
      confirmPassword,
      props.forLogin,
      checkNickname,
      checkInvite,
      validatePassword,
      t,
      inviteCode,
    ],
  );

  const nextStep = useCallback(async () => {
    const accountFields = await validateAccountFields();
    if (!accountFields) return;

    props.onNext?.({
      nickname: accountFields.nickname,
      password,
      inviteCode: accountFields.inviteCode,
    });
  }, [password, props, validateAccountFields]);

  const handlePasskeyNext = useCallback(async () => {
    if (props.forLogin) return;

    const accountFields = await validateAccountFields({ skipPassword: true });
    if (!accountFields) return;

    const credentialId = await createPasskeyForAccount(accountFields.nickname);
    if (!credentialId) return;

    props.onNext?.({
      nickname: accountFields.nickname,
      password: "",
      inviteCode: accountFields.inviteCode,
      credentialId,
    });
  }, [createPasskeyForAccount, props, validateAccountFields]);

  const handleLoginEnter = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        !props.forLogin ||
        event.key !== "Enter" ||
        props.submitLoading ||
        checkResult.loading
      )
        return;
      if (!(event.target instanceof HTMLInputElement)) return;

      event.preventDefault();
      void nextStep();
    },
    [props.forLogin, props.submitLoading, checkResult.loading, nextStep],
  );

  const loading = props.submitLoading || checkResult.loading;

  return (
    <LargeCard>
      {!props.forLogin && (
        <LargeCardText
          title={t("auth.register.passwordInput.title") ?? undefined}
        >
          {t("auth.register.passwordInput.description") ?? undefined}
        </LargeCardText>
      )}
      <div className="space-y-4" onKeyDown={handleLoginEnter}>
        <AuthInputBox
          label={
            props.forLogin
              ? (t("auth.login.nicknameLabel") ?? "Nickname")
              : (t("auth.register.nicknameLabel") ?? "Choose a nickname")
          }
          value={nickname}
          onChange={setNickname}
          placeholder={
            props.forLogin
              ? (t("auth.login.nicknamePlaceholder") ?? "Enter your nickname")
              : (t("auth.register.nicknamePlaceholder") ??
                "Choose a unique nickname")
          }
        />
        {!props.forLogin && (
          <AuthInputBox
            label={t("auth.inviteCodeLabel")}
            value={inviteCode}
            onChange={setInviteCode}
            placeholder={t("auth.inviteCodePlaceholder")}
          />
        )}
        <AuthInputBox
          label={
            props.forLogin
              ? (t("auth.login.passwordLabel") ?? "Password")
              : (t("auth.register.passwordLabel") ?? "Password")
          }
          value={password}
          onChange={setPassword}
          placeholder={
            props.forLogin
              ? (t("auth.login.passwordPlaceholder") ?? "Enter your password")
              : (t("auth.register.passwordPlaceholder") ?? "Create a password")
          }
          passwordToggleable
        />
        {!props.forLogin && (
          <AuthInputBox
            label={
              t("auth.register.confirmPasswordLabel") ?? "Confirm Password"
            }
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder={
              t("auth.register.confirmPasswordPlaceholder") ??
              "Confirm your password"
            }
            passwordToggleable
          />
        )}
        {hasNicknameError || props.externalNicknameError ? (
          <p className="text-authentication-errorText">
            {props.externalNicknameError ?? nicknameErrorText}
          </p>
        ) : null}
        {hasPasswordError || props.externalPasswordError ? (
          <p className="text-authentication-errorText">
            {props.externalPasswordError ?? passwordErrorText}
          </p>
        ) : null}
        {!props.forLogin && hasInviteError ? (
          <p className="text-authentication-errorText">{inviteErrorText}</p>
        ) : null}
        {!props.forLogin && passkeyResult.error ? (
          <p className="text-authentication-errorText">
            {passkeyResult.error.message}
          </p>
        ) : null}
      </div>
      <LargeCardButtons>
        {!props.forLogin && isPasskeySupported() ? (
          <Button
            theme="secondary"
            onClick={() => void handlePasskeyNext()}
            loading={passkeyResult.loading}
            disabled={loading || passkeyResult.loading}
          >
            <Icon icon={Icons.LOCK} className="mr-2" />
            {t("auth.generate.usePasskeyInstead")}
          </Button>
        ) : null}
        <Button
          theme="purple"
          onClick={() => nextStep()}
          loading={loading}
          disabled={loading || passkeyResult.loading}
        >
          {props.forLogin
            ? (t("auth.login.submit") ?? "Login")
            : (t("auth.register.information.next") ?? "Next")}
        </Button>
      </LargeCardButtons>
    </LargeCard>
  );
}
