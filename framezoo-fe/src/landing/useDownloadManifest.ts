import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AppDownloadManifest,
  getAppDownloadManifest,
  validateAppDownloadManifest,
} from "@/backend/download";

export type DownloadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; manifest: AppDownloadManifest };

interface DownloadMessages {
  error: string;
  noBackend: string;
}

const MANIFEST_CACHE_PREFIX = "framezoo:download-manifest:";

function getManifestCacheKey(backendUrl: string) {
  return `${MANIFEST_CACHE_PREFIX}${backendUrl}`;
}

export function readCachedManifest(
  backendUrl: string,
): AppDownloadManifest | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getManifestCacheKey(backendUrl));
    if (!raw) return null;

    const manifest = validateAppDownloadManifest(JSON.parse(raw), backendUrl);
    return manifest.options.length > 0 ? manifest : null;
  } catch {
    return null;
  }
}

export function writeCachedManifest(
  backendUrl: string,
  manifest: AppDownloadManifest | null,
) {
  if (typeof window === "undefined") return;

  try {
    const key = getManifestCacheKey(backendUrl);
    if (!manifest || manifest.options.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(manifest));
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
}

export function useDownloadManifest(
  backendUrl: string | null,
  messages: DownloadMessages,
  enabled = true,
) {
  const [state, setState] = useState<DownloadState>(() => {
    if (enabled && backendUrl) {
      const cached = readCachedManifest(backendUrl);
      if (cached) return { status: "ready", manifest: cached };
    }
    return { status: "loading" };
  });
  const requestIdRef = useRef(0);

  const fetchManifest = useCallback(
    (background: boolean) => {
      if (!enabled) return;

      if (!backendUrl) {
        setState({ status: "error", message: messages.noBackend });
        return;
      }

      const requestId = ++requestIdRef.current;
      if (!background) {
        setState({ status: "loading" });
      }

      void getAppDownloadManifest(backendUrl)
        .then((manifest) => {
          if (requestId !== requestIdRef.current) return;
          if (manifest.options.length === 0) {
            writeCachedManifest(backendUrl, null);
            setState({ status: "empty" });
            return;
          }

          writeCachedManifest(backendUrl, manifest);
          setState({ status: "ready", manifest });
        })
        .catch((error: unknown) => {
          if (requestId !== requestIdRef.current) return;
          console.error("Failed to load desktop download manifest:", error);
          if (!background) {
            setState({ status: "error", message: messages.error });
          }
        });
    },
    [backendUrl, enabled, messages.error, messages.noBackend],
  );

  const loadManifest = useCallback(() => {
    fetchManifest(false);
  }, [fetchManifest]);

  useEffect(() => {
    if (!enabled) return;

    const cached = backendUrl ? readCachedManifest(backendUrl) : null;
    if (cached) {
      setState({ status: "ready", manifest: cached });
    }
    fetchManifest(cached !== null);

    return () => {
      requestIdRef.current += 1;
    };
  }, [backendUrl, enabled, fetchManifest]);

  return { state, loadManifest };
}
