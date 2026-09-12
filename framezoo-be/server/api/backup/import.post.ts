import { defineEventHandler, readMultipartFormData } from 'h3';
import { requireAdmin } from '~/utils/admin';
import { useBackup } from '~/utils/backup';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const formData = await readMultipartFormData(event);
  if (!formData || formData.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'No file provided',
    });
  }

  const fileItem = formData.find(item => item.name === 'file');
  if (!fileItem || !fileItem.filename) {
    throw createError({
      statusCode: 400,
      message: 'No file provided in the "file" field',
    });
  }

  const filename = fileItem.filename;
  if (!filename.endsWith('.tar.gz') && !filename.endsWith('.sql')) {
    throw createError({
      statusCode: 400,
      message: 'Backup file must be .tar.gz or .sql format',
    });
  }

  const backup = useBackup();
  const result = await backup.importBackup(filename, fileItem.data);

  if (!result.success) {
    throw createError({
      statusCode: 500,
      message: result.error || 'Failed to import backup',
    });
  }

  return {
    success: true,
    message: result.message,
  };
});
