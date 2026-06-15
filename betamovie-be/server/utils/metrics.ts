import { Counter, register, collectDefaultMetrics, Histogram, Summary, Registry } from 'prom-client';
import { prisma } from './prisma';
import { scopedLogger } from '~/utils/logger';
import fs from 'fs';
import path from 'path';

const log = scopedLogger('metrics');
const METRICS_FILE = '.metrics.json';
const METRICS_DAILY_FILE = '.metrics_daily.json';
const METRICS_WEEKLY_FILE = '.metrics_weekly.json';
const METRICS_MONTHLY_FILE = '.metrics_monthly.json';

function getMetricsFileName(interval: string): string {
  const fileMap: Record<string, string> = {
    default: METRICS_FILE,
    daily: METRICS_DAILY_FILE,
    weekly: METRICS_WEEKLY_FILE,
    monthly: METRICS_MONTHLY_FILE,
  };
  const name = fileMap[interval] ?? `.metrics_${interval}.json`;
  return path.join(process.cwd(), name);
}

// Global registries
const registries = {
  default: register, // All-time metrics (never cleared)
  daily: new Registry(),
  weekly: new Registry(),
  monthly: new Registry()
};

// Expose the registries on global for tasks to access
if (typeof global !== 'undefined') {
  global.metrics_daily = registries.daily;
  global.metrics_weekly = registries.weekly;
  global.metrics_monthly = registries.monthly;
}

export type Metrics = {
  user: Counter<'namespace'>;
  captchaSolves: Counter<'success'>;
  providerHostnames: Counter<'hostname'>;
  providerStatuses: Counter<'provider_id' | 'status'>;
  watchMetrics: Counter<'title' | 'tmdb_full_id' | 'provider_id' | 'success'>;
  toolMetrics: Counter<'tool'>;
  httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;
  httpRequestSummary: Summary<'method' | 'route' | 'status_code'>;
};

// Store metrics for each time period
const metricsStore: Record<string, Metrics | null> = {
  default: null,
  daily: null,
  weekly: null,
  monthly: null
};

export function getMetrics(interval: 'default' | 'daily' | 'weekly' | 'monthly' = 'default') {
  if (!metricsStore[interval]) throw new Error(`metrics for ${interval} not initialized`);
  return metricsStore[interval];
}

export function getRegistry(interval: 'default' | 'daily' | 'weekly' | 'monthly' = 'default') {
  return registries[interval];
}

async function createMetrics(registry: Registry, interval: string): Promise<Metrics> {
  const suffix = interval !== 'default' ? `_${interval}` : '';
  const newMetrics = {
    user: new Counter({
      name: `mw_user_count${suffix}`,
      help: `Number of users by namespace (${interval})`,
      labelNames: ['namespace'],
      registers: [registry]
    }),
    captchaSolves: new Counter({
      name: `mw_captcha_solves${suffix}`,
      help: `Number of captcha solves by success status (${interval})`,
      labelNames: ['success'],
      registers: [registry]
    }),
    providerHostnames: new Counter({
      name: `mw_provider_hostname_count${suffix}`,
      help: `Number of requests by provider hostname (${interval})`,
      labelNames: ['hostname'],
      registers: [registry]
    }),
    providerStatuses: new Counter({
      name: `mw_provider_status_count${suffix}`,
      help: `Number of provider requests by status (${interval})`,
      labelNames: ['provider_id', 'status'],
      registers: [registry]
    }),
    watchMetrics: new Counter({
      name: `mw_media_watch_count${suffix}`,
      help: `Number of media watch events (${interval})`,
      labelNames: ['title', 'tmdb_full_id', 'provider_id', 'success'],
      registers: [registry]
    }),
    toolMetrics: new Counter({
      name: `mw_provider_tool_count${suffix}`,
      help: `Number of provider tool usages (${interval})`,
      labelNames: ['tool'],
      registers: [registry]
    }),
    httpRequestDuration: new Histogram({
      name: `http_request_duration_seconds${suffix}`,
      help: `request duration in seconds (${interval})`,
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry]
    }),
    httpRequestSummary: new Summary({
      name: `http_request_summary_seconds${suffix}`,
      help: `request duration in seconds summary (${interval})`,
      labelNames: ['method', 'route', 'status_code'],
      percentiles: [0.01, 0.05, 0.5, 0.9, 0.95, 0.99, 0.999],
      registers: [registry]
    }),
  };

  return newMetrics;
}

