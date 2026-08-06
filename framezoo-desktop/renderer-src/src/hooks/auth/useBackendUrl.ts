import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";

function isDesktopAppRuntime() {
  return typeof window !== "undefined" && Boolean(window.__FRAMEZOO_DESKTOP__);
}

export function useBackendUrl(): string | null {
  const backendUrl = useAuthStore((s) => s.backendUrl);
  const config = conf();
  const configuredBackend =
    config.BACKEND_URL ??
    (config.BACKEND_URLS.length > 0 ? config.BACKEND_URLS[0] : null);

  if (isDesktopAppRuntime() && configuredBackend) {
    return configuredBackend;
  }

  return backendUrl ?? configuredBackend;
}
