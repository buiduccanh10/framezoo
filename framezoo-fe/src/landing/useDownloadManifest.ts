import { useCallback, useEffect, useState } from "react";

import {
  type AppDownloadManifest,
  getAppDownloadManifest,
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

export function useDownloadManifest(
  backendUrl: string | null,
  messages: DownloadMessages,
  enabled = true,
) {
  const [state, setState] = useState<DownloadState>({ status: "loading" });

  const loadManifest = useCallback(() => {
    if (!enabled) return;

    if (!backendUrl) {
      setState({ status: "error", message: messages.noBackend });
      return;
    }

    setState({ status: "loading" });
    void getAppDownloadManifest(backendUrl)
      .then((manifest) => {
        if (manifest.options.length === 0) {
          setState({ status: "empty" });
          return;
        }

        setState({ status: "ready", manifest });
      })
      .catch((error: unknown) => {
        console.error("Failed to load desktop download manifest:", error);
        setState({ status: "error", message: messages.error });
      });
  }, [backendUrl, enabled, messages.error, messages.noBackend]);

  useEffect(() => {
    if (enabled) loadManifest();
  }, [enabled, loadManifest]);

  return { state, loadManifest };
}
