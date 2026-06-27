import { JSDOM, VirtualConsole } from 'jsdom';
import { webcrypto } from 'node:crypto';

const FETCH_TIMEOUT_MS = 15000;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_POLL_INTERVAL_MS = 100;
const CHALLENGE_TIMEOUT_MS = 15000;

const tokenCache = new Map<string, { token: string; cachedAt: number }>();

type HeaderMap = Record<string, string>;

function isChallengeResponse(response: Response): boolean {
  return response.status === 202 || response.headers.get('x-amzn-waf-action') === 'challenge';
}

function getHeader(headers: HeaderMap, key: string): string | undefined {
  return headers[key] ?? headers[key.toLowerCase()];
}

function buildTokenCacheKey(url: string, headers: HeaderMap): string {
  const origin = new URL(url).origin;
  const userAgent = getHeader(headers, 'User-Agent') ?? '';
  return `${origin}|${userAgent}`;
}

function getCachedToken(cacheKey: string): string | null {
  const cached = tokenCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > TOKEN_TTL_MS) {
    tokenCache.delete(cacheKey);
    return null;
  }

  return cached.token;
}

function setCachedToken(cacheKey: string, token: string) {
  tokenCache.set(cacheKey, { token, cachedAt: Date.now() });
}

function clearCachedToken(cacheKey: string) {
  tokenCache.delete(cacheKey);
}

function createCanvasContextStub() {
  const baseStub: Record<string, any> = {
    fillRect() {},
    clearRect() {},
    getImageData() {
      return { data: new Uint8ClampedArray(0) };
    },
    putImageData() {},
    createImageData() {
      return [];
    },
    setTransform() {},
    drawImage() {},
    save() {},
    fillText() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    translate() {},
    scale() {},
    rotate() {},
    arc() {},
    fill() {},
    measureText() {
      return { width: 0 };
    },
    transform() {},
    rect() {},
    clip() {},
    // WebGL stubs
    getParameter(p: number) {
      if (p === 37445) return 'Google Inc. (Apple)'; // UNMASKED_VENDOR_WEBGL
      if (p === 37446) return 'ANGLE (Apple, Apple M1, OpenGL 4.1)'; // UNMASKED_RENDERER_WEBGL
      return 'WebKit WebGL';
    },
    getExtension() {
      return null;
    },
    getShaderPrecisionFormat() {
      return { rangeMin: 127, rangeMax: 127, precision: 23 };
    },
    canvas: {},
  };

  return new Proxy(baseStub, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as string];
      }
      return () => {};
    },
  });
}

function installCanvasStub(window: Window & typeof globalThis) {
  const prototype = window.HTMLCanvasElement?.prototype;
  if (!prototype) return;

  Object.defineProperty(prototype, 'getContext', {
    configurable: true,
    value() {
      return createCanvasContextStub();
    },
  });
}

function withTokenHeaders(headers: HeaderMap, token: string): HeaderMap {
  const cookieHeader = getHeader(headers, 'Cookie');

  return {
    ...headers,
    Cookie: cookieHeader ? `${cookieHeader}; aws-waf-token=${token}` : `aws-waf-token=${token}`,
    'x-aws-waf-token': token,
  };
}

async function fetchText(url: string, headers: HeaderMap): Promise<{ response: Response; body: string }> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  return {
    response,
    body: await response.text(),
  };
}

async function waitForAwsWafIntegration(dom: JSDOM): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < CHALLENGE_TIMEOUT_MS) {
    if (typeof dom.window.AwsWafIntegration?.getToken === 'function') {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, CHALLENGE_POLL_INTERVAL_MS));
  }

  throw new Error('AWS WAF integration did not initialize in time');
}

