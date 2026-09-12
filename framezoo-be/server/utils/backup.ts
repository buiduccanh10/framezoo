import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { useSupabase } from './supabase';

const execAsync = promisify(exec);

export interface BackupFileInfo {
  name: string;
  size: string;
  sizeBytes: number;
  created: Date;
  path: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 MB';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const useBackup = () => {
  const tempFolder = '/tmp/framezoo_backup';
  const bucketName = 'postgres-backup';
  const maxBackups = parseInt(process.env.MAX_BACKUPS || '7');

  // isBackupRunning should ideally be stored in Redis or memory,
  // but for simplicity in a serverless/monolithic setup, a global var works if single instance.
  // Using global state:
  const getIsRunning = () => (global as any).__backupRunning === true;
  const setIsRunning = (val: boolean) => ((global as any).__backupRunning = val);

  const getDatabaseUrl = () => {
    return process.env.DATABASE_URL_DOCKER || process.env.DATABASE_URL;
  };

  const getStorage = () => {
    const supabase = useSupabase();
    if (!supabase) return null;
    return supabase.storage.from(bucketName);
  };

  const createAndUploadBackup = async (): Promise<string> => {
    const storage = getStorage();
    if (!storage) throw new Error('Supabase Storage is not configured');

    const dbUrl = getDatabaseUrl();
    if (!dbUrl) throw new Error('DATABASE_URL is not configured');

    if (!fs.existsSync(tempFolder)) {
      fs.mkdirSync(tempFolder, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `framezoo-backup-${timestamp}`;
    const sqlFile = `${backupName}.sql`;
    const archiveFile = `${backupName}.tar.gz`;
    const sqlPath = path.join(tempFolder, sqlFile);
    const archivePath = path.join(tempFolder, archiveFile);

    try {
      // Create SQL backup
      // --clean --if-exists ensures the restore can run without manual drop DB
      const pgDumpCmd = `pg_dump --clean --if-exists --dbname="${dbUrl}" -F p -f "${sqlPath}"`;
      console.log('Executing pg_dump...');
      await execAsync(pgDumpCmd);

      // Create compressed archive
      const tarCmd = `cd ${tempFolder} && tar -czf ${archiveFile} ${sqlFile}`;
      console.log('Creating tar.gz archive...');
      await execAsync(tarCmd);

      // Upload to Supabase Storage
      const fileBuffer = fs.readFileSync(archivePath);
      const storagePath = `backups/${archiveFile}`;

      console.log(`Uploading backup to Supabase: ${storagePath}`);
      const { error: uploadError } = await storage.upload(storagePath, fileBuffer, {
        contentType: 'application/gzip',
        upsert: false,
      });

      if (uploadError) {
        throw new Error(`Failed to upload backup: ${uploadError.message}`);
      }

      console.log(`Backup uploaded successfully: ${storagePath}`);
      return storagePath;
    } finally {
      // Cleanup local files
      if (fs.existsSync(sqlPath)) fs.unlinkSync(sqlPath);
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    }
  };

  const cleanupOldBackups = async (): Promise<void> => {
    const storage = getStorage();
    if (!storage) return;

    try {
      const { data: files, error } = await storage.list('backups', {
        sortBy: { column: 'created_at', order: 'desc' },
      });

      if (error || !files || files.length <= maxBackups) return;

      const filesToDelete = files.slice(maxBackups).map(f => `backups/${f.name}`);

      if (filesToDelete.length > 0) {
        await storage.remove(filesToDelete);
        console.log(`Deleted ${filesToDelete.length} old backup(s)`);
      }
    } catch (error) {
      console.warn(`Error during backup cleanup: ${error}`);
    }
  };

  const manualBackup = async () => {
    if (getIsRunning()) {
      return { success: false, error: 'Backup is already running' };
    }
    if (!getStorage()) {
      return { success: false, error: 'Supabase is not configured' };
    }

    setIsRunning(true);
    try {
      const backupPath = await createAndUploadBackup();
      await cleanupOldBackups();
      return { success: true, backupPath };
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      setIsRunning(false);
    }
  };

  const getBackupStatus = async () => {
    const storage = getStorage();
    if (!storage) {
      return { totalBackups: 0, backupSize: '0 MB', totalSizeBytes: 0, backupExists: false };
    }

    const { data: files, error } = await storage.list('backups', {
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error || !files || files.length === 0) {
      return { totalBackups: 0, backupSize: '0 MB', totalSizeBytes: 0, backupExists: false };
    }

    // Filter out potential non-tar.gz files or hidden files
    const backupFiles = files.filter(f => f.name.endsWith('.tar.gz'));

    const totalSizeBytes = backupFiles.reduce((sum, file) => sum + (file.metadata?.size || 0), 0);

    return {
      totalBackups: backupFiles.length,
      latestBackup: backupFiles[0]?.name,
      backupSize: formatBytes(totalSizeBytes),
      totalSizeBytes,
      backupExists: backupFiles.length > 0,
    };
  };

  const getBackupFiles = async (): Promise<{ files: BackupFileInfo[] }> => {
    const storage = getStorage();
    if (!storage) return { files: [] };

    const { data: files, error } = await storage.list('backups', {
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error || !files) return { files: [] };

    const backupFiles = files
      .filter(file => file.name.endsWith('.tar.gz'))
      .map(file => {
        const size = file.metadata?.size || 0;
        return {
          name: file.name,
          size: formatBytes(size),
          sizeBytes: size,
          created: file.created_at ? new Date(file.created_at) : new Date(),
          path: `backups/${file.name}`,
        };
      });

    return { files: backupFiles };
  };

  const downloadBackupFile = async (filename: string) => {
    const storage = getStorage();
    if (!storage) return { success: false, error: 'Supabase is not configured' };

    if (
      !filename ||
      filename.includes('/') ||
      filename.includes('..') ||
      !filename.endsWith('.tar.gz')
    ) {
      return { success: false, error: 'Invalid filename' };
    }

    const storagePath = `backups/${filename}`;
    const { data, error } = await storage.download(storagePath);

    if (error || !data) {
      return { success: false, error: error?.message || 'Download failed' };
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    return { success: true, buffer, contentType: 'application/gzip' };
  };

  const deleteBackupFile = async (filename: string) => {
    const storage = getStorage();
    if (!storage) return { success: false, error: 'Supabase is not configured' };

    if (
      !filename ||
      filename.includes('/') ||
      filename.includes('..') ||
      !filename.endsWith('.tar.gz')
    ) {
      return { success: false, error: 'Invalid filename' };
    }

    const storagePath = `backups/${filename}`;
    const { error } = await storage.remove([storagePath]);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, message: `Deleted ${filename}` };
  };

  const deleteAllBackups = async () => {
    const storage = getStorage();
    if (!storage) return { success: false, error: 'Supabase is not configured' };

    const { data: files } = await storage.list('backups');
    if (!files || files.length === 0)
      return { success: true, deletedCount: 0, message: 'No backups to delete' };

    const filesToDelete = files.map(f => `backups/${f.name}`);
    const { error } = await storage.remove(filesToDelete);

    if (error) {
      return { success: false, error: error.message, deletedCount: 0 };
    }
    return {
      success: true,
      deletedCount: filesToDelete.length,
      message: `Deleted ${filesToDelete.length} backups`,
    };
  };

  const importBackup = async (filename: string, buffer: Buffer) => {
    if (getIsRunning()) {
      return { success: false, error: 'Backup/Restore is already running' };
    }

    const dbUrl = getDatabaseUrl();
    if (!dbUrl) return { success: false, error: 'DATABASE_URL is not configured' };

    setIsRunning(true);
    const tempDir = path.join(tempFolder, 'temp_restore');

    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempDir, { recursive: true });

      // Use a safe internal filename to prevent command injection
      const ext = filename.endsWith('.tar.gz') ? '.tar.gz' : '.sql';
      const safeFilename = `upload${ext}`;
      const uploadedFilePath = path.join(tempDir, safeFilename);

      fs.writeFileSync(uploadedFilePath, buffer);
      console.log(`Saved uploaded file to: ${uploadedFilePath}`);

      let backupFilePath = uploadedFilePath;

      // If it's a tar.gz, extract it
      if (ext === '.tar.gz') {
        const extractCmd = `cd ${tempDir} && tar -xzf ${safeFilename}`;
        console.log(`Extracting backup: ${extractCmd}`);
        await execAsync(extractCmd);

        const extractedItems = fs.readdirSync(tempDir);
        const extractedFile = extractedItems.find(item => item.endsWith('.sql'));

        if (!extractedFile) {
          return { success: false, error: 'No .sql file found in archive' };
        }

        const originalExtractedPath = path.join(tempDir, extractedFile);
        backupFilePath = path.join(tempDir, 'safe_restore.sql');
        fs.renameSync(originalExtractedPath, backupFilePath);
      }

      console.log(`Restoring database from: ${backupFilePath}`);

      // Execute SQL via psql
      const restoreCmd = `psql --dbname="${dbUrl}" -f "${backupFilePath}"`;
      await execAsync(restoreCmd);

      return { success: true, message: 'Restore completed successfully' };
    } catch (error) {
      console.error('Restore error:', error);
      return { success: false, error: String(error) };
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      setIsRunning(false);
    }
  };

  return {
    manualBackup,
    getBackupStatus,
    getBackupFiles,
    downloadBackupFile,
    deleteBackupFile,
    deleteAllBackups,
    importBackup,
    createAndUploadBackup,
    cleanupOldBackups,
  };
};
