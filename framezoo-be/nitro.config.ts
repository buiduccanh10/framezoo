import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});
config({
  path: fileURLToPath(new URL('.env', import.meta.url)),
});
import { version } from './server/utils/config';
//https://nitro.unjs.io/config
const createRedisStorage = (defaultHost: string) => ({
  driver: 'redis' as const,
  url:
    process.env.REDIS_URL ||
    `redis://${process.env.REDIS_HOST || defaultHost}:${process.env.REDIS_PORT || '6379'}`,
  connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 2000,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
  lazyConnect: true,
});

export default defineNitroConfig({
  srcDir: 'server',
  compatibilityDate: '2025-03-05',
  experimental: {
    asyncContext: true,
    tasks: true,
  },
  scheduledTasks: {
    // Sync progress every minute
    '* * * * *': ['jobs:sync-progress', 'jobs:dispatch-email-outbox'],
    // Daily cron jobs (midnight)
    '0 0 * * *': ['jobs:clear-metrics:daily'],
    // Weekly cron jobs (Sunday midnight)
    '0 0 * * 0': ['jobs:clear-metrics:weekly'],
    // Monthly cron jobs (1st of month at midnight)
    '0 0 1 * *': ['jobs:clear-metrics:monthly'],
    // Daily backup at 3 AM
    '0 3 * * *': ['backup:daily', 'jobs:cleanup-email'],
    // Daily guest retention cleanup at 4 AM
    '0 4 * * *': ['jobs:cleanup-guests'],
  },
  storage: {
    cache: createRedisStorage('redis'),
  },
  devStorage: {
    cache: createRedisStorage('localhost'),
  },

  runtimeConfig: {
    public: {
      meta: {
        name: process.env.META_NAME || '',
        description: process.env.META_DESCRIPTION || '',
        version: version || '',
        captcha: (process.env.CAPTCHA === 'true').toString(),
        captchaClientKey: process.env.CAPTCHA_CLIENT_KEY || '',
      },
    },
    cryptoSecret: process.env.CRYPTO_SECRET,
    tmdbApiKey: process.env.TMDB_API_KEY,
    tidbApiKey: process.env.TIDB_API_KEY,
    omdbApiKey: process.env.OMDB_API_KEY,
    // Keep empty at build time so NITRO_* overrides work without baking secrets or empty strings over process.env.
    wyzieApiKey: '',
    subsourceApiKey: '',
    opensubtitlesApiKey: '',
  },
});
