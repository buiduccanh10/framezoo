import { defineEventHandler, getRouterParam } from 'h3';
import { requireAdmin } from '~/utils/admin';
import { useBackup } from '~/utils/backup';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const filename = getRouterParam(event, 'filename');
  if (!filename) {
    throw createError({ statusCode: 400, message: 'Filename is required' });
  }

  const backup = useBackup();
  const result = await backup.deleteBackupFile(filename);

  if (!result.success) {
    throw createError({
      statusCode: 500,
      message: result.error || 'Failed to delete backup file',
    });
  }

  return {
    success: true,
    message: result.message,
  };
});
