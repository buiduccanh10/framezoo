import { getRegistry, initializeAllMetrics } from '../../utils/metrics';
import { scopedLogger } from '../../utils/logger';

const log = scopedLogger('metrics-weekly-endpoint');

let isInitialized = false;

async function ensureMetricsInitialized() {
  if (!isInitialized) {
    log.info('Initializing metrics from weekly endpoint...', { evt: 'init_start' });
    await initializeAllMetrics();
    isInitialized = true;
    log.info('Metrics initialized from weekly endpoint', { evt: 'init_complete' });
  }
}

export default defineEventHandler(async event => {
  try {
    await ensureMetricsInitialized();
    // Get the weekly registry
    const weeklyRegistry = getRegistry('weekly');

    const metrics = await weeklyRegistry.metrics();
    event.node.res.setHeader('Content-Type', weeklyRegistry.contentType);
    return metrics;
  } catch (error) {
    log.error('Error in weekly metrics endpoint:', {
      evt: 'metrics_error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to collect weekly metrics',
    });
  }
}); 