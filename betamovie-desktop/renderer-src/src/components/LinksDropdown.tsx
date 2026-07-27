import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { base64ToBuffer, decryptData } from "@/backend/accounts/crypto";
import { getRoomStatuses } from "@/backend/player/status";
import { UserAvatar } from "@/components/Avatar";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Icon, Icons } from "@/components/Icon";
import { Spinner } from "@/components/layout/Spinner";
import { Transition } from "@/components/utils/Transition";
import { useAuth } from "@/hooks/auth/useAuth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useAuthStore } from "@/stores/auth";

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

export function WatchPartyInputLink({
  triggerVariant = "dropdown",
}: {
  triggerVariant?: "dropdown" | "icon";
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backendUrl = useBackendUrl();
  const account = useAuthStore((s) => s.account);

  const requestLogin = () => {
    navigate("/login", {
      state: {
        from: location,
        backgroundLocation: {
          pathname: "/discover",
          search: "",
          hash: "",
        },
      },
      replace: true,
    });
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
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

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
      setOpen(false);
    } catch (err) {
      console.error("Failed to fetch room data:", err);
      setError(t("watchParty.invalidRoom"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {triggerVariant === "dropdown" ? (
        <DropdownLink
          icon={Icons.WATCH_PARTY}
          onClick={() => (account ? setOpen(true) : requestLogin())}
          className="text-dropdown-text hover:text-white"
        >
          {t("player.menus.watchparty.watchpartyItem")}
        </DropdownLink>
      ) : (
        <button
          type="button"
          onClick={() => (account ? setOpen(true) : requestLogin())}
          className="text-lg text-white tabbable rounded-full backdrop-blur-lg pointer-events-auto"
          aria-label={t("player.menus.watchparty.watchpartyItem")}
        >
          <IconPatch icon={Icons.WATCH_PARTY} clickable downsized navigation />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-dropdown-border bg-dropdown-altBackground p-4 shadow-xl"
            onClick={(evt) => evt.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <Icon icon={Icons.WATCH_PARTY} className="text-xl" />
                <h3 className="text-base font-semibold">
                  {t("player.menus.watchparty.watchpartyItem")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-dropdown-text transition-colors hover:bg-dropdown-contentBackground hover:text-white"
                aria-label={t("watchParty.cancel")}
              >
                <Icon icon={Icons.X} className="text-lg" />
              </button>
            </div>

            <p className="mb-3 text-sm text-dropdown-text">
              {t("watchParty.enterCodeOrLink")}
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
                placeholder={`https://alpha.flix/...?...watchparty=ABCD123456`}
                className="w-full rounded-lg border border-dropdown-border bg-dropdown-contentBackground px-3 py-2 text-white outline-none transition-colors focus:border-type-link"
                disabled={isLoading}
              />

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-sm text-dropdown-text transition-colors hover:bg-dropdown-contentBackground hover:text-white"
                  onClick={() => setOpen(false)}
                >
                  {t("watchParty.cancel")}
                </button>
                <button
                  type="submit"
                  className={classNames(
                    "rounded-lg bg-buttons-purple px-3 py-2 text-sm text-white transition-colors hover:bg-buttons-purpleHover",
                    (!code.trim() || isLoading) &&
                      "cursor-not-allowed opacity-70 hover:bg-buttons-purple",
                  )}
                  disabled={!code.trim() || isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center gap-1">
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
      )}
    </>
  );
}

export function LinksDropdown(props: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const nickname = useAuthStore((s) => s.account?.nickname);
  const deviceName = useAuthStore((s) => s.account?.deviceName);
  const seed = useAuthStore((s) => s.account?.seed);
  const bufferSeed = useMemo(
    () => (seed ? base64ToBuffer(seed) : null),
    [seed],
  );
  const { logout } = useAuth();

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
          "cursor-pointer tabbable rounded-full flex gap-2 text-white items-center py-2 px-3 bg-pill-background hover:bg-pill-backgroundHover backdrop-blur-lg transition-all duration-100 hover:scale-105",
          open ? "bg-opacity-100" : "bg-opacity-50",
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
          {deviceName && bufferSeed ? (
            <DropdownLink className="text-white" href="/settings">
              <UserAvatar />
              {(() => {
                if (nickname?.trim()) return nickname;
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
            <DropdownLink href="/login" icon={Icons.CLOUD_ARROW_UP} highlight>
              {t("navigation.menu.register")}
            </DropdownLink>
          )}
          <Divider />
          <DropdownLink href="/watch-history" icon={Icons.CLOCK}>
            {t("home.watchHistory.sectionTitle")}
          </DropdownLink>
          <DropdownLink href="/addons" icon={Icons.EXTENSION}>
            {t("navigation.menu.addons", "Addons")}
          </DropdownLink>
          <DropdownLink href="/marked" icon={Icons.BOOKMARK}>
            {t("home.bookmarks.sectionTitle")}
          </DropdownLink>
          <WatchPartyInputLink />
          <DropdownLink href="/settings" icon={Icons.SETTINGS}>
            {t("navigation.menu.settings")}
          </DropdownLink>
          {deviceName ? (
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
    </div>
  );
}
