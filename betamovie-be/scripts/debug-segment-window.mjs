#!/usr/bin/env node
/**
 * Probe a segment-number window by cloning a sample segment URL.
 *
 * Usage:
 *   node scripts/debug-segment-window.mjs \
 *     --sample-url 'https://.../seg-464-v1-a1.webp?...' \
 *     --from 455 --to 490
 *
 * Optional:
 *   --headers '{"Referer":"https://vidlink.pro/","Origin":"https://vidlink.pro"}'
 *   --timeout-ms 15000
 *   --concurrency 4
 *   --hostless true   # remove `host=` query param for each request variant
 */

const args = process.argv.slice(2);

const getArg = key => {
  const idx = args.indexOf(`--${key}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const required = (name, value) => {
  if (value == null || value === '') {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
};

const sampleUrl = getArg('sample-url');
const fromRaw = getArg('from');
const toRaw = getArg('to');
const headersRaw = getArg('headers');
const timeoutMs = Number.parseInt(getArg('timeout-ms') || '15000', 10);
const concurrency = Number.parseInt(getArg('concurrency') || '4', 10);
const hostless = (getArg('hostless') || 'false').toLowerCase() === 'true';

required('sample-url', sampleUrl);
required('from', fromRaw);
required('to', toRaw);

const from = Number.parseInt(fromRaw, 10);
const to = Number.parseInt(toRaw, 10);

if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
  console.error('Invalid --from/--to');
  process.exit(1);
}

const segmentPattern = /(seg-)(\d+)(-[^/?#]*)/i;
if (!segmentPattern.test(sampleUrl)) {
  console.error('Cannot find `seg-<number>-...` pattern in --sample-url');
  process.exit(1);
}

let customHeaders = {};
if (headersRaw) {
  try {
    customHeaders = JSON.parse(headersRaw);
  } catch (err) {
    console.error('Invalid --headers JSON:', err.message);
    process.exit(1);
  }
}

const buildUrl = n => sampleUrl.replace(segmentPattern, (_m, p1, _p2, p3) => `${p1}${n}${p3}`);

const maybeHostless = rawUrl => {
  if (!hostless) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('host');
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

const fetchWithTimeout = async url => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: customHeaders,
      signal: controller.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - started,
      bytes: buf.byteLength,
      contentType: res.headers.get('content-type') || '',
      error: '',
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      bytes: 0,
      contentType: '',
      error: err?.name === 'AbortError' ? 'TIMEOUT' : String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
};

const queue = [];
for (let i = from; i <= to; i += 1) queue.push(i);

const results = [];

const worker = async () => {
  while (queue.length) {
    const n = queue.shift();
    if (n == null) return;
    const raw = buildUrl(n);
    const url = maybeHostless(raw);
    const r = await fetchWithTimeout(url);
    results.push({ n, ...r, url });
    const flag = r.ok ? 'OK ' : 'ERR';
    console.log(
      `${flag} seg-${n} status=${r.status} bytes=${r.bytes} t=${r.durationMs}ms ct=${r.contentType || '-'}${r.error ? ` err=${r.error}` : ''}`
    );
  }
};

const runners = [];
for (let i = 0; i < Math.max(1, concurrency); i += 1) {
  runners.push(worker());
}
await Promise.all(runners);

results.sort((a, b) => a.n - b.n);
const failed = results.filter(r => !r.ok);
const ok = results.filter(r => r.ok);

console.log('\n=== Summary ===');
console.log(`Range: seg-${from}..seg-${to}`);
console.log(`Success: ${ok.length}, Failed: ${failed.length}`);

if (failed.length) {
  const failedNums = failed.map(r => r.n);
  console.log(`Failed segments: ${failedNums.join(', ')}`);
}
