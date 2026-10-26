import { chmod, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import path from 'node:path';

export const MAX_FEEDBACK_FILE_BYTES = 55 * 1024 * 1024;
const FEEDBACK_STORAGE_DIR = path.resolve(
  process.env.FEEDBACK_STORAGE_DIR?.trim() || '/data/feedback'
);
const CLAMAV_PORT = Number.parseInt(process.env.FEEDBACK_CLAMAV_PORT?.trim() || '3310', 10);
const CLAMAV_HOST =
  process.env.FEEDBACK_CLAMAV_HOST?.trim() ||
  (process.env.NODE_ENV === 'production' ? 'clamav' : '');
const CLAMAV_TIMEOUT_MS = 120_000;

const FILE_SPECS: Record<string, { extension: string; kind: 'image' | 'video' }> = {
  'image/jpeg': { extension: 'jpg', kind: 'image' },
  'image/png': { extension: 'png', kind: 'image' },
  'image/webp': { extension: 'webp', kind: 'image' },
  'image/gif': { extension: 'gif', kind: 'image' },
  'video/mp4': { extension: 'mp4', kind: 'video' },
  'video/quicktime': { extension: 'mov', kind: 'video' },
  'video/webm': { extension: 'webm', kind: 'video' },
};

export interface FeedbackAttachment {
  key: string;
  name: string;
  type: string;
  kind: 'image' | 'video';
  size: number;
  path: string;
}

export interface FeedbackFilePart {
  filename?: string;
  type?: string;
  data: Uint8Array;
}

export class FeedbackMalwareError extends Error {
  constructor() {
    super('File bị từ chối vì phát hiện phần mềm độc hại');
    this.name = 'FeedbackMalwareError';
  }
}

export class FeedbackScannerUnavailableError extends Error {
  constructor() {
    super('Bộ quét an toàn file không khả dụng');
    this.name = 'FeedbackScannerUnavailableError';
  }
}

const ascii = (data: Uint8Array, start: number, end: number) =>
  Buffer.from(data.slice(start, end)).toString('ascii');

const hasFileSignature = (type: string, data: Uint8Array) => {
  if (type === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === 'image/png')
    return (
      data.length >= 8 &&
      data.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
    );
  if (type === 'image/gif') return ascii(data, 0, 6) === 'GIF87a' || ascii(data, 0, 6) === 'GIF89a';
  if (type === 'image/webp') return ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WEBP';
  if (type === 'video/webm')
    return (
      data.length >= 4 &&
      data[0] === 0x1a &&
      data[1] === 0x45 &&
      data[2] === 0xdf &&
      data[3] === 0xa3
    );
  if (type === 'video/mp4' || type === 'video/quicktime')
    return data.length >= 12 && ascii(data, 4, 8) === 'ftyp';
  return false;
};

const hasSafeContainer = (type: string, data: Uint8Array) => {
  const buffer = Buffer.from(data);
  if (type === 'image/jpeg')
    return buffer.length >= 4 && buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]));
  if (type === 'image/gif') return buffer.length >= 7 && buffer.at(-1) === 0x3b;
  if (type === 'image/webp')
    return buffer.length >= 12 && buffer.readUInt32LE(4) + 8 === buffer.length;
  if (type === 'image/png') {
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > buffer.length) return false;
      if (buffer.toString('ascii', offset + 4, offset + 8) === 'IEND')
        return length === 0 && end === buffer.length;
      offset = end;
    }
    return false;
  }
  if (type === 'video/mp4' || type === 'video/quicktime') {
    let offset = 0;
    while (offset + 8 <= buffer.length) {
      let size = buffer.readUInt32BE(offset);
      const headerSize = size === 1 ? 16 : 8;
      if (size === 1) {
        if (offset + 16 > buffer.length) return false;
        const high = buffer.readUInt32BE(offset + 8);
        const low = buffer.readUInt32BE(offset + 12);
        if (high > 0x1fffff) return false;
        size = high * 2 ** 32 + low;
      } else if (size === 0) {
        return offset + 8 <= buffer.length;
      }
      if (size < headerSize || offset + size > buffer.length) return false;
      if (offset === 0 && buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
      offset += size;
    }
    return offset === buffer.length;
  }
  return true;
};

const getFileSpec = (part: FeedbackFilePart) => {
  const type = part.type?.toLowerCase().split(';', 1)[0] || '';
  const spec = FILE_SPECS[type];
  return spec &&
    part.filename &&
    hasFileSignature(type, part.data) &&
    hasSafeContainer(type, part.data)
    ? { type, ...spec }
    : null;
};

export const validateFeedbackFileParts = (parts: FeedbackFilePart[]) => {
  const totalBytes = parts.reduce((total, part) => total + part.data.byteLength, 0);
  if (totalBytes > MAX_FEEDBACK_FILE_BYTES) {
    throw new Error('Tổng dung lượng files không được vượt quá 55 MB');
  }

  for (const part of parts) {
    if (!getFileSpec(part)) {
      throw new Error(
        'Chỉ hỗ trợ file ảnh hoặc video hợp lệ (JPEG, PNG, WebP, GIF, MP4, MOV, WebM)'
      );
    }
  }
};

