import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createEvent } from 'h3';

import {
  parseBoundedSpeechIntervalWindows,
  parseBoundedWindowDurations,
  parseBoundedWindowStarts,
  readBoundedMultipartFormData,
} from '../server/utils/subtitleAlignValidation.ts';

function buildFakeMultipartEvent({ chunks = [], headers = {}, method = 'POST' }) {
  const stream = Readable.from(chunks);
  Object.assign(stream, { headers, method });
  return createEvent(stream, {});
}

test('readBoundedMultipartFormData rejects oversized Content-Length before reading body', async () => {
  const event = buildFakeMultipartEvent({
    headers: {
      'content-type': 'multipart/form-data; boundary=testbound',
      'content-length': '99999999',
    },
  });

  await assert.rejects(
    () => readBoundedMultipartFormData(event, 1024),
    error => error?.statusCode === 413
  );
});

test('readBoundedMultipartFormData aborts chunked upload exceeding byte limit', async () => {
  const oversizedChunks = [Buffer.alloc(700, 97), Buffer.alloc(700, 98)];
  const event = buildFakeMultipartEvent({
    chunks: oversizedChunks,
    headers: {
      'content-type': 'multipart/form-data; boundary=testbound',
      'transfer-encoding': 'chunked',
    },
  });

  await assert.rejects(
    () => readBoundedMultipartFormData(event, 1024),
    error => error?.statusCode === 413
  );
  assert.equal(event.node.req.destroyed, true);
});

test('readBoundedMultipartFormData parses valid small multipart upload', async () => {
  const boundary = 'framezootestboundary';
  const payload =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="language"\r\n\r\n` +
    `en\r\n` +
    `--${boundary}--\r\n`;
  const buf = Buffer.from(payload, 'utf8');
  const event = buildFakeMultipartEvent({
    chunks: [buf],
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(buf.byteLength),
    },
  });

  const parts = await readBoundedMultipartFormData(event, 4096);
  assert.ok(Array.isArray(parts));
  assert.equal(parts[0].name, 'language');
  assert.equal(parts[0].data.toString('utf8'), 'en');
});

test('window metadata parsers reject huge durations, out-of-range starts, and unbounded intervals', () => {
  assert.deepEqual(parseBoundedWindowStarts('[0, 60000]', 2), [0, 60000]);
  assert.deepEqual(parseBoundedWindowDurations('[60000, 60000]', 2), [60000, 60000]);

  assert.throws(
    () => parseBoundedWindowDurations('[100000000]', 1),
    error => error?.statusCode === 400
  );
  assert.throws(
    () => parseBoundedWindowDurations('[100]', 1),
    error => error?.statusCode === 400
  );
  assert.throws(
    () => parseBoundedWindowStarts('[999999999]', 1),
    error => error?.statusCode === 400
  );
  assert.throws(
    () =>
      parseBoundedSpeechIntervalWindows(
        JSON.stringify([[{ startMs: 0, endMs: 250000 }]]),
        [0],
        [60000]
      ),
    error => error?.statusCode === 400
  );

  const valid = parseBoundedSpeechIntervalWindows(
    JSON.stringify([[{ startMs: 1200, endMs: 4200 }]]),
    [0],
    [60000]
  );
  assert.deepEqual(valid, [[{ startMs: 1200, endMs: 4200 }]]);
});
