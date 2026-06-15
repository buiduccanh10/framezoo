import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, basename } from 'node:path';

const PORT = Number(process.env.PORT || 3100);
const DATA_DIR = process.env.PREVIEW_DATA_DIR || '/data/previews';
const PREVIEW_INTERVAL_SECONDS = Number(process.env.PREVIEW_INTERVAL_SECONDS || 10);
const PREVIEW_FRAME_WIDTH = Number(process.env.PREVIEW_FRAME_WIDTH || 320);
const PREVIEW_TILE_COLS = Number(process.env.PREVIEW_TILE_COLS || 5);
const PREVIEW_TILE_ROWS = Number(process.env.PREVIEW_TILE_ROWS || 5);
const PREVIEW_MAX_FRAMES = Number(process.env.PREVIEW_MAX_FRAMES || 120);
const PREVIEW_FFMPEG_CONCURRENCY = Number(process.env.PREVIEW_FFMPEG_CONCURRENCY || 4);
const COMMAND_TIMEOUT_MS = Number(process.env.PREVIEW_COMMAND_TIMEOUT_MS || 90 * 1000);
const HLS_INPUT_ARGS = [
  '-protocol_whitelist',
  'file,http,https,tcp,tls,crypto,data',
  '-allowed_extensions',
  'ALL',
  '-extension_picky',
  '0',
];

const pending = new Map();

