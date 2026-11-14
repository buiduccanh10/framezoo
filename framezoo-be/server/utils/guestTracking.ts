import { getHeader, readBody, type H3Event } from 'h3';
import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';
import { extractAppVersionFromHeaders } from '~/utils/clientVersion';
import {
  isAppGuestPlatform,
  normalizeGuestId,
  reserveGuestActivityFlush,
  summarizeClientPlatform,
  type GuestActivityCacheEntry,
} from '~/utils/guestUtils';

const guestActivityCache = new Map<string, GuestActivityCacheEntry>();

export function resolveGuestClientMeta(event: H3Event) {
  const rawUa = getHeader(event, 'user-agent');
  const userAgent = typeof rawUa === 'string' ? rawUa.trim().slice(0, 1024) : '';
  const appVersion = extractAppVersionFromHeaders(getHeader(event, 'x-app-version'), userAgent);
  const platform = summarizeClientPlatform(userAgent, appVersion);

  return {
    appVersion,
    platform,
    userAgent: userAgent || null,
  };
}

export async function recordGuestActivity(input: {
  guestId: string;
  appVersion: string | null;
  platform: string;
  userAgent: string | null;
  bypassThrottle?: boolean;
}): Promise<void> {
  const normalizedId = normalizeGuestId(input.guestId);
  if (!normalizedId) return;
  if (!isAppGuestPlatform(input.platform, input.appVersion)) return;

  const { shouldFlush, hitIncrement } = reserveGuestActivityFlush(guestActivityCache, {
    guestId: normalizedId,
    appVersion: input.appVersion,
    platform: input.platform,
    bypassThrottle: input.bypassThrottle,
  });

  if (!shouldFlush) return;

  const now = new Date();
  try {
    await prisma.$executeRaw`
      INSERT INTO guests (id, app_version, platform, user_agent, request_count, first_seen_at, last_seen_at)
      VALUES (
        ${normalizedId}::uuid,
        ${input.appVersion},
        ${input.platform},
        ${input.userAgent},
        ${hitIncrement},
        ${now},
        ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
        last_seen_at = GREATEST(guests.last_seen_at, EXCLUDED.last_seen_at),
        app_version = COALESCE(EXCLUDED.app_version, guests.app_version),
        platform = CASE
          WHEN EXCLUDED.platform IS NOT NULL
            AND EXCLUDED.platform <> 'Không rõ thiết bị'
            AND (
              guests.platform IS NULL
              OR guests.platform = 'Không rõ thiết bị'
              OR guests.platform LIKE 'Khác · %'
              OR EXCLUDED.platform NOT LIKE 'Khác · %'
            )
          THEN EXCLUDED.platform
          ELSE guests.platform
        END,
        user_agent = COALESCE(NULLIF(EXCLUDED.user_agent, ''), guests.user_agent),
        request_count = guests.request_count + ${hitIncrement}
    `;
  } catch (err) {
    console.warn(
      '[guest-tracking] failed to persist guest activity:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function touchGuestActivityFromEvent(
  event: H3Event,
  guestId: string,
  options?: { bypassThrottle?: boolean }
): Promise<void> {
  const meta = resolveGuestClientMeta(event);
  return recordGuestActivity({
    guestId,
    appVersion: meta.appVersion,
    platform: meta.platform,
    userAgent: meta.userAgent,
    bypassThrottle: options?.bypassThrottle,
  });
}

export async function issueGuestTokenForEvent(event: H3Event) {
  const auth = useAuth();
  let requestedGuestId: string | null = null;

  try {
    const body = (await readBody(event)) as { guestId?: unknown; guest_id?: unknown } | null;
    if (body && typeof body === 'object') {
      requestedGuestId = normalizeGuestId(body.guestId ?? body.guest_id);
    }
  } catch {
    // Allow empty or non-JSON bodies from legacy guest callers.
  }

  if (!requestedGuestId) {
    requestedGuestId = normalizeGuestId(getHeader(event, 'x-guest-id'));
  }

  const tokens = auth.makeGuestToken(requestedGuestId ?? undefined);
  await touchGuestActivityFromEvent(event, tokens.guestId, { bypassThrottle: true });
  return auth.toGuestTokenResponse(tokens);
}
