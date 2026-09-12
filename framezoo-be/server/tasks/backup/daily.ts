import { useBackup } from '~/utils/backup';

export default defineTask({
  meta: {
    name: 'backup:daily',
    description: 'Run daily database backup to Supabase',
  },
  async run({ payload, context }) {
    console.log('Running daily backup task...');
    const backup = useBackup();

    try {
      const result = await backup.manualBackup();
      if (!result.success) {
        console.error('Daily backup failed:', result.error);
        return { result: 'failed', error: result.error };
      }

      console.log('Daily backup completed successfully:', result.backupPath);
      return { result: 'success', path: result.backupPath };
    } catch (error) {
      console.error('Daily backup task threw an error:', error);
      return { result: 'error', error: String(error) };
    }
  },
});
