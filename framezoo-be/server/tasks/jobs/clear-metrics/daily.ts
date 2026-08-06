import { defineTask } from '#imports';
import { scopedLogger } from '../../../utils/logger';
import { setupMetrics } from '../../../utils/metrics';

const logger = scopedLogger('tasks:clear-metrics:daily');

export default defineTask({
  meta: {
    name: "jobs:clear-metrics:daily",
    description: "Clear daily metrics at midnight",
  },
  async run() {
    logger.info("Clearing daily metrics");
    const startTime = Date.now();
    
    try {
      // Clear and reinitialize daily metrics
      await setupMetrics('daily', true);
      
      const executionTime = Date.now() - startTime;
      logger.info(`Daily metrics cleared in ${executionTime}ms`);
      
      return { 
        result: {
          status: "success",
          message: "Successfully cleared daily metrics",
          executionTimeMs: executionTime,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error("Error clearing daily metrics:", { error: error.message });
      return { 
        result: {
          status: "error",
          message: error.message || "An error occurred clearing daily metrics",
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }
  },
}); 