const isLikelyHlsInput = sourceUrl => {
  try {
    const parsed = new URL(sourceUrl);
    const targetUrl = parsed.searchParams.get('url') || sourceUrl;
    return parsed.pathname.includes('/api/m3u8-proxy') || /\.m3u8(?:$|[?#])/i.test(targetUrl);
  } catch {
    return /\.m3u8(?:$|[?#])/i.test(sourceUrl);
  }
};

const hlsFormatArgs = sourceUrl => (isLikelyHlsInput(sourceUrl) ? ['-f', 'hls'] : []);

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
};

const sendError = (res, status, message) => json(res, status, { error: message });

const safeKey = key => key.replace(/[^a-zA-Z0-9._:-]+/g, '_');

const formatTimestamp = seconds => {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out`));
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });

const ensureDir = async dir => {
  await mkdir(dir, { recursive: true });
};

const fileExists = async filePath => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const readPreviewMetadata = async outputDir => {
  try {
    const payload = await readFile(join(outputDir, 'metadata.json'), 'utf8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const canUseCachedPreview = async outputDir => {
  const metadata = await readPreviewMetadata(outputDir);
  const cachedFrames = Number.parseInt(String(metadata?.frames || ''), 10);
  const cachedMaxFrames = Number.parseInt(String(metadata?.maxFrames || ''), 10);

  if (!Number.isFinite(cachedFrames) || cachedFrames <= 0) {
    return false;
  }

  return cachedMaxFrames === PREVIEW_MAX_FRAMES || cachedFrames >= PREVIEW_MAX_FRAMES;
};

const probeDuration = async sourceUrl => {
  const { stdout } = await run('ffprobe', [
    ...HLS_INPUT_ARGS,
    ...hlsFormatArgs(sourceUrl),
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    sourceUrl,
  ]);

  const duration = Number.parseFloat(stdout.trim());
  return Number.isFinite(duration) ? duration : null;
};

const probeImageSize = async imagePath => {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0:s=x',
    imagePath,
  ]);

  const [widthRaw, heightRaw] = stdout.trim().split('x');
  const width = Number.parseInt(widthRaw, 10);
  const height = Number.parseInt(heightRaw, 10);
  if (!width || !height) {
    throw new Error('Failed to probe frame dimensions');
  }

  return { width, height };
};

const resolvePreviewInputUrl = async sourceUrl => {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    return sourceUrl;
  }

  const manifest = await response.text();
  if (!manifest.includes('#EXTM3U') || !manifest.includes('#EXT-X-STREAM-INF')) {
    return sourceUrl;
  }

  const lines = manifest.split(/\r?\n/);
  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }

    const nextLine = lines[index + 1]?.trim();
    if (!nextLine || nextLine.startsWith('#')) {
      continue;
    }

    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
    const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    variants.push({
      bandwidth: bandwidthMatch ? Number.parseInt(bandwidthMatch[1], 10) : Number.MAX_SAFE_INTEGER,
      width: resolutionMatch ? Number.parseInt(resolutionMatch[1], 10) : Number.MAX_SAFE_INTEGER,
      height: resolutionMatch ? Number.parseInt(resolutionMatch[2], 10) : Number.MAX_SAFE_INTEGER,
      url: new URL(nextLine, sourceUrl).toString(),
    });
  }

  if (!variants.length) {
    return sourceUrl;
  }

  variants.sort((a, b) => {
    if (a.height !== b.height) return a.height - b.height;
    if (a.width !== b.width) return a.width - b.width;
    return a.bandwidth - b.bandwidth;
  });

  return variants[0].url;
};

const createFramePlan = duration => {
  const safeDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : 10 * 60;
  const requestedFrames = Math.max(1, Math.ceil(safeDuration / PREVIEW_INTERVAL_SECONDS));
  const frameCount = Math.min(PREVIEW_MAX_FRAMES, requestedFrames * 2);
  const intervalSeconds = safeDuration / frameCount;

  return {
    duration: safeDuration,
    frameCount,
    intervalSeconds,
    timestamps: Array.from({ length: frameCount }, (_value, index) =>
      Math.min(index * intervalSeconds, Math.max(0, safeDuration - 0.5))
    ),
  };
};

const extractFrameAtTimestamp = async ({ sourceUrl, workDir, index, timestampSeconds }) => {
  const outputFile = join(workDir, `frame-${String(index + 1).padStart(5, '0')}.jpg`);
  const attempts = [
    timestampSeconds,
    Math.max(0, timestampSeconds - 15),
    Math.max(0, timestampSeconds - 30),
  ];

  for (const attempt of attempts) {
    try {
      await run('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        String(attempt),
        ...HLS_INPUT_ARGS,
        ...hlsFormatArgs(sourceUrl),
        '-i',
        sourceUrl,
        '-frames:v',
        '1',
        '-an',
        '-sn',
        '-vf',
        `scale=${PREVIEW_FRAME_WIDTH}:-1:force_original_aspect_ratio=decrease`,
        '-q:v',
        '4',
        outputFile,
      ]);

      return outputFile;
    } catch (error) {
      await rm(outputFile, { force: true }).catch(() => undefined);
      if (attempt === attempts[attempts.length - 1]) {
        return null;
      }
    }
  }

  return null;
};

const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(runners);
  return results;
};

const generateSprites = async ({ key, sourceUrl }) => {
  const safe = safeKey(key);
  const outputDir = join(DATA_DIR, safe);
  const readyFile = join(outputDir, 'index.vtt');

  if ((await fileExists(readyFile)) && (await canUseCachedPreview(outputDir))) {
    return { key: safe, ready: true, cached: true };
  }

  if (pending.has(safe)) {
    return pending.get(safe);
  }

  const task = (async () => {
    const workDir = join(DATA_DIR, `${safe}.tmp-${Date.now()}`);
    await rm(workDir, { recursive: true, force: true });
    await ensureDir(workDir);

    try {
      const previewInputUrl = await resolvePreviewInputUrl(sourceUrl);
      const duration = await probeDuration(previewInputUrl);
      const framePlan = createFramePlan(duration);

      const generatedFiles = await runWithConcurrency(
        framePlan.timestamps,
        PREVIEW_FFMPEG_CONCURRENCY,
        async (timestampSeconds, index) =>
          extractFrameAtTimestamp({
            sourceUrl: previewInputUrl,
            workDir,
            index,
            timestampSeconds,
          })
      );

      const frameFiles = generatedFiles
        .filter(Boolean)
        .map(filePath => basename(filePath))
        .sort();

      if (!frameFiles.length) {
        throw new Error('No preview frames were generated');
      }

      const { width, height } = await probeImageSize(join(workDir, frameFiles[0]));
      const batchSize = PREVIEW_TILE_COLS * PREVIEW_TILE_ROWS;
      const spriteFiles = [];

      for (let offset = 0; offset < frameFiles.length; offset += batchSize) {
        const spriteIndex = Math.floor(offset / batchSize);
        const spriteFile = `sprite-${String(spriteIndex).padStart(3, '0')}.jpg`;
        const framesInBatch = Math.min(batchSize, frameFiles.length - offset);
        const startNumber = offset + 1;

        await run('ffmpeg', [
          '-y',
          '-loglevel',
          'error',
          '-start_number',
          String(startNumber),
          '-i',
          join(workDir, 'frame-%05d.jpg'),
          '-frames:v',
          '1',
          '-vf',
          `tile=${PREVIEW_TILE_COLS}x${PREVIEW_TILE_ROWS}:nb_frames=${framesInBatch}`,
          '-q:v',
          '4',
          join(workDir, spriteFile),
        ]);

        spriteFiles.push(spriteFile);
      }

      const effectiveDuration = framePlan.duration;
      const vttLines = ['WEBVTT', ''];

      for (let index = 0; index < frameFiles.length; index += 1) {
        const start = framePlan.timestamps[index];
        const end =
          index + 1 < framePlan.timestamps.length
            ? framePlan.timestamps[index + 1]
            : effectiveDuration;
        const spriteIndex = Math.floor(index / batchSize);
        const tileIndex = index % batchSize;
        const col = tileIndex % PREVIEW_TILE_COLS;
        const row = Math.floor(tileIndex / PREVIEW_TILE_COLS);
        const x = col * width;
        const y = row * height;

        vttLines.push(`${formatTimestamp(start)} --> ${formatTimestamp(end)}`);
        vttLines.push(`${spriteFiles[spriteIndex]}#xywh=${x},${y},${width},${height}`);
        vttLines.push('');
      }

      await writeFile(join(workDir, 'index.vtt'), vttLines.join('\n'), 'utf8');
      await writeFile(
        join(workDir, 'metadata.json'),
        JSON.stringify(
          {
            key: safe,
            duration: effectiveDuration,
            intervalSeconds: framePlan.intervalSeconds,
            frameWidth: width,
            frameHeight: height,
            tiles: {
              cols: PREVIEW_TILE_COLS,
              rows: PREVIEW_TILE_ROWS,
            },
            frames: frameFiles.length,
            maxFrames: PREVIEW_MAX_FRAMES,
            generatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );

      await rm(outputDir, { recursive: true, force: true });
      await rename(workDir, outputDir);

      return { key: safe, ready: true, cached: false };
    } catch (error) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      pending.delete(safe);
    }
  })();

  pending.set(safe, task);
  return task;
};

