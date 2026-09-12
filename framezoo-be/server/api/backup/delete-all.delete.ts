import { defineEventHandler } from 'h3';
import { requireAdmin } from '~/utils/admin';
import { useBackup } from '~/utils/backup';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const backup = useBackup();
  const result = await backup.deleteAllBackups();

  if (!result.success) {
    throw createError({
      statusCode: 500,
      message: result.error || 'Failed to delete all backups',
    });
  }

  return {
    success: true,
    message: result.message,
    deletedCount: result.deletedCount,
  };
});
