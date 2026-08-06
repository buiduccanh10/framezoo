import { defineTask } from '#imports';
import { scopedLogger } from '../../../utils/logger';
import { setupMetrics } from '../../../utils/metrics';

const logger = scopedLogger('tasks:clear-metrics:monthly');

export default defineTask({
  meta: {
    name: "jobs:clear-metrics:monthly",
    description: "Clear monthly metrics on the 1st of each month at midnight",
  },
  async run() {
    logger.info("Clearing monthly metrics");
    const startTime = Date.now();
    
    try {
      // Clear and reinitialize monthly metrics
      await setupMetrics('monthly', true);
      
      const executionTime = Date.now() - startTime;
      logger.info(`Monthly metrics cleared in ${executionTime}ms`);
      
      return { 
        result: {
          status: "success",
          message: "Successfully cleared monthly metrics",
          executionTimeMs: executionTime,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error("Error clearing monthly metrics:", { error: error.message });
      return { 
        result: {
          status: "error",
          message: error.message || "An error occurred clearing monthly metrics",
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }
  },
}); 