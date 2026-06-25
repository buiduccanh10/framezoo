import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AppDownloadManifest,
  getAppDownloadManifest,
} from "@/backend/download";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Icon, Icons } from "@/components/Icon";
import { Spinner } from "@/components/layout/Spinner";
import { Transition } from "@/components/utils/Transition";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";

export function DownloadAppButton() {
  const { t } = useTranslation();
  const backendUrl = useBackendUrl();
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState<AppDownloadManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleEsc = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        setOpen(false);
      }
    };

    const handlePointerDown = (evt: MouseEvent) => {
      if (
        dropdownRef.current &&
        dropdownRef.current.contains(evt.target as Node)
      ) {
        return;
      }

      setOpen(false);
    };

    window.addEventListener("keydown", handleEsc);
    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleEsc);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (!backendUrl) {
      setManifest(null);
      setError(
        t("navigation.download.unavailable", {
          defaultValue: "No backend URL is configured.",
        }),
      );
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);

    void getAppDownloadManifest(backendUrl)
      .then((nextManifest) => {
        if (cancelled) return;
        setManifest(nextManifest);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        console.error("Failed to load app download manifest:", fetchError);
        setManifest(null);
        setError(
          t("navigation.download.failed", {
            defaultValue: "Failed to load download options.",
          }),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, backendUrl, t]);

  if (!backendUrl) return null;

  return (
    <div ref={dropdownRef} className="relative pointer-events-auto">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-lg text-white tabbable rounded-full backdrop-blur-lg pointer-events-auto shrink-0"
        aria-label={t("navigation.download.label", {
          defaultValue: "Download app",
        })}
      >
        <IconPatch
          icon={Icons.DOWNLOAD}
          clickable
          downsized
          navigation
          active={open}
        />
      </button>

      <Transition animation="slide-down" show={open}>
        <div className="absolute right-0 top-full z-50 mt-3 w-80 rounded-xl border border-dropdown-border bg-dropdown-altBackground p-2 shadow-xl">
          <div className="px-3 py-2">
            <div className="text-sm font-semibold text-white">
              {t("navigation.download.label", {
                defaultValue: "Download app",
              })}
            </div>
            <div className="text-xs text-dropdown-text">
              {manifest?.version ? `v${manifest.version}` : backendUrl}
            </div>
          </div>

          <div className="mb-1 h-px bg-dropdown-border" />

          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Spinner className="h-5 w-5 text-white" />
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-sm text-dropdown-text">{error}</div>
          ) : manifest?.options.length ? (
            <div className="space-y-1">
              {manifest.options.map((option) => (
                <a
                  key={option.id}
                  href={option.url}
                  target="_blank"
                  rel="noreferrer"
                  className={classNames(
                    "flex items-start gap-3 rounded-lg px-3 py-2 text-dropdown-text transition-colors hover:bg-dropdown-contentBackground hover:text-white",
                  )}
                >
                  <Icon icon={Icons.DOWNLOAD} className="mt-0.5 text-lg" />
                  <div className="min-w-0">
                    <div className="font-medium text-white">{option.label}</div>
                    <div className="text-xs text-dropdown-text">
                      {option.description}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-sm text-dropdown-text">
              {t("navigation.download.empty", {
                defaultValue: "No downloads are configured yet.",
              })}
            </div>
          )}
        </div>
      </Transition>
    </div>
  );
}