async function saveMetricsToFile(interval: string = 'default') {
  try {
    const registry = registries[interval];
    if (!registry) return;

    const fileName = getMetricsFileName(interval);

    const metricsData = await registry.getMetricsAsJSON();
    const relevantMetrics = metricsData.filter(
      metric => metric.name.startsWith('mw_') || metric.name.startsWith('http_request')
    );

    fs.writeFileSync(fileName, JSON.stringify(relevantMetrics, null, 2));

    log.info(`${interval} metrics saved to file`, { evt: 'metrics_saved', interval });
  } catch (error) {
    log.error(`Failed to save ${interval} metrics`, {
      evt: 'save_metrics_error',
      interval,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadMetricsFromFile(interval: string = 'default'): Promise<any[]> {
  try {
    const fileName = getMetricsFileName(interval);

    if (!fs.existsSync(fileName)) {
      log.info(`No saved ${interval} metrics found`, { evt: 'no_saved_metrics', interval });
      return [];
    }

    const data = fs.readFileSync(fileName, 'utf8');
    const savedMetrics = JSON.parse(data);
    log.info(`Loaded saved ${interval} metrics`, {
      evt: 'metrics_loaded',
      interval,
      count: savedMetrics.length,
    });
    return savedMetrics;
  } catch (error) {
    log.error(`Failed to load ${interval} metrics`, {
      evt: 'load_metrics_error',
      interval,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// Periodically save all metrics
const SAVE_INTERVAL = 60000; // Save every minute
setInterval(() => {
  Object.keys(registries).forEach(interval => {
    saveMetricsToFile(interval);
  });
}, SAVE_INTERVAL);

// Save metrics on process exit
process.on('SIGTERM', async () => {
  log.info('Saving all metrics before exit...', { evt: 'exit_save' });
  for (const interval of Object.keys(registries)) {
    await saveMetricsToFile(interval);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  log.info('Saving all metrics before exit...', { evt: 'exit_save' });
  for (const interval of Object.keys(registries)) {
    await saveMetricsToFile(interval);
  }
  process.exit(0);
});

let defaultMetricsRegistered = false;
const metricsRegistered: Record<string, boolean> = {
  default: false,
  daily: false,
  weekly: false,
  monthly: false,
};

export async function setupMetrics(interval: 'default' | 'daily' | 'weekly' | 'monthly' = 'default', clear: boolean = false) {
  try {
    log.info(`Setting up ${interval} metrics...`, { evt: 'start', interval });

    const registry = registries[interval];
    // Only clear registry if explicitly requested (e.g., by scheduled task)
    let skipRestore = false;
    if (clear) {
      registry.clear();
      metricsRegistered[interval] = false; // allow re-registration after clear
      if (interval === 'default') defaultMetricsRegistered = false;
      // Remove persisted snapshot so we truly start fresh for this interval
      try {
        const fileName = getMetricsFileName(interval);
        if (fs.existsSync(fileName)) {
          fs.unlinkSync(fileName);
          log.info(`Deleted persisted ${interval} metrics file`, { evt: 'deleted_metrics_file', interval });
        }
      } catch (err) {
        log.warn(`Failed to delete ${interval} metrics file`, {
          evt: 'delete_metrics_file_error',
          interval,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      skipRestore = true;
    }
    // Only register metrics once per registry per process
    if (!metricsRegistered[interval]) {
      if (interval === 'default' && !defaultMetricsRegistered) {
        collectDefaultMetrics({
          register: registry,
          prefix: '', // No prefix to match the example output
          eventLoopMonitoringPrecision: 1, // Ensure eventloop metrics are collected
          gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], // Match the example buckets
        });
        defaultMetricsRegistered = true;
      }
      metricsStore[interval] = await createMetrics(registry, interval);
      metricsRegistered[interval] = true;
      log.info(`Created new ${interval} metrics...`, { evt: 'created', interval });
    }
    // Load saved metrics
    if (!skipRestore) {
      const savedMetrics = await loadMetricsFromFile(interval);
      if (savedMetrics.length > 0) {
        log.info(`Restoring saved ${interval} metrics...`, { evt: 'restore_metrics', interval });
        savedMetrics.forEach(metric => {
          if (metric.values) {
            metric.values.forEach(value => {
              const metrics = metricsStore[interval];
              if (!metrics) return;

              // Extract the base metric name without the interval suffix
              const baseName = metric.name.replace(/_daily$|_weekly$|_monthly$/, '');
              
              switch (baseName) {
                case 'mw_user_count':
                  metrics.user.inc(value.labels, value.value);
                  break;
                case 'mw_captcha_solves':
                  metrics.captchaSolves.inc(value.labels, value.value);
                  break;
                case 'mw_provider_hostname_count':
                  metrics.providerHostnames.inc(value.labels, value.value);
                  break;
                case 'mw_provider_status_count':
                  metrics.providerStatuses.inc(value.labels, value.value);
                  break;
                case 'mw_media_watch_count':
                  metrics.watchMetrics.inc(value.labels, value.value);
                  break;
                case 'mw_provider_tool_count':
                  metrics.toolMetrics.inc(value.labels, value.value);
                  break;
                case 'http_request_duration_seconds':
                  // For histograms, special handling for sum and count
                  if (
                    value.metricName === `http_request_duration_seconds${interval !== 'default' ? `_${interval}` : ''}sum` ||
                    value.metricName === `http_request_duration_seconds${interval !== 'default' ? `_${interval}` : ''}count`
                  ) {
                    metrics.httpRequestDuration.observe(value.labels, value.value);
                  }
                  break;
              }
            });
          }
        });
      }
    }

    // Initialize metrics with current data (best-effort; don't fail if DB is unavailable)
    log.info(`Syncing up ${interval} metrics...`, { evt: 'sync', interval });
    try {
      await updateMetrics(interval);
    } catch (err) {
      log.warn(`Skipping ${interval} DB-backed metric sync due to error`, {
        evt: 'sync_skipped',
        interval,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    log.info(`${interval} metrics initialized!`, { evt: 'end', interval });

    // Save initial state
    await saveMetricsToFile(interval);
  } catch (error) {
    log.error(`Failed to setup ${interval} metrics`, {
      evt: 'setup_error',
      interval,
      error: error instanceof Error ? error.message : String(error),
    });
    // Do not rethrow so callers can keep running (e.g., allow HTTP metrics recording without DB)
    return;
  }
}

async function updateMetrics(interval: 'default' | 'daily' | 'weekly' | 'monthly' = 'default') {
  try {
    // Only the default (all-time) registry should be hydrated from the database.
    if (interval !== 'default') {
      return;
    }
    log.info(`Fetching users from database for ${interval} metrics...`, { evt: 'update_metrics_start', interval });

    const users = await prisma.users.groupBy({
      by: ['namespace'],
      _count: true,
    });

    log.info('Found users', { evt: 'users_found', count: users.length, interval });

    const metrics = metricsStore[interval];
    if (!metrics) return;

    metrics.user.reset();
    log.info(`Reset user metrics counter for ${interval}`, { evt: 'metrics_reset', interval });

    users.forEach(v => {
      log.info(`Incrementing user metric for ${interval}`, {
        evt: 'increment_metric',
        interval,
        namespace: v.namespace,
        count: v._count,
      });
      metrics.user.inc({ namespace: v.namespace }, v._count);
    });

    log.info(`Successfully updated ${interval} metrics`, { evt: 'update_metrics_complete', interval });
  } catch (error) {
    log.error(`Failed to update ${interval} metrics`, {
      evt: 'update_metrics_error',
      interval,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Export function to record HTTP request duration for all registries
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  duration: number
) {
  const labels = {
    method,
    route,
    status_code: statusCode.toString(),
  };

  // Record in all active registries
  Object.entries(metricsStore).forEach(([interval, metrics]) => {
    if (!metrics) return;
    
    // Record in both histogram and summary
    metrics.httpRequestDuration.observe(labels, duration);
    metrics.httpRequestSummary.observe(labels, duration);
  });
}

// Functions to match previous backend API - record in all registries
export function recordProviderMetrics(items: any[], hostname: string, tool?: string) {
  Object.values(metricsStore).forEach(metrics => {
    if (!metrics) return;

    // Record hostname once per request
    metrics.providerHostnames.inc({ hostname });

    // Record status metrics for each item
    items.forEach(item => {
      // Record provider status
      metrics.providerStatuses.inc({
        provider_id: item.embedId ?? item.providerId,
        status: item.status,
      });
    });

    // Reverse items to get the last one, and find the last successful item
    const itemList = [...items];
    itemList.reverse();
    const lastSuccessfulItem = items.find(v => v.status === 'success');
    const lastItem = itemList[0];

    // Record watch metrics only for the last item
    if (lastItem) {
      metrics.watchMetrics.inc({
        tmdb_full_id: lastItem.type + '-' + lastItem.tmdbId,
        provider_id: lastSuccessfulItem?.providerId ?? lastItem.providerId,
        title: lastItem.title,
        success: (!!lastSuccessfulItem).toString(),
      });
    }

    // Record tool metrics
    if (tool) {
      metrics.toolMetrics.inc({ tool });
    }
  });
}

export function recordCaptchaMetrics(success: boolean) {
  Object.values(metricsStore).forEach(metrics => {
    metrics?.captchaSolves.inc({ success: success.toString() });
  });
}

// Initialize all metrics registries on startup
export async function initializeAllMetrics() {
  for (const interval of Object.keys(registries) as Array<'default' | 'daily' | 'weekly' | 'monthly'>) {
    try {
      await setupMetrics(interval);
    } catch (error) {
      log.error(`initializeAllMetrics: failed to setup ${interval}`, {
        evt: 'init_interval_error',
        interval,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue initializing other intervals
    }
  }
}
