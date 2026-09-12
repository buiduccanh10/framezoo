import { defineEventHandler } from 'h3';
import { requireAdmin } from '~/utils/admin';
import { useBackup } from '~/utils/backup';

export default defineEventHandler(async event => {
  await requireAdmin(event);
  const backup = useBackup();
  const result = await backup.manualBackup();

  if (!result.success) {
    throw createError({
      statusCode: 500,
      message: result.error || 'Backup failed',
    });
  }

  return {
    success: true,
    backupPath: result.backupPath,
    message: 'PostgreSQL backup completed successfully',
  };
});
