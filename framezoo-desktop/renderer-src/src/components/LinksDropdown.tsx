import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { base64ToBuffer, decryptData } from "@/backend/accounts/crypto";
import { getRoomStatuses } from "@/backend/player/status";
import { UserAvatar } from "@/components/Avatar";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Icon, Icons } from "@/components/Icon";
import { Spinner } from "@/components/layout/Spinner";
import { OverlayPortal } from "@/components/overlays/OverlayDisplay";
import { Transition } from "@/components/utils/Transition";
import { useAuth } from "@/hooks/auth/useAuth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useAuthStore } from "@/stores/auth";
import { useOverlayStack } from "@/stores/interface/overlayStack";

function Divider() {
  return <hr className="border-0 w-full h-px bg-dropdown-border" />;
}

function GoToLink(props: {
  children: React.ReactNode;
  href?: string;
  className?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();

  const goTo = (href: string) => {
    if (href.startsWith("http")) {
      window.open(href, "_blank");
    } else {
      window.scrollTo(0, 0);
      navigate(href);
    }
  };

  return (
    <a
      tabIndex={0}
      href={props.href}
      onClick={(evt) => {
        evt.preventDefault();
        if (props.href) goTo(props.href);
        else props.onClick?.();
      }}
      className={props.className}
    >
      {props.children}
    </a>
  );
}

function DropdownLink(props: {
  children: React.ReactNode;
  href?: string;
  icon?: Icons;
  highlight?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <GoToLink
      onClick={props.onClick}
      href={props.href}
      className={classNames(
        "tabbable cursor-pointer flex gap-3 items-center m-3 p-1 rounded font-medium transition-colors duration-100",
        props.highlight
          ? "text-dropdown-highlight hover:text-dropdown-highlightHover"
          : "text-dropdown-text hover:text-white",
        props.className,
      )}
    >
      {props.icon ? <Icon icon={props.icon} className="text-xl" /> : null}
      {props.children}
    </GoToLink>
  );
}

function parseWatchPartyCode(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const normalized = value.toUpperCase();
  if (!normalized.includes("HTTP://") && !normalized.includes("HTTPS://")) {
    return normalized;
  }

  try {
    const parsed = new URL(value);
    const code = parsed.searchParams.get("watchparty");
    if (!code) return null;
    return code.trim().toUpperCase();
  } catch {
    return null;
  }
}

export function WatchPartyJoinDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backendUrl = useBackendUrl();
  const account = useAuthStore((s) => s.account);

  const requestLogin = () => {
    useOverlayStack.getState().showModal("auth", { mode: "login" });
  };

  useEffect(() => {
    if (!open) {
      setCode("");
      setError(null);
      setIsLoading(false);
      return;
    }

    const onEsc = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) {
      requestLogin();
      return;
    }
    const parsedCode = parseWatchPartyCode(code);
    if (!parsedCode || !backendUrl) {
      setError(t("watchParty.invalidRoom"));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await getRoomStatuses(backendUrl, account, parsedCode);
      const allStatuses = Object.values(response.users).flat();

      if (allStatuses.length === 0) {
        setError(t("watchParty.emptyRoom"));
        return;
      }

      const hostUser = [...allStatuses]
        .sort((a, b) => b.timestamp - a.timestamp)
        .find((status) => status.isHost);
      if (!hostUser) {
        setError(t("watchParty.noHost"));
        return;
      }

      const { content } = hostUser;

      let targetUrl = "";
      if (
        content.type.toLowerCase() === "tv show" &&
        content.seasonId &&
        content.episodeId
      ) {
        targetUrl = `/media/tmdb-tv-${content.tmdbId}/${content.seasonId}/${content.episodeId}`;
      } else {
        targetUrl = `/media/tmdb-movie-${content.tmdbId}`;
      }

      const url = new URL(targetUrl, window.location.origin);
      url.searchParams.set("watchparty", parsedCode);

      navigate(url.pathname + url.search);
      setCode("");
      onClose();
    } catch (err) {
      console.error("Failed to fetch room data:", err);
      setError(t("watchParty.invalidRoom"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setCode("");
        setError(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  return (
    <OverlayPortal
      darken
      close={onClose}
      show={open}
      durationClass="duration-200"
      zIndex={1000}
    >
      <Helmet>
        <html data-no-scroll />
      </Helmet>
      <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-md rounded-2xl border border-dropdown-border bg-dropdown-altBackground/95 p-6 shadow-2xl backdrop-blur-xl"
          onClick={(evt) => evt.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-white">
              <Icon
                icon={Icons.WATCH_PARTY}
                className="text-xl text-buttons-purple"
              />
              <h3 className="text-base font-semibold">
                {t("player.menus.watchparty.watchpartyItem")}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-dropdown-text transition-colors hover:bg-dropdown-contentBackground hover:text-white"
              aria-label={t("watchParty.cancel")}
            >
              <Icon icon={Icons.X} className="text-lg" />
            </button>
          </div>

          <p className="mb-4 text-xs text-dropdown-text">
            {t("watchParty.enterCodeOrLink")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
              placeholder={`https://framezoo/...?...watchparty=ABCD123456`}
              className="w-full rounded-xl border border-dropdown-border bg-dropdown-contentBackground px-3.5 py-2.5 text-sm text-white placeholder-dropdown-text/60 outline-none transition-colors focus:border-type-link"
              disabled={isLoading}
            />

            {error && (
              <p className="text-xs font-medium text-red-400">{error}</p>
            )}

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-dropdown-text transition-colors hover:bg-dropdown-contentBackground hover:text-white"
                onClick={onClose}
              >
                {t("watchParty.cancel")}
              </button>
              <button
                type="submit"
                className={classNames(
                  "rounded-xl bg-buttons-purple px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-buttons-purpleHover hover:scale-105 active:scale-95",
                  (!code.trim() || isLoading) &&
                    "!cursor-not-allowed !scale-100 opacity-60 hover:bg-buttons-purple",
                )}
                disabled={!code.trim() || isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-1.5">
                    <Spinner className="h-4 w-4" />
                    {t("watchParty.validating")}
                  </span>
                ) : (
                  t("watchParty.join")
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </OverlayPortal>
  );
}

export function WatchPartyInputLink() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const account = useAuthStore((s) => s.account);

  const requestLogin = () => {
    useOverlayStack.getState().showModal("auth", { mode: "login" });
  };
  const openDialog = () => (account ? setOpen(true) : requestLogin());

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="shrink-0 flex items-center justify-center text-lg text-white tabbable rounded-full backdrop-blur-lg pointer-events-auto overflow-visible"
        aria-label={t("player.menus.watchparty.watchpartyItem")}
      >
        <IconPatch icon={Icons.WATCH_PARTY} clickable downsized navigation />
      </button>
      <WatchPartyJoinDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function LinksDropdown(props: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [watchPartyDialogOpen, setWatchPartyDialogOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null!);
  const nickname = useAuthStore((s) => s.account?.nickname);
  const deviceName = useAuthStore((s) => s.account?.deviceName);
  const seed = useAuthStore((s) => s.account?.seed);
  const account = useAuthStore((s) => s.account);
  const navigate = useNavigate();
  const bufferSeed = useMemo(
    () => (seed ? base64ToBuffer(seed) : null),
    [seed],
  );
  const { logout } = useAuth();

  const handleProtectedRoute = (path: string) => {
    if (account) {
      navigate(path);
    } else {
      useOverlayStack.getState().showModal("auth", { mode: "login" });
    }
  };

  useEffect(() => {
    if (!open) return;

    function onPointerDown(evt: MouseEvent) {
      if (
        dropdownRef.current &&
        dropdownRef.current.contains(evt.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const toggleOpen = useCallback(() => {
    setOpen((s) => !s);
  }, []);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        className={classNames(
          "cursor-pointer tabbable rounded-full flex gap-2 text-white items-center py-2 px-3 hover:bg-pill-backgroundHover backdrop-blur-lg transition-all duration-100 hover:scale-105",
          open ? "bg-pill-background/100" : "bg-pill-background/50",
        )}
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("navigation.menu.accountMenu")}
      >
        {props.children}
        <Icon
          className={classNames(
            "text-xl transition-transform duration-100",
            open ? "rotate-180" : "",
          )}
          icon={Icons.CHEVRON_DOWN}
        />
      </button>
      <Transition animation="slide-down" show={open}>
        <div className="absolute top-full right-0 z-10 mt-3 w-64 rounded-xl bg-dropdown-altBackground">
          {account ? (
            <DropdownLink className="text-white" href="/settings">
              <UserAvatar />
              {(() => {
                if (nickname?.trim()) return nickname;
                if (!deviceName || !bufferSeed)
                  return t("settings.account.devices.unknownDevice");
                try {
                  return decryptData(deviceName, bufferSeed);
                } catch (error) {
                  console.warn(
                    "Failed to decrypt device name in LinksDropdown, using fallback:",
                    error,
                  );
                  return t("settings.account.devices.unknownDevice");
                }
              })()}
            </DropdownLink>
          ) : (
            <DropdownLink
              onClick={() =>
                useOverlayStack.getState().showModal("auth", { mode: "login" })
              }
              icon={Icons.CLOUD_ARROW_UP}
              highlight
            >
              {t("navigation.menu.register")}
            </DropdownLink>
          )}
          <Divider />
          <DropdownLink
            onClick={() => handleProtectedRoute("/watch-history")}
            icon={Icons.CLOCK_OUTLINE}
          >
            {t("home.watchHistory.sectionTitle")}
          </DropdownLink>
          <DropdownLink
            onClick={() => handleProtectedRoute("/marked")}
            icon={Icons.BOOKMARK_OUTLINE}
          >
            {t("home.bookmarks.sectionTitle")}
          </DropdownLink>
          <DropdownLink href="/addons" icon={Icons.EXTENSION}>
            {t("navigation.menu.addons", "Addons")}
          </DropdownLink>
          <DropdownLink
            icon={Icons.WATCH_PARTY}
            onClick={() => {
              if (account) {
                setOpen(false);
                setWatchPartyDialogOpen(true);
              } else {
                useOverlayStack.getState().showModal("auth", { mode: "login" });
              }
            }}
          >
            {t("player.menus.watchparty.watchpartyItem")}
          </DropdownLink>
          <DropdownLink
            icon={Icons.FEEDBACK}
            onClick={() => {
              setOpen(false);
              useOverlayStack.getState().showModal("feedback");
            }}
          >
            {t("navigation.menu.feedback", "Phản hồi")}
          </DropdownLink>
          <DropdownLink href="/settings" icon={Icons.SETTINGS}>
            {t("navigation.menu.settings")}
          </DropdownLink>
          {account ? (
            <DropdownLink
              className="!text-type-danger opacity-75 hover:opacity-100"
              icon={Icons.LOGOUT}
              onClick={logout}
            >
              {t("navigation.menu.logout")}
            </DropdownLink>
          ) : null}
          <Divider />
        </div>
      </Transition>
      <WatchPartyJoinDialog
        open={watchPartyDialogOpen}
        onClose={() => setWatchPartyDialogOpen(false)}
      />
    </div>
  );
}
