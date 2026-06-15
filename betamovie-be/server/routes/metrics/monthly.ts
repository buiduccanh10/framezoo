import { getRegistry, initializeAllMetrics } from '../../utils/metrics';
import { scopedLogger } from '../../utils/logger';

const log = scopedLogger('metrics-monthly-endpoint');

let isInitialized = false;

async function ensureMetricsInitialized() {
  if (!isInitialized) {
    log.info('Initializing metrics from monthly endpoint...', { evt: 'init_start' });
    await initializeAllMetrics();
    isInitialized = true;
    log.info('Metrics initialized from monthly endpoint', { evt: 'init_complete' });
  }
}

export default defineEventHandler(async event => {
  try {
    await ensureMetricsInitialized();
    // Get the monthly registry
    const monthlyRegistry = getRegistry('monthly');

    const metrics = await monthlyRegistry.metrics();
    event.node.res.setHeader('Content-Type', monthlyRegistry.contentType);
    return metrics;
  } catch (error) {
    log.error('Error in monthly metrics endpoint:', {
      evt: 'metrics_error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to collect monthly metrics',
    });
  }
}); 