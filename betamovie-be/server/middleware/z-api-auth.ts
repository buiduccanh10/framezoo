import { useAuth } from '~/utils/auth';
import {
  getProxyCapabilityKindForPath,
  getProxyCapabilityToken,
  isValidInternalApiRequest,
  isProxyCapabilityPath,
  verifyProxyCapabilityToken,
} from '~/utils/proxySecurity';

const PUBLIC_API_PATHS = new Set(['/api/providers']);

export default defineEventHandler(async event => {
  if (!event.path.startsWith('/api/')) {
    return;
  }

  // Keep CORS preflight open.
  if (event.method === 'OPTIONS') {
    return;
  }

  // Provider metadata is required before login to bootstrap the player.
  if (PUBLIC_API_PATHS.has(event.path)) {
    return;
  }

  // Capability issuance is intentionally public for anonymous playback.
  // The issuer applies SSRF, header, TTL, and rate-limit controls.
  if (isProxyCapabilityPath(event.path)) {
    return;
  }

  const proxyKind = getProxyCapabilityKindForPath(event.path);
  if (proxyKind) {
    if (isValidInternalApiRequest(event)) {
      return;
    }

    const capability = getProxyCapabilityToken(event);
    if (capability && verifyProxyCapabilityToken(capability, proxyKind)) {
      return;
    }
  } else if (isValidInternalApiRequest(event)) {
    return;
  }

  const session = await useAuth().getCurrentSessionForEvent(event);
  event.context.session = session;
});
