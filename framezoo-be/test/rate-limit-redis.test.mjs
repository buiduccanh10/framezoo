import assert from 'node:assert/strict';
import fs from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire, registerHooks } from 'node:module';
import { Socket } from 'node:net';
import process from 'node:process';
import { Duplex } from 'node:stream';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { createEvent } from 'h3';

const serverRoot = new URL('../server/', import.meta.url);

if (typeof registerHooks === 'function') {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('~/')) {
        const candidate = new URL(`${specifier.slice(2)}.ts`, serverRoot);
        if (fs.existsSync(candidate)) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        !/\.[a-z]+$/i.test(specifier) &&
        context.parentURL?.startsWith('file:')
      ) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (fs.existsSync(candidate)) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

const require = createRequire(import.meta.url);
const cjsNet = require('node:net');

const { createFailFastRedis } = await import('../server/utils/rateLimitRedis.ts');
const { default: rateLimitMiddleware } = await import('../server/middleware/a-rate-limit.ts');
const { closeOtpRateLimit, enforceOtpRateLimit } = await import('../server/utils/otpRateLimit.ts');

const parseRespCommand = chunk => {
  const lines = chunk.toString('utf8').split('\r\n');
  const args = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]?.startsWith('$') && i + 1 < lines.length) {
      args.push(lines[i + 1]);
      i += 1;
    }
  }
  return args;
};

const withMockRedisSocket = async (handler, fn) => {
  const originalCreateConnection = cjsNet.createConnection;
  const sockets = [];
  let connectionCount = 0;

  cjsNet.createConnection = () => {
    connectionCount += 1;
    const currentConnection = connectionCount;
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        const args = parseRespCommand(chunk);
        const cmd = (args[0] || '').toUpperCase();
        const reply = handler({ cmd, args, connection: currentConnection, socket });
        if (reply instanceof Error) {
          socket.destroy(reply);
          callback();
          return;
        }
        if (reply !== null && reply !== undefined) {
          socket.push(reply);
        }
        callback();
      },
    });
    socket.setNoDelay = () => {};
    socket.setKeepAlive = () => {};
    socket.setTimeout = () => socket;
    socket.connecting = true;
    sockets.push(socket);

    setImmediate(() => {
      const connectResult = handler({
        cmd: '__CONNECT__',
        args: [],
        connection: currentConnection,
        socket,
      });
      socket.connecting = false;
      if (connectResult instanceof Error) {
        socket.destroy(connectResult);
        return;
      }
      socket.emit('connect');
    });
    return socket;
  };

  try {
    return await fn({
      getConnectionCount: () => connectionCount,
      getLatestSocket: () => sockets.at(-1),
    });
  } finally {
    cjsNet.createConnection = originalCreateConnection;
    for (const socket of sockets) {
      if (!socket.destroyed) socket.destroy();
    }
    await new Promise(resolve => setImmediate(resolve));
  }
};

const createMockEvent = (path, method = 'POST') => {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = path;
  req.headers = { 'x-forwarded-for': '203.0.113.10' };
  const res = new ServerResponse(req);
  return { event: createEvent(req, res), res };
};

void test('createFailFastRedis connects concurrently with trimmed REDIS_URL and recovers from end status', async () => {
  const prevUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = ' redis://127.0.0.1:6379 ';
  const redisPool = createFailFastRedis();

  let shouldFailConnect = false;

  try {
    await withMockRedisSocket(
      ({ cmd }) => {
        if (cmd === '__CONNECT__' && shouldFailConnect) return new Error('ECONNREFUSED');
        if (cmd === '__CONNECT__') return null;
        if (cmd === 'INFO') return '$17\r\nredis_version:7.0\r\n';
        if (cmd === 'EVAL') return ':1\r\n';
        return '+OK\r\n';
      },
      async ({ getConnectionCount, getLatestSocket }) => {
        const clients = await Promise.all(
          Array.from({ length: 10 }, () => redisPool.getConnectedClient()),
        );
        assert.equal(getConnectionCount(), 1);
        assert.ok(clients.every(client => client === clients[0] && client.status === 'ready'));
        assert.equal(await clients[0].eval('return 1', 1, 'k', '1000'), 1);

        // Simulate idle disconnect transitioning ioredis to 'end' because retryStrategy returns null.
        getLatestSocket().destroy();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(clients[0].status, 'end');

        const reconnected = await redisPool.getConnectedClient();
        assert.equal(getConnectionCount(), 2);
        assert.equal(reconnected.status, 'ready');
        assert.notEqual(reconnected, clients[0]);

        // Also recover when stream is destroyed before ioredis processes the close tick.
        getLatestSocket().destroy();
        const raceRecovered = await redisPool.getConnectedClient();
        assert.equal(getConnectionCount(), 3);
        assert.equal(raceRecovered.status, 'ready');

        // Simulate temporary connection failure followed by recovery.
        redisPool.reset();
        shouldFailConnect = true;
        await assert.rejects(() => redisPool.getConnectedClient());
        shouldFailConnect = false;
        const recovered = await redisPool.getConnectedClient();
        assert.equal(recovered.status, 'ready');
      },
    );
  } finally {
    redisPool.reset();
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
  }
});

