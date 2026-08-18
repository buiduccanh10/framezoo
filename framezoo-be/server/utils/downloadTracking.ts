import { randomUUID } from 'node:crypto';

import {
  getCookie,
  getRequestHost,
  getRequestProtocol,
  setCookie,
  type H3Event,
} from 'h3';

import { prisma } from './prisma';
import { scopedLogger } from './logger';
import { useAuth } from './auth';

const log = scopedLogger('download-tracking');
const DOWNLOAD_VISITOR_COOKIE = 'fz_download_visitor';
const DOWNLOAD_VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DownloadIdentity = {
  type: 'account' | 'visitor';
  key: string;
};

function isSecureCookieRequest(event: H3Event) {
  if (getRequestProtocol(event, { xForwardedProto: true }) === 'https') {
    return true;
  }

  const host = getRequestHost(event, { xForwardedHost: true }).split(':')[0];
  return (
    process.env.NODE_ENV === 'production' &&
    !['localhost', '127.0.0.1', '::1'].includes(host)
  );
}

function getOrCreateVisitorIdentity(event: H3Event): DownloadIdentity {
  const existingValue = getCookie(event, DOWNLOAD_VISITOR_COOKIE);
  if (existingValue && UUID_PATTERN.test(existingValue)) {
    return { type: 'visitor', key: existingValue };
  }

  const value = randomUUID();
  setCookie(event, DOWNLOAD_VISITOR_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(event),
    path: '/',
    maxAge: DOWNLOAD_VISITOR_COOKIE_MAX_AGE,
  });

  return { type: 'visitor', key: value };
}

async function resolveDownloadIdentity(event: H3Event): Promise<DownloadIdentity> {
  const session = await useAuth().getOptionalCurrentSessionForEvent(event);
  if (session?.user) {
    return { type: 'account', key: session.user };
  }

  return getOrCreateVisitorIdentity(event);
}

export async function recordUniqueDownload(
  event: H3Event,
  version: string,
  optionId: string,
) {
  const identity = await resolveDownloadIdentity(event);
  const now = new Date();
  const result = await prisma.download_unique_users.createMany({
    data: {
      identity_type: identity.type,
      identity_key: identity.key,
      version,
      option_id: optionId,
      first_downloaded_at: now,
      last_downloaded_at: now,
    },
    skipDuplicates: true,
  });

  if (result.count === 0) {
    await prisma.download_unique_users.updateMany({
      where: {
        identity_type: identity.type,
        identity_key: identity.key,
        version,
        option_id: optionId,
      },
      data: {
        last_downloaded_at: now,
      },
    });

    return {
      identityType: identity.type,
      isUnique: false,
      totalUniqueCount: null,
      versionUniqueCount: null,
    };
  }

  const [totalUniqueCount, versionUniqueCount] = await Promise.all([
    prisma.download_unique_users.count(),
    prisma.download_unique_users.count({
      where: {
        version,
        option_id: optionId,
      },
    }),
  ]);

  log.info('Unique desktop download recorded', {
    evt: 'download_unique',
    version,
    optionId,
    identityType: identity.type,
    totalUniqueCount,
    versionUniqueCount,
  });

  return {
    identityType: identity.type,
    isUnique: true,
    totalUniqueCount,
    versionUniqueCount,
  };
}
