import { getRegistry, initializeAllMetrics } from '../../utils/metrics';
import { scopedLogger } from '../../utils/logger';

const log = scopedLogger('metrics-daily-endpoint');

let isInitialized = false;

async function ensureMetricsInitialized() {
  if (!isInitialized) {
    log.info('Initializing metrics from daily endpoint...', { evt: 'init_start' });
    await initializeAllMetrics();
    isInitialized = true;
    log.info('Metrics initialized from daily endpoint', { evt: 'init_complete' });
  }
}

export default defineEventHandler(async event => {
  try {
    await ensureMetricsInitialized();
    // Get the daily registry
    const dailyRegistry = getRegistry('daily');

    const metrics = await dailyRegistry.metrics();
    event.node.res.setHeader('Content-Type', dailyRegistry.contentType);
    return metrics;
  } catch (error) {
    log.error('Error in daily metrics endpoint:', {
      evt: 'metrics_error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to collect daily metrics',
    });
  }
}); 