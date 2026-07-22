import crypto from 'node:crypto';
import process from 'node:process';
import jwt from 'jsonwebtoken';

const baseUrl = (process.env.SECURITY_E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const internalToken = (process.env.INTERNAL_API_TOKEN || '').trim();
const cryptoSecret = (process.env.CRYPTO_SECRET || '').trim();
const upstreamUrl = new URL(
  process.env.SECURITY_E2E_UPSTREAM_URL || 'https://example.com'
).toString();
const privateUpstreamUrl =
  process.env.SECURITY_E2E_PRIVATE_URL || 'http://127.0.0.1:3000/healthcheck';
const mappedPrivateUpstreamUrl = 'http://[::ffff:7f00:1]/healthcheck';

if (!internalToken || !cryptoSecret) {
  throw new Error('INTERNAL_API_TOKEN and CRYPTO_SECRET are required');
}

const request = (path, init = {}) => fetch(`${baseUrl}${path}`, init);

const assertStatus = async (label, response, expected) => {
  if (response.status !== expected) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `${label}: expected ${expected}, got ${response.status}: ${body.slice(0, 240)}`
    );
  }
  console.log(`${label}: ${response.status}`);
};

const assertNotUnauthorized = async (label, response) => {
  if (response.status === 401) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label}: unexpected 401: ${body.slice(0, 240)}`);
  }
  console.log(`${label}: ${response.status}`);
};

for (const path of [
  '/api/m3u8-proxy',
  '/api/media-proxy',
]) {
  await assertStatus(
    `anonymous ${path}`,
    await request(path.includes('?') ? path : `${path}?url=${encodeURIComponent(upstreamUrl)}`),
    401
  );
}

await assertStatus(
  'invalid capability',
  await request(`/api/m3u8-proxy?url=${encodeURIComponent(upstreamUrl)}&capability=invalid`),
  401
);

await assertStatus(
  'query internal token rejected',
  await request(
    `/api/m3u8-proxy?url=${encodeURIComponent(
      upstreamUrl
    )}&internalToken=${encodeURIComponent(internalToken)}`
  ),
  401
);

await assertStatus('anonymous metrics', await request('/metrics'), 401);

await assertStatus(
  'invalid capability body',
  await request('/api/proxy/capability', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  }),
  400
);

const corsPreflightResponse = await request('/api/proxy/capability', {
  method: 'OPTIONS',
  headers: {
    Origin: 'http://localhost:5173',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'X-Internal-Token, X-Proxy-Capability',
  },
});
await assertStatus('capability CORS preflight', corsPreflightResponse, 204);
const allowedHeaders = corsPreflightResponse.headers.get('access-control-allow-headers') || '';
if (allowedHeaders.toLowerCase().includes('x-internal-token')) {
  throw new Error('capability CORS preflight: internal token header was exposed');
}
if (!allowedHeaders.toLowerCase().includes('x-proxy-capability')) {
  throw new Error('capability CORS preflight: capability header was not allowed');
}
console.log('capability CORS preflight: internal header hidden');

const publicCapabilityResponse = await request('/api/proxy/capability', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    kind: 'm3u8',
    url: upstreamUrl,
  }),
});
await assertStatus('anonymous capability issuer', publicCapabilityResponse, 200);
const publicCapabilityPayload = await publicCapabilityResponse.json();
if (
  typeof publicCapabilityPayload?.capability !== 'string' ||
  typeof publicCapabilityPayload?.url !== 'string'
) {
  throw new Error('anonymous capability issuer: malformed response');
}
console.log('anonymous capability issuer: payload valid');

const issueCapability = async (kind, url, resource = '') => {
  const response = await request('/api/proxy/capability', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ kind, url, ...(resource ? { resource } : {}) }),
  });
  await assertStatus(`${kind} capability issuer`, response, 200);
  const payload = await response.json();
  if (typeof payload?.url !== 'string') {
    throw new Error(`${kind} capability issuer: missing URL`);
  }
  const parsed = new URL(payload.url);
  return `${parsed.pathname}${parsed.search}`;
};

const embedCapabilityUrl = await issueCapability('embed', upstreamUrl);

for (const path of [
  '/api/embed/api/m3u8-proxy',
  '/api/embed/api/media-proxy',
  '/api/embed/api/ts-proxy',
]) {
  await assertStatus(
    `anonymous ${path}`,
    await request(`${path}?url=${encodeURIComponent(upstreamUrl)}`),
    401
  );
}

for (const path of ['/api/m3u8-proxy', '/api/media-proxy']) {
  await assertNotUnauthorized(
    `internal ${path}`,
    await request(`${path}?url=${encodeURIComponent(upstreamUrl)}`, {
      headers: {
        'x-internal-token': internalToken,
      },
    })
  );
}

for (const path of [
  '/api/embed/api/m3u8-proxy',
  '/api/embed/api/media-proxy',
  '/api/embed/api/ts-proxy',
]) {
  await assertStatus(
    `internal SSRF guard ${path}`,
    await request(`${path}?url=${encodeURIComponent(privateUpstreamUrl)}`, {
      headers: {
        'x-internal-token': internalToken,
      },
    }),
    400
  );
}

await assertNotUnauthorized('valid embed capability', await request(embedCapabilityUrl));

await assertStatus(
  'private upstream blocked',
  await request(
    `/api/m3u8-proxy?url=${encodeURIComponent(
      process.env.SECURITY_E2E_PRIVATE_URL || 'http://127.0.0.1:3000/healthcheck'
    )}`,
    {
      headers: {
        'x-internal-token': internalToken,
      },
    }
  ),
  400
);

await assertStatus(
  'mapped IPv4 private upstream blocked',
  await request(`/api/m3u8-proxy?url=${encodeURIComponent(mappedPrivateUpstreamUrl)}`, {
    headers: {
      'x-internal-token': internalToken,
    },
  }),
  400
);

for (const path of [
  '/api/embed/api/m3u8-proxy',
  '/api/embed/api/media-proxy',
  '/api/embed/api/ts-proxy',
]) {
  await assertStatus(
    `private upstream blocked ${path}`,
    await request(`${path}?url=${encodeURIComponent(privateUpstreamUrl)}`, {
      headers: {
        'x-internal-token': internalToken,
      },
    }),
    400
  );
}

const capabilityTarget = new URL(upstreamUrl).toString();
const requestHash = crypto
  .createHash('sha256')
  .update(
    JSON.stringify({
      kind: 'm3u8',
      targetUrl: capabilityTarget,
      headers: {},
      resource: '',
    })
  )
  .digest('hex');
const capability = jwt.sign(
  {
    typ: 'proxy-capability',
    kind: 'm3u8',
    requestHash,
  },
  cryptoSecret,
  {
    algorithm: 'HS256',
    audience: 'betamovie-proxy',
    expiresIn: '1h',
  }
);

await assertNotUnauthorized(
  'valid capability',
  await request(
    `/api/m3u8-proxy?url=${encodeURIComponent(capabilityTarget)}&capability=${encodeURIComponent(
      capability
    )}`
  )
);

await assertStatus(
  'tampered capability',
  await request(
    `/api/m3u8-proxy?url=${encodeURIComponent(
      new URL('https://example.org').toString()
    )}&capability=${encodeURIComponent(capability)}`
  ),
  401
);

for (const path of [
  '/desktop-updates/%2e%2e/%2e%2e/etc/passwd',
  '/desktop-updates/%2e%2e/etc/passwd',
  '/download?option=../../etc/passwd',
]) {
  await assertStatus(`path traversal blocked ${path}`, await request(path), 404);
}

const expectedRateLimit = Number(process.env.SECURITY_E2E_RATE_LIMIT_MAX_REQUESTS || 0);
if (expectedRateLimit > 0) {
  let lastResponse;
  for (let index = 0; index <= expectedRateLimit; index += 1) {
    lastResponse = await request(`/api/m3u8-proxy?url=${encodeURIComponent(upstreamUrl)}`);
  }
  await assertStatus('rate limit', lastResponse, 429);
}

console.log('security E2E passed');
