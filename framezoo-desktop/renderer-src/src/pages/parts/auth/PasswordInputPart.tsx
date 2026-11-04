import { useCallback, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { createPasskey, isPasskeySupported } from "@/backend/accounts/crypto";
import { checkEmailExists, checkNicknameExists } from "@/backend/accounts/user";
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
  email?: string;
  password: string;
  credentialId?: string;
  rememberMe?: boolean;
}

interface PasswordInputPartProps {
  onNext?: (data: PasswordInputData) => void;
  forLogin?: boolean;
  compact?: boolean;
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
  const [email, setEmail] = useState("");
  const [hasEmailError, setHasEmailError] = useState(false);
  const [emailErrorText, setEmailErrorText] = useState("");
  const { t } = useTranslation();
  const backendUrl = useBackendUrl();

  const [rememberMe, setRememberMe] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [hasLoadedSaved, setHasLoadedSaved] = useState(false);

  useEffect(() => {
    if (props.forLogin && !hasLoadedSaved) {
      window.electronAPI?.secureStoreGet?.("saved_login").then((data) => {
        if (data) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.username) setNickname(parsed.username);
            if (parsed.password) setPassword(parsed.password);
            setRememberMe(true);
          } catch {
            // Ignore parsing errors
          }
        }
        setHasLoadedSaved(true);
      });
    }
  }, [props.forLogin, hasLoadedSaved]);

  const [checkResult, checkAccountDuplicates] = useAsyncFn(
    async (name: string, emailValue: string) => {
      if (!backendUrl) return { nicknameExists: false, emailExists: false };
      const [nicknameExists, emailExists] = await Promise.all([
        checkNicknameExists(backendUrl, name),
        checkEmailExists(backendUrl, emailValue),
      ]);
      return { nicknameExists, emailExists };
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
      setHasEmailError(false);

      const trimmedNickname = nickname.trim();
      if (trimmedNickname.length === 0) {
        setHasNicknameError(true);
        setNicknameErrorText(
          props.forLogin
            ? (t("auth.login.identifierRequired") ??
                "Username or email is required")
            : (t("auth.register.nicknameRequired") ?? "Nickname is required"),
        );
        return null;
      }

      if (props.forLogin) {
        // Login: accept either a username or an email address.
        if (!options?.skipPassword && !password) {
          setHasPasswordError(true);
          setPasswordErrorText(
            t("auth.login.passwordRequired") ?? "Password is required",
          );
          return null;
        }
      } else {
        const trimmedEmail = email.trim().toLowerCase();
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) ||
          trimmedEmail.length > 255
        ) {
          setHasEmailError(true);
          setEmailErrorText(
            t("auth.register.emailInvalid") ?? "Enter a valid email address",
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

        // Check both nickname and email availability before advancing
        const { nicknameExists, emailExists } = await checkAccountDuplicates(
          trimmedNickname,
          trimmedEmail,
        );
        if (nicknameExists) {
          setHasNicknameError(true);
          setNicknameErrorText(
            t("auth.register.nicknameTaken") ?? "Nickname is already taken",
          );
        }
        if (emailExists) {
          setHasEmailError(true);
          setEmailErrorText(
            t("auth.register.emailTaken") ?? "Email is already registered",
          );
        }
        if (nicknameExists || emailExists) {
          return null;
        }
      }

      return {
        nickname: trimmedNickname,
        email: props.forLogin ? undefined : email.trim().toLowerCase(),
      };
    },
    [
      nickname,
      password,
      confirmPassword,
      props.forLogin,
      checkAccountDuplicates,
      validatePassword,
      t,
      email,
    ],
  );

  const nextStep = useCallback(async () => {
    if (!props.forLogin && !acceptedLegal) return;
    const accountFields = await validateAccountFields();
    if (!accountFields) return;

    props.onNext?.({
      nickname: accountFields.nickname,
      email: accountFields.email,
      password,
      rememberMe,
    });
  }, [acceptedLegal, password, props, validateAccountFields, rememberMe]);

  const handlePasskeyNext = useCallback(async () => {
    if (props.forLogin || !acceptedLegal) return;

    const accountFields = await validateAccountFields({ skipPassword: true });
    if (!accountFields) return;

    const credentialId = await createPasskeyForAccount(accountFields.nickname);
    if (!credentialId) return;

    props.onNext?.({
      nickname: accountFields.nickname,
      email: accountFields.email,
      password: "",
      credentialId,
    });
  }, [acceptedLegal, createPasskeyForAccount, props, validateAccountFields]);

  const handleFormSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (props.submitLoading || checkResult.loading) return;
      void nextStep();
    },
    [props.submitLoading, checkResult.loading, nextStep],
  );

  const loading = props.submitLoading || checkResult.loading;
  const registrationBlocked = !props.forLogin && !acceptedLegal;

  const formContent = (
    <form
      className="space-y-4"
      onSubmit={handleFormSubmit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (loading || passkeyResult.loading || registrationBlocked) return;
          void nextStep();
        }
      }}
    >
      <AuthInputBox
        label={
          props.forLogin
            ? (t("auth.login.identifierLabel") ?? "Username or email")
            : (t("auth.register.nicknameLabel") ?? "Choose a nickname")
        }
        value={nickname}
        onChange={(value) => setNickname(value.replace(/\s/g, ""))}
        name="username"
        autoComplete="username"
        placeholder={
          props.forLogin
            ? (t("auth.login.identifierPlaceholder") ??
              "Enter your username or email")
            : (t("auth.register.nicknamePlaceholder") ??
              "Choose a unique nickname")
        }
      />
      {!props.forLogin && (
        <>
          <AuthInputBox
            label={t("auth.register.emailLabel") ?? "Email address"}
            value={email}
            onChange={setEmail}
            name="email"
            autoComplete="email"
            placeholder={
              t("auth.register.emailPlaceholder") ?? "Enter your email address"
            }
          />
          <label className="flex items-start gap-2 text-sm text-type-text cursor-pointer">
            <input
              type="checkbox"
              className="form-checkbox mt-1 shrink-0 rounded text-authentication-buttonBg"
              checked={acceptedLegal}
              onChange={(event) => setAcceptedLegal(event.target.checked)}
              required
            />
            <span>
              <Trans
                i18nKey="auth.register.legalConsent"
                components={{
                  terms: (
                    <a
                      href="https://framezoo.top/legal/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-type-link underline hover:text-type-linkHover"
                    />
                  ),
                  privacy: (
                    <a
                      href="https://framezoo.top/legal/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-type-link underline hover:text-type-linkHover"
                    />
                  ),
                }}
              />
            </span>
          </label>
        </>
      )}
      <AuthInputBox
        label={
          props.forLogin
            ? (t("auth.login.passwordLabel") ?? "Password")
            : (t("auth.register.passwordLabel") ?? "Password")
        }
        value={password}
        onChange={setPassword}
        name="password"
        autoComplete={props.forLogin ? "current-password" : "new-password"}
        placeholder={
          props.forLogin
            ? (t("auth.login.passwordPlaceholder") ?? "Enter your password")
            : (t("auth.register.passwordPlaceholder") ?? "Create a password")
        }
        passwordToggleable
      />
      {!props.forLogin && (
        <AuthInputBox
          label={t("auth.register.confirmPasswordLabel") ?? "Confirm Password"}
          value={confirmPassword}
          onChange={setConfirmPassword}
          name="confirmPassword"
          autoComplete="new-password"
          placeholder={
            t("auth.register.confirmPasswordPlaceholder") ??
            "Confirm your password"
          }
          passwordToggleable
        />
      )}
      {props.forLogin && (
        <label className="flex items-center space-x-2 cursor-pointer mt-4">
          <input
            type="checkbox"
            className="form-checkbox text-authentication-buttonBg rounded"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span className="text-white">
            {t("auth.login.rememberMe") ?? "Remember my password"}
          </span>
        </label>
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
      {!props.forLogin && hasEmailError ? (
        <p className="text-authentication-errorText">{emailErrorText}</p>
      ) : null}
      {!props.forLogin && passkeyResult.error ? (
        <p className="text-authentication-errorText">
          {passkeyResult.error.message}
        </p>
      ) : null}

      <LargeCardButtons compact={props.compact}>
        {!props.forLogin && isPasskeySupported() ? (
          <Button
            theme="secondary"
            onClick={() => void handlePasskeyNext()}
            loading={passkeyResult.loading}
            disabled={loading || passkeyResult.loading || registrationBlocked}
          >
            <Icon icon={Icons.LOCK} className="mr-2" />
            {t("auth.generate.usePasskeyInstead")}
          </Button>
        ) : null}
        <Button
          theme="purple"
          type="submit"
          onClick={(e) => {
            e.preventDefault();
            if (loading || passkeyResult.loading || registrationBlocked) return;
            void nextStep();
          }}
          loading={loading}
          disabled={loading || passkeyResult.loading || registrationBlocked}
        >
          {props.forLogin
            ? (t("auth.login.submit") ?? "Login")
            : (t("auth.register.information.next") ?? "Next")}
        </Button>
      </LargeCardButtons>
    </form>
  );

  if (props.forLogin) {
    return formContent;
  }

  return (
    <LargeCard compact={props.compact}>
      <LargeCardText
        compact={props.compact}
        title={t("auth.register.passwordInput.title") ?? undefined}
      >
        {t("auth.register.passwordInput.description") ?? undefined}
      </LargeCardText>
      {formContent}
    </LargeCard>
  );
}