const readBody = req =>
  new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendError(res, 400, 'Missing request URL');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/generate') {
      const rawBody = await readBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const key = typeof payload.key === 'string' ? payload.key : '';
      const sourceUrl = typeof payload.sourceUrl === 'string' ? payload.sourceUrl : '';

      if (!key || !sourceUrl) {
        sendError(res, 400, 'Missing key or sourceUrl');
        return;
      }

      const result = await generateSprites({ key, sourceUrl });
      json(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const key = safeKey(decodeURIComponent(parts[1] || ''));
      const file = basename(decodeURIComponent(parts.slice(2).join('/')));

      if (!key || !file) {
        sendError(res, 400, 'Missing key or file');
        return;
      }

      const filePath = join(DATA_DIR, key, file);
      const exists = await fileExists(filePath);
      if (!exists) {
        sendError(res, 404, 'File not found');
        return;
      }

      if (file === 'index.vtt' && !(await canUseCachedPreview(join(DATA_DIR, key)))) {
        sendError(res, 404, 'Cached preview is stale');
        return;
      }

      const contentType = file.endsWith('.vtt')
        ? 'text/vtt; charset=utf-8'
        : file.endsWith('.jpg') || file.endsWith('.jpeg')
          ? 'image/jpeg'
          : file.endsWith('.png')
            ? 'image/png'
            : file.endsWith('.webp')
              ? 'image/webp'
              : 'application/octet-stream';

      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': file.endsWith('.vtt')
          ? 'public, max-age=300, s-maxage=1800'
          : 'public, max-age=900, s-maxage=3600',
      });

      createReadStream(filePath).pipe(res);
      return;
    }

    sendError(res, 404, 'Not found');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unknown error');
  }
});

await ensureDir(DATA_DIR);

server.listen(PORT, () => {
  console.log(`[preview-service] listening on ${PORT}`);
});
