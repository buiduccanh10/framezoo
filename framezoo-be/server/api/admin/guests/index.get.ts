import { defineEventHandler, getQuery } from 'h3';
import { prisma, Prisma } from '~/utils/prisma';
import { getSemverOrderBySql, requireAdmin } from '~/utils/admin';
import {
  getGuestWindowStart,
  parseGuestPlatformFilter,
  parseGuestWindow,
} from '~/utils/guestUtils';

interface GuestRow {
  id: string;
  app_version: string | null;
  platform: string | null;
  request_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
}

interface GuestWindowCountsRow {
  h6: number;
  h24: number;
  d7: number;
  d30: number;
}

interface PlatformBreakdownRow {
  platform: string;
  count: number;
}

interface VersionBreakdownRow {
  version: string | null;
  count: number;
}

const getOrderBySql = (sort: string): Prisma.Sql => {
  switch (sort) {
    case 'last_seen_asc':
      return Prisma.sql`ORDER BY last_seen_at ASC, first_seen_at ASC`;
    case 'first_seen_desc':
      return Prisma.sql`ORDER BY first_seen_at DESC, last_seen_at DESC`;
    case 'requests_desc':
      return Prisma.sql`ORDER BY request_count DESC, last_seen_at DESC`;
    case 'version_desc':
      return getSemverOrderBySql('app_version', 'DESC', Prisma.sql`last_seen_at DESC`);
    case 'version_asc':
      return getSemverOrderBySql('app_version', 'ASC', Prisma.sql`last_seen_at DESC`);
    case 'last_seen_desc':
    default:
      return Prisma.sql`ORDER BY last_seen_at DESC, first_seen_at DESC`;
  }
};

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const query = getQuery(event);
  const window = parseGuestWindow(query.window);
  const platformFilter = parseGuestPlatformFilter(query.platform);
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const sort = typeof query.sort === 'string' ? query.sort : 'last_seen_desc';
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '10'), 10) || 10));
  const offset = (page - 1) * limit;

  const now = new Date();
  const cutoff6h = getGuestWindowStart('6h', now);
  const cutoff24h = getGuestWindowStart('24h', now);
  const cutoff7d = getGuestWindowStart('7d', now);
  const cutoff30d = getGuestWindowStart('30d', now);
  const windowStart = getGuestWindowStart(window, now);

  const normalizedPlatformSql = Prisma.sql`CASE WHEN COALESCE(platform, '') LIKE '% · Web' AND NULLIF(app_version, '') IS NOT NULL THEN REPLACE(platform, ' · Web', ' · Desktop') ELSE COALESCE(NULLIF(platform, ''), 'Không rõ thiết bị') END`;
  const appOnlyCondition = Prisma.sql`(COALESCE(platform, '') LIKE '% · Desktop' OR COALESCE(platform, '') LIKE '% · Mobile' OR COALESCE(platform, '') LIKE '% · TV' OR NULLIF(app_version, '') IS NOT NULL)`;

  const conditions: Prisma.Sql[] = [Prisma.sql`last_seen_at >= ${windowStart}`, appOnlyCondition];
  if (platformFilter !== 'all') {
    conditions.push(Prisma.sql`${normalizedPlatformSql} LIKE ${`% · ${platformFilter}`}`);
  }
  if (search) {
    conditions.push(
      Prisma.sql`(
        strpos(lower(id::text), lower(${search})) > 0
        OR strpos(lower(COALESCE(app_version, '')), lower(${search})) > 0
        OR strpos(lower(${normalizedPlatformSql}), lower(${search})) > 0
      )`
    );
  }
  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  const orderByClause = getOrderBySql(sort);

  const [windowCountsRows, platformRows, versionRows, countRows, guests] = await Promise.all([
    prisma.$queryRaw<GuestWindowCountsRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE last_seen_at >= ${cutoff6h})::int AS h6,
        COUNT(*) FILTER (WHERE last_seen_at >= ${cutoff24h})::int AS h24,
        COUNT(*) FILTER (WHERE last_seen_at >= ${cutoff7d})::int AS d7,
        COUNT(*) FILTER (WHERE last_seen_at >= ${cutoff30d})::int AS d30
      FROM guests
      WHERE last_seen_at >= ${cutoff30d} AND ${appOnlyCondition}
    `,
    prisma.$queryRaw<PlatformBreakdownRow[]>`
      SELECT ${normalizedPlatformSql} AS platform, COUNT(*)::int AS count
      FROM guests
      WHERE last_seen_at >= ${windowStart} AND ${appOnlyCondition}
      GROUP BY 1
      ORDER BY count DESC, platform ASC
      LIMIT 8
    `,
    prisma.$queryRaw<VersionBreakdownRow[]>`
      SELECT NULLIF(app_version, '') AS version, COUNT(*)::int AS count
      FROM guests
      WHERE last_seen_at >= ${windowStart} AND ${appOnlyCondition}
      GROUP BY 1
      ORDER BY count DESC, version DESC NULLS LAST
      LIMIT 6
    `,
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM guests
      ${whereClause}
    `,
    prisma.$queryRaw<GuestRow[]>`
      SELECT
        id::text AS id,
        NULLIF(app_version, '') AS app_version,
        ${normalizedPlatformSql} AS platform,
        request_count,
        first_seen_at,
        last_seen_at
      FROM guests
      ${whereClause}
      ${orderByClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `,
  ]);

  const counts = windowCountsRows[0] ?? { h6: 0, h24: 0, d7: 0, d30: 0 };
  const total = countRows[0]?.total ?? 0;

  return {
    window,
    items: guests.map(guest => ({
      id: guest.id,
      app_version: guest.app_version,
      platform: guest.platform,
      request_count: Number(guest.request_count) || 0,
      first_seen_at: guest.first_seen_at,
      last_seen_at: guest.last_seen_at,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
    stats: {
      counts,
      platforms: platformRows,
      versions: versionRows,
    },
  };
});
