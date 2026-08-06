import { register } from 'prom-client';
import { setupMetrics, initializeAllMetrics } from '../../utils/metrics';
import { scopedLogger } from '../../utils/logger';

const log = scopedLogger('metrics-endpoint');

let isInitialized = false;

async function ensureMetricsInitialized() {
  if (!isInitialized) {
    log.info('Initializing metrics from endpoint...', { evt: 'init_start' });
    await initializeAllMetrics();
    isInitialized = true;
    log.info('Metrics initialized from endpoint', { evt: 'init_complete' });
  }
}

export default defineEventHandler(async event => {
  try {
    await ensureMetricsInitialized();
    // Use the default registry (all-time metrics)
    const metrics = await register.metrics();
    event.node.res.setHeader('Content-Type', register.contentType);
    return metrics;
  } catch (error) {
    log.error('Error in metrics endpoint:', {
      evt: 'metrics_error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to collect metrics',
    });
  }
});
