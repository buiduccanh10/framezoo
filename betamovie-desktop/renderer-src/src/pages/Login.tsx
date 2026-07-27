import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/buttons/Button";
import { BackendSelector } from "@/components/form/BackendSelector";
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { AuthDialog } from "@/components/overlays/AuthDialog";
import { LoginFormPart } from "@/pages/parts/auth/LoginFormPart";
import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";
import { usePreviewThemeStore } from "@/stores/theme";

export function LoginPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const state = location.state as
    | { from?: { pathname: string; search?: string; hash?: string } }
    | undefined;
  const setPreviewTheme = usePreviewThemeStore((s) => s.setPreviewTheme);
  const setBackendUrl = useAuthStore((s) => s.setBackendUrl);
  const config = conf();
  const availableBackends =
    config.BACKEND_URLS.length > 0
      ? config.BACKEND_URLS
      : config.BACKEND_URL
        ? [config.BACKEND_URL]
        : [];

  // If there's only one backend and user hasn't selected a custom one, auto-select it
  const currentBackendUrl = useAuthStore((s) => s.backendUrl);
  const defaultBackend =
    currentBackendUrl ??
    (availableBackends.length === 1 ? availableBackends[0] : null);

  const [showBackendSelection, setShowBackendSelection] = useState(true);
  const [selectedBackendUrl, setSelectedBackendUrl] = useState<string | null>(
    currentBackendUrl ?? null,
  );

  useEffect(() => {
    setPreviewTheme("ember");
    return () => {
      setPreviewTheme(null);
    };
  }, [setPreviewTheme]);

  const handleBackendSelect = (url: string | null) => {
    setSelectedBackendUrl(url);
    if (url) {
      setBackendUrl(url);
    }
  };

  const handleContinue = () => {
    if (selectedBackendUrl || defaultBackend) {
      if (selectedBackendUrl) {
        setBackendUrl(selectedBackendUrl);
      } else if (defaultBackend) {
        setBackendUrl(defaultBackend);
      }
      setShowBackendSelection(false);
    }
  };

  const content =
    showBackendSelection &&
    (availableBackends.length > 1 || !defaultBackend) ? (
      <LargeCard compact>
        <LargeCardText compact title={t("auth.backendSelection.title")}>
          {t("auth.backendSelection.description")}
        </LargeCardText>
        <BackendSelector
          selectedUrl={selectedBackendUrl ?? defaultBackend}
          onSelect={handleBackendSelect}
          availableUrls={availableBackends}
          showCustom
        />
        <LargeCardButtons compact>
          <span className="text-type-danger font-medium text-center">
            {t("settings.connections.server.notice")}
          </span>
          <Button
            theme="purple"
            onClick={handleContinue}
            disabled={!selectedBackendUrl && !defaultBackend}
          >
            {t("auth.register.information.next")}
          </Button>
        </LargeCardButtons>
      </LargeCard>
    ) : (
      <LoginFormPart
        onLogin={() => {
          const destination = state?.from
            ? `${state.from.pathname}${state.from.search || ""}${state.from.hash || ""}`
            : "/discover";
          navigate(destination, { replace: true });
        }}
        onRegister={() =>
          navigate("/register", {
            state: location.state,
            replace: true,
          })
        }
      />
    );

  return content;
}

export function LoginPage() {
  return (
    <AuthDialog mode="login">
      <LoginPanel />
    </AuthDialog>
  );
}