const clamavRequired = () => {
  const configured = process.env.FEEDBACK_CLAMAV_REQUIRED?.trim().toLowerCase();
  return process.env.NODE_ENV === 'production' || configured === 'true';
};

export const scanFeedbackFile = (data: Uint8Array) => {
  if (!CLAMAV_HOST) {
    if (clamavRequired()) throw new FeedbackScannerUnavailableError();
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let response = '';
    let settled = false;
    const socket = createConnection({ host: CLAMAV_HOST, port: CLAMAV_PORT });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(CLAMAV_TIMEOUT_MS, () => finish(new FeedbackScannerUnavailableError()));
    socket.on('error', () => finish(new FeedbackScannerUnavailableError()));
    socket.on('data', chunk => {
      response += chunk.toString('utf8');
      if (response.length > 16 * 1024) return finish(new FeedbackScannerUnavailableError());
      if (/FOUND\b/i.test(response)) return finish(new FeedbackMalwareError());
      if (/ERROR\b/i.test(response)) return finish(new FeedbackScannerUnavailableError());
      if (/\bOK(?:\0|\n|$)/i.test(response)) return finish();
    });
    socket.on('close', () => {
      if (/\bOK(?:\0|\n|$)/i.test(response)) finish();
      else if (!settled) finish(new FeedbackScannerUnavailableError());
    });
    socket.on('connect', () => {
      try {
        socket.write('zINSTREAM\0');
        const buffer = Buffer.from(data);
        for (let offset = 0; offset < buffer.length; offset += 1024 * 1024) {
          const chunk = buffer.subarray(offset, Math.min(offset + 1024 * 1024, buffer.length));
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length, 0);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      } catch {
        finish(new FeedbackScannerUnavailableError());
      }
    });
  });
};

const scanFeedbackFileParts = async (parts: FeedbackFilePart[]) => {
  for (const part of parts) await scanFeedbackFile(part.data);
};

const feedbackDirectory = (feedbackId: string) => path.join(FEEDBACK_STORAGE_DIR, feedbackId);

const safeAttachmentPath = (relativePath: string) => {
  const root = `${FEEDBACK_STORAGE_DIR}${path.sep}`;
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..'))
    throw new Error('Invalid feedback file path');
  const resolved = path.resolve(FEEDBACK_STORAGE_DIR, normalized);
  if (!resolved.startsWith(root)) throw new Error('Invalid feedback file path');
  return resolved;
};

const ensureStorage = async () => {
  await mkdir(FEEDBACK_STORAGE_DIR, { recursive: true, mode: 0o700 });
  await chmod(FEEDBACK_STORAGE_DIR, 0o700);
};

const removeFileIfPresent = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

export const parseFeedbackAttachments = (value: unknown): FeedbackAttachment[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FeedbackAttachment => {
    if (!item || typeof item !== 'object') return false;
    const attachment = item as Record<string, unknown>;
    return (
      typeof attachment.key === 'string' &&
      typeof attachment.name === 'string' &&
      (attachment.kind === 'image' || attachment.kind === 'video') &&
      typeof attachment.type === 'string' &&
      typeof attachment.size === 'number' &&
      typeof attachment.path === 'string'
    );
  });
};

export const uploadFeedbackAttachments = async (feedbackId: string, parts: FeedbackFilePart[]) => {
  if (parts.length === 0) return [];
  validateFeedbackFileParts(parts);
  await scanFeedbackFileParts(parts);
  await ensureStorage();
  const directory = feedbackDirectory(feedbackId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const uploaded: FeedbackAttachment[] = [];

  try {
    for (const part of parts) {
      const spec = getFileSpec(part)!;
      const key = `${randomUUID()}.${spec.extension}`;
      const relativePath = `${feedbackId}/${key}`;
      const filePath = safeAttachmentPath(relativePath);
      await writeFile(filePath, part.data, { flag: 'wx', mode: 0o600 });
      uploaded.push({
        key,
        name: part.filename!,
        type: spec.type,
        kind: spec.kind,
        size: part.data.byteLength,
        path: relativePath,
      });
    }
    return uploaded;
  } catch (error) {
    await Promise.all(
      uploaded.map(attachment => removeFileIfPresent(safeAttachmentPath(attachment.path)))
    );
    throw error;
  }
};

export const removeFeedbackAttachments = async (attachments: FeedbackAttachment[]) => {
  await Promise.all(
    attachments.map(async attachment => {
      const filePath = safeAttachmentPath(attachment.path);
      await removeFileIfPresent(filePath);
      try {
        await rmdir(path.dirname(filePath));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOTEMPTY' && code !== 'ENOENT') throw error;
      }
    })
  );
};

export const downloadFeedbackAttachment = async (attachment: FeedbackAttachment) => {
  const filePath = safeAttachmentPath(attachment.path);
  if (!lstatSync(filePath).isFile()) throw new Error('Attachment not found');
  return readFile(filePath);
};
