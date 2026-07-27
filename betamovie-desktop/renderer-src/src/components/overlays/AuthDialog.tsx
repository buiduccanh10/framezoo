import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { IconPatch } from "@/components/buttons/IconPatch";
import { Icon, Icons } from "@/components/Icon";
import { OverlayPortal } from "@/components/overlays/OverlayDisplay";

type AuthDialogMode = "login" | "register";

interface AuthDialogState {
  backgroundLocation?: {
    pathname: string;
    search?: string;
    hash?: string;
  };
}

function formatLocation(location: {
  pathname: string;
  search?: string;
  hash?: string;
}) {
  return `${location.pathname}${location.search || ""}${location.hash || ""}`;
}

export function AuthDialog(props: {
  mode: AuthDialogMode;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const state = location.state as AuthDialogState | null;
  const [isOpen, setIsOpen] = useState(true);
  const closeTimer = useRef<number | null>(null);
  const isClosing = useRef(false);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
      }
    };
  }, []);

  const closeDestination = () =>
    formatLocation(
      state?.backgroundLocation ?? {
        pathname: "/discover",
      },
    );

  const close = () => {
    if (isClosing.current) return;

    isClosing.current = true;
    setIsOpen(false);
    closeTimer.current = window.setTimeout(() => {
      navigate(closeDestination(), { replace: true });
    }, 500);
  };

  const goBack = () => {
    if (props.mode === "register") {
      navigate("/login", {
        state: location.state,
        replace: true,
      });
      return;
    }

    close();
  };

  return (
    <OverlayPortal
      darken
      close={close}
      show={isOpen}
      durationClass="duration-500"
      zIndex={1200}
    >
      <Helmet>
        <html data-no-scroll />
      </Helmet>
      <div className="absolute inset-0 flex items-center justify-center p-2 pt-safe sm:p-4">
        <div
          className="pointer-events-auto flex max-h-[calc(100dvh-1rem)] min-h-0 w-[95%] max-w-[680px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-background-main/95 p-3 shadow-2xl backdrop-blur-xl sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={
            props.mode === "login"
              ? t("auth.login.title", "Login")
              : t("auth.register.title", "Register")
          }
        >
          <div className="flex shrink-0 items-center justify-between px-1 pb-2 sm:px-2">
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-type-secondary transition-colors hover:bg-white/10 hover:text-white"
              onClick={goBack}
              aria-label={t("discover.page.back", "Go back")}
            >
              <Icon icon={Icons.ARROW_LEFT} className="text-sm" />
              <span>{t("discover.page.back", "Go back")}</span>
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-type-secondary transition-colors hover:bg-white/10 hover:text-white"
              onClick={close}
              aria-label={t("overlays.close", "Close")}
            >
              <IconPatch icon={Icons.X} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
            <div
              key={props.mode}
              className="animate-[scaleIn_0.6s_ease-out_forwards]"
            >
              {props.children}
            </div>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
