import { defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { requireAdmin } from '~/utils/admin';
import { useBackup } from '~/utils/backup';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const filename = getRouterParam(event, 'filename');
  if (!filename) {
    throw createError({ statusCode: 400, message: 'Filename is required' });
  }

  const backup = useBackup();
  const result = await backup.downloadBackupFile(filename);

  if (!result.success || !result.buffer) {
    throw createError({
      statusCode: 404,
      message: result.error || 'Backup file not found',
    });
  }

  setResponseHeader(event, 'Content-Type', result.contentType || 'application/octet-stream');
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`);
  setResponseHeader(event, 'Content-Length', result.buffer.length);

  return result.buffer;
});
