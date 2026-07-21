/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

declare const __APP_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly PACKAGE_VERSION: string;
}