void test('a-rate-limit middleware allows admin login when Redis connects and fails closed when unavailable', async () => {
  const prevFailClosed = process.env.RATE_LIMIT_FAIL_CLOSED;
  const prevTrustProxy = process.env.TRUST_PROXY;
  const prevUrl = process.env.REDIS_URL;
  process.env.RATE_LIMIT_FAIL_CLOSED = 'true';
  process.env.TRUST_PROXY = 'true';
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';

  let counter = 0;

  try {
    await withMockRedisSocket(
      ({ cmd }) => {
        if (cmd === '__CONNECT__') return null;
        if (cmd === 'INFO') return '$17\r\nredis_version:7.0\r\n';
        if (cmd === 'EVAL') {
          counter += 1;
          return `:${counter}\r\n`;
        }
        return '+OK\r\n';
      },
      async () => {
        for (let i = 1; i <= 5; i += 1) {
          const { event, res } = createMockEvent('/api/backup/login');
          await rateLimitMiddleware(event);
          assert.equal(res.getHeader('x-ratelimit-limit'), '5');
          assert.equal(res.getHeader('x-ratelimit-remaining'), String(5 - i));
        }

        const { event } = createMockEvent('/api/backup/login');
        await assert.rejects(
          () => rateLimitMiddleware(event),
          err => err?.statusCode === 429,
        );
      },
    );

    await withMockRedisSocket(
      ({ cmd }) => {
        if (cmd === '__CONNECT__') return new Error('ECONNREFUSED');
        return '+OK\r\n';
      },
      async () => {
        const sensitive = createMockEvent('/api/backup/login');
        await assert.rejects(
          () => rateLimitMiddleware(sensitive.event),
          err => err?.statusCode === 503 && err?.message === 'Rate limiter unavailable',
        );

        const nonSensitive = createMockEvent('/api/tmdb/trending', 'GET');
        await rateLimitMiddleware(nonSensitive.event);
        assert.equal(nonSensitive.res.getHeader('x-ratelimit-limit'), '200');
      },
    );
  } finally {
    if (prevFailClosed === undefined) delete process.env.RATE_LIMIT_FAIL_CLOSED;
    else process.env.RATE_LIMIT_FAIL_CLOSED = prevFailClosed;
    if (prevTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrustProxy;
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
  }
});

void test('enforceOtpRateLimit reconnects cleanly after idle disconnect', async () => {
  const prevUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  closeOtpRateLimit();

  try {
    await withMockRedisSocket(
      ({ cmd }) => {
        if (cmd === '__CONNECT__') return null;
        if (cmd === 'INFO') return '$17\r\nredis_version:7.0\r\n';
        if (cmd === 'EVAL') return '*2\r\n:1\r\n:0\r\n';
        return '+OK\r\n';
      },
      async ({ getConnectionCount, getLatestSocket }) => {
        const first = await enforceOtpRateLimit({
          email: 'user@example.com',
          purpose: 'registration',
          ip: '203.0.113.10',
        });
        assert.deepEqual(first, { allowed: true, retryAfterSeconds: 1 });
        assert.equal(getConnectionCount(), 1);

        // Drop socket while idle; next request should reconnect rather than throwing 503.
        getLatestSocket().destroy();

        const second = await enforceOtpRateLimit({
          email: 'user@example.com',
          purpose: 'registration',
          ip: '203.0.113.10',
        });
        assert.deepEqual(second, { allowed: true, retryAfterSeconds: 1 });
        assert.equal(getConnectionCount(), 2);
      },
    );
  } finally {
    closeOtpRateLimit();
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
  }
});
