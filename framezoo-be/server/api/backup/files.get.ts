import { defineEventHandler } from 'h3';
import { requireAdmin } from '~/utils/admin';
import { useBackup } from '~/utils/backup';

export default defineEventHandler(async event => {
  await requireAdmin(event);
  const backup = useBackup();
  return await backup.getBackupFiles();
});