async function solveChallengeToken(challengeHtml: string, url: string): Promise<string> {
  const sanitizedHtml = challengeHtml.replace(
    /<script>\s*AwsWafIntegration\.saveReferrer\(\);[\s\S]*?<\/script>/,
    ''
  );
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(sanitizedHtml, {
    url,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      installCanvasStub(window);
      window.addEventListener('unhandledrejection', event => {
        event.preventDefault();
      });
      window.addEventListener('error', event => {
        event.preventDefault();
      });
      window.fetch = fetch;
      window.Headers = Headers;
      window.Request = Request;
      window.Response = Response;
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.atob = (input: string) => Buffer.from(input, 'base64').toString('binary');
      window.btoa = (input: string) => Buffer.from(input, 'binary').toString('base64');

      // Native Node Web Crypto integration (standard and robust WebCrypto support)
      // Bound to preserve context across JSDOM / Node VM context boundary
      const boundSubtle: Record<string, any> = {};
      const subtleProto = Object.getPrototypeOf(webcrypto.subtle) || {};
      for (const key of Object.getOwnPropertyNames(subtleProto)) {
        if (key === 'constructor') continue;
        try {
          const val = (webcrypto.subtle as any)[key];
          if (typeof val === 'function') {
            boundSubtle[key] = val.bind(webcrypto.subtle);
          }
        } catch {
          // ignore
        }
      }
      for (const key of Object.keys(webcrypto.subtle)) {
        try {
          const val = (webcrypto.subtle as any)[key];
          if (typeof val === 'function') {
            boundSubtle[key] = val.bind(webcrypto.subtle);
          } else {
            boundSubtle[key] = val;
          }
        } catch {
          // ignore
        }
      }

      const boundCrypto = {
        subtle: boundSubtle,
        getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
        randomUUID: webcrypto.randomUUID ? webcrypto.randomUUID.bind(webcrypto) : undefined,
      };

      Object.defineProperty(window, 'crypto', {
        value: boundCrypto,
        writable: true,
        configurable: true,
      });

      // matchMedia mock
      window.matchMedia = window.matchMedia || function() {
        return {
          matches: false,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
        };
      };

      // requestAnimationFrame mock
      window.requestAnimationFrame = window.requestAnimationFrame || function(callback) {
        return setTimeout(() => callback(Date.now()), 16);
      };
      window.cancelAnimationFrame = window.cancelAnimationFrame || function(id) {
        clearTimeout(id);
      };

      // AudioContext / webkitAudioContext mocks
      class AudioContextMock {
        createOscillator() {
          return {
            type: 'sine',
            connect() {},
            start() {},
            stop() {},
          };
        }
        createDynamicsCompressor() {
          return {
            threshold: { value: -24 },
            knee: { value: 30 },
            ratio: { value: 12 },
            attack: { value: 0.003 },
            release: { value: 0.25 },
            connect() {},
          };
        }
        destination = {};
      }
      Object.defineProperty(window, 'AudioContext', { value: AudioContextMock, writable: true, configurable: true });
      Object.defineProperty(window, 'webkitAudioContext', { value: AudioContextMock, writable: true, configurable: true });

      // Fonts API mock
      Object.defineProperty(window.document, 'fonts', {
        value: {
          ready: Promise.resolve(),
          forEach() {},
          addEventListener() {},
          removeEventListener() {},
        },
        writable: true,
        configurable: true,
      });
    },
  });

  try {
    await waitForAwsWafIntegration(dom);

    const token = await dom.window.AwsWafIntegration.getToken({
      timeoutMs: CHALLENGE_TIMEOUT_MS,
    });

    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('AWS WAF challenge returned an empty token');
    }

    return token;
  } finally {
    dom.window.close();
  }
}

export async function fetchTextWithAwsWaf(url: string, headers: HeaderMap): Promise<string> {
  const cacheKey = buildTokenCacheKey(url, headers);
  const cachedToken = getCachedToken(cacheKey);

  if (cachedToken) {
    const cachedAttempt = await fetchText(url, withTokenHeaders(headers, cachedToken));
    if (!isChallengeResponse(cachedAttempt.response)) {
      if (!cachedAttempt.response.ok) {
        throw new Error(`AWS WAF fetch failed with status ${cachedAttempt.response.status}`);
      }
      return cachedAttempt.body;
    }

    clearCachedToken(cacheKey);
  }

  const initialAttempt = await fetchText(url, headers);
  if (!isChallengeResponse(initialAttempt.response)) {
    if (!initialAttempt.response.ok) {
      throw new Error(`Fetch failed with status ${initialAttempt.response.status}`);
    }
    return initialAttempt.body;
  }

  const token = await solveChallengeToken(initialAttempt.body, url);
  setCachedToken(cacheKey, token);

  const finalAttempt = await fetchText(url, withTokenHeaders(headers, token));
  if (isChallengeResponse(finalAttempt.response)) {
    clearCachedToken(cacheKey);
    throw new Error('AWS WAF challenge could not be satisfied');
  }

  if (!finalAttempt.response.ok) {
    throw new Error(`AWS WAF follow-up fetch failed with status ${finalAttempt.response.status}`);
  }

  return finalAttempt.body;
}
