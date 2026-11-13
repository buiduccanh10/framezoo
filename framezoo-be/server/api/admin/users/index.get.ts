import { defineEventHandler, getQuery } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const query = getQuery(event);
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '10'), 10) || 10));
  const sort = typeof query.sort === 'string' ? query.sort : 'created_desc';

  // Build where filter
  const where: any = {};
  if (search) {
    where.OR = [
      { nickname: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { id: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Determine sorting order
  let orderBy: any;
  switch (sort) {
    case 'created_asc':
      orderBy = { created_at: 'asc' };
      break;
    case 'login_desc':
      orderBy = { last_logged_in: { sort: 'desc', nulls: 'last' } };
      break;
    case 'login_asc':
      orderBy = { last_logged_in: { sort: 'asc', nulls: 'first' } };
      break;
    case 'nickname_asc':
      orderBy = { nickname: 'asc' };
      break;
    case 'nickname_desc':
      orderBy = { nickname: 'desc' };
      break;
    case 'version_desc':
      orderBy = { app_version: { sort: 'desc', nulls: 'last' } };
      break;
    case 'version_asc':
      orderBy = { app_version: { sort: 'asc', nulls: 'last' } };
      break;
    case 'created_desc':
    default:
      orderBy = { created_at: 'desc' };
      break;
  }

  // Calculate 30 days ago for active users metric
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Fetch metrics and user data in parallel
  const [totalCount, totalUsers, activeRecently, usersWithEmail, totalSessions, users] =
    await Promise.all([
      prisma.users.count({ where }),
      prisma.users.count(),
      prisma.users.count({
        where: {
          last_logged_in: { gte: thirtyDaysAgo },
        },
      }),
      prisma.users.count({
        where: {
          email: { not: null },
        },
      }),
      prisma.sessions.count(),
      prisma.users.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          nickname: true,
          email: true,
          created_at: true,
          last_logged_in: true,
          permissions: true,
          profile: true,
          app_version: true,
        },
      }),
    ]);

  // Aggregate per-user session counts and latest app version without exposing media history or addon URLs.
  const userIds = users.map(u => u.id);

  let sessionsCountMap = new Map<string, number>();
  let sessionMaxMap = new Map<string, Date | null>();
  let sessionVersionMap = new Map<string, string>();

  if (userIds.length > 0) {
    const [sessionsGroup, latestSessions] = await Promise.all([
      prisma.sessions.groupBy({
        by: ['user'],
        where: { user: { in: userIds } },
        _count: { _all: true },
        _max: { accessed_at: true },
      }),
      prisma.sessions.findMany({
        where: { user: { in: userIds }, app_version: { not: null } },
        orderBy: { accessed_at: 'desc' },
        select: { user: true, app_version: true },
      }),
    ]);

    sessionsCountMap = new Map(sessionsGroup.map(g => [g.user, g._count._all]));
    sessionMaxMap = new Map(sessionsGroup.map(g => [g.user, g._max.accessed_at]));
    for (const s of latestSessions) {
      if (s.app_version && !sessionVersionMap.has(s.user)) {
        sessionVersionMap.set(s.user, s.app_version);
      }
    }
  }

  const items = users.map(u => {
    const sessionAccessedAt = sessionMaxMap.get(u.id);
    const lastActive =
      sessionAccessedAt && (!u.last_logged_in || sessionAccessedAt > u.last_logged_in)
        ? sessionAccessedAt
        : u.last_logged_in;

    return {
      id: u.id,
      nickname: u.nickname,
      email: u.email,
      created_at: u.created_at,
      last_logged_in: lastActive,
      permissions: u.permissions,
      profile: u.profile,
      app_version: u.app_version || sessionVersionMap.get(u.id) || null,
      counts: {
        sessions: sessionsCountMap.get(u.id) || 0,
      },
    };
  });

  return {
    items,
    pagination: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
    stats: {
      totalUsers,
      activeRecently,
      usersWithEmail,
      totalSessions,
    },
  };
});
