import { defineTask } from '#imports';
import { scopedLogger } from '../../../utils/logger';
import { setupMetrics } from '../../../utils/metrics';

const logger = scopedLogger('tasks:clear-metrics:weekly');

export default defineTask({
  meta: {
    name: "jobs:clear-metrics:weekly",
    description: "Clear weekly metrics every Sunday at midnight",
  },
  async run() {
    logger.info("Clearing weekly metrics");
    const startTime = Date.now();
    
    try {
      // Clear and reinitialize weekly metrics
      await setupMetrics('weekly', true);
      
      const executionTime = Date.now() - startTime;
      logger.info(`Weekly metrics cleared in ${executionTime}ms`);
      
      return { 
        result: {
          status: "success",
          message: "Successfully cleared weekly metrics",
          executionTimeMs: executionTime,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error("Error clearing weekly metrics:", { error: error.message });
      return { 
        result: {
          status: "error",
          message: error.message || "An error occurred clearing weekly metrics",
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }
  },
}); 