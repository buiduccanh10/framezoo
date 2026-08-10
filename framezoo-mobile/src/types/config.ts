declare const process: {
  env: Record<string, string | undefined>;
};

export interface MobileConfig {
  backendUrl: string;
}

function normalizeBackendUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, '') ?? '';
}

const releaseBackendUrl = normalizeBackendUrl(
  process.env.FRAMEZOO_BACKEND_URL ?? process.env.VITE_BACKEND_URL,
);

export const DEFAULT_CONFIG: MobileConfig = {
  backendUrl: releaseBackendUrl || (__DEV__ ? 'http://127.0.0.1:3000' : ''),
};
