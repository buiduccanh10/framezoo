import type { H3Event } from 'h3';

export type SubtitleApiProvider = 'wyzie' | 'subsource' | 'opensubtitles';

const PROVIDER_KEY_FIELDS: Record<
  SubtitleApiProvider,
  { configKey: 'wyzieApiKey' | 'subsourceApiKey' | 'opensubtitlesApiKey'; envKey: string }
> = {
  wyzie: { configKey: 'wyzieApiKey', envKey: 'WYZIE_API_KEY' },
  subsource: { configKey: 'subsourceApiKey', envKey: 'SUBSOURCE_API_KEY' },
  opensubtitles: { configKey: 'opensubtitlesApiKey', envKey: 'OPENSUBTITLES_API_KEY' },
};

/**
 * Resolves a subtitle provider API key from Nitro runtime config (NITRO_*) or process.env,
 * ignoring empty/whitespace strings so blank config defaults never shadow runtime env vars.
 */
export function resolveServerSubtitleApiKey(
  provider: SubtitleApiProvider,
  event?: H3Event,
  env: Record<string, string | undefined> = process.env,
  runtimeConfig?: Record<string, unknown>
): string | undefined {
  const { configKey, envKey } = PROVIDER_KEY_FIELDS[provider];
  let cfg = runtimeConfig;
  if (!cfg) {
    try {
      if (typeof useRuntimeConfig === 'function') {
        cfg = (event ? useRuntimeConfig(event) : useRuntimeConfig()) as Record<string, unknown>;
      }
    } catch {
      // Allow direct execution in unit tests outside Nitro.
    }
  }

  const cfgVal = typeof cfg?.[configKey] === 'string' ? cfg[configKey].trim() : '';
  if (cfgVal) return cfgVal;

  const envVal = typeof env[envKey] === 'string' ? env[envKey].trim() : '';
  return envVal || undefined;
}
