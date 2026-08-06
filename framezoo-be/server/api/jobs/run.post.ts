import { defineEventHandler, getQuery, readBody, createError } from 'h3';
import { runTask } from '#imports';

export default defineEventHandler(async (event) => {
  // Get job name from query parameters
  const query = getQuery(event);
  const jobName = query.job as string;
  
  if (!jobName) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing job parameter"
    });
  }
  
  try {
    // Run the specified task
    const result = await runTask(jobName, { 
      payload: await readBody(event).catch(() => ({}))
    });
    
    return {
      success: true,
      job: jobName,
      result
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to run job: ${error.message || 'Unknown error'}`
    });
  }
}); 