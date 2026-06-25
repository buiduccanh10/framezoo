import { contextBridge, ipcRenderer } from "electron";

type RuntimeConfig = Record<string, string>;

const runtimeConfig: RuntimeConfig = {
  VITE_BACKEND_URL: "http://127.0.0.1:3000",
  VITE_NORMAL_ROUTER: "false",
};

if (process.env.BETAMOVIE_BACKEND_URL || process.env.VITE_BACKEND_URL) {
  runtimeConfig.VITE_BACKEND_URL =
    process.env.BETAMOVIE_BACKEND_URL ??
    process.env.VITE_BACKEND_URL ??
    runtimeConfig.VITE_BACKEND_URL;
}

contextBridge.exposeInMainWorld("__CONFIG__", runtimeConfig);

contextBridge.exposeInMainWorld("__ALPHAFLIX_DESKTOP__", true);

contextBridge.exposeInMainWorld("electronAPI", {
  sendExtensionMessage(name: string, payload?: unknown) {
    return ipcRenderer.invoke("desktop:extension-message", name, payload);
  },
  openExternal(url: string) {
    return ipcRenderer.invoke("desktop:open-external", url);
  },
  showDesktopSettingsPlaceholder() {
    return ipcRenderer.invoke("desktop:show-settings-placeholder");
  },
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktopApp = "true";
  document.body.dataset.desktopApp = "true";
});

window.addEventListener("alphaflix-desktop-settings", () => {
  void ipcRenderer.invoke("desktop:show-settings-placeholder");
});
