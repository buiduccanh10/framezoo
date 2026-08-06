import { z } from 'zod';
import { getMetrics, recordCaptchaMetrics } from '~/utils/metrics';
import { scopedLogger } from '~/utils/logger';
import { setupMetrics } from '~/utils/metrics';

const log = scopedLogger('metrics-captcha');

let isInitialized = false;

async function ensureMetricsInitialized() {
  if (!isInitialized) {
    log.info('Initializing metrics from captcha endpoint...', { evt: 'init_start' });
    await setupMetrics();
    isInitialized = true;
    log.info('Metrics initialized from captcha endpoint', { evt: 'init_complete' });
  }
}

export default defineEventHandler(async event => {
  try {
    await ensureMetricsInitialized();

    const body = await readBody(event);
    const validatedBody = z
      .object({
        success: z.boolean(),
      })
      .parse(body);

    recordCaptchaMetrics(validatedBody.success);

    return true;
  } catch (error) {
    log.error('Failed to process captcha metrics', {
      evt: 'metrics_error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw createError({
      statusCode: error instanceof Error && error.message === 'metrics not initialized' ? 503 : 400,
      message: error instanceof Error ? error.message : 'Failed to process metrics',
    });
  }
});
