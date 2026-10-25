import { defineEventHandler, getQuery } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const query = getQuery(event);
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '50'), 10) || 50));
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
        },
      }),
    ]);

  // Aggregate per-user counts for the current page
  const userIds = users.map(u => u.id);

  let bookmarksCountMap = new Map<string, number>();
  let watchHistoryCountMap = new Map<string, number>();
  let progressCountMap = new Map<string, number>();
  let sessionsCountMap = new Map<string, number>();
  let addonsCountMap = new Map<string, number>();

  if (userIds.length > 0) {
    const [bookmarksGroup, watchHistoryGroup, progressGroup, sessionsGroup, settingsList] =
      await Promise.all([
        prisma.bookmarks.groupBy({
          by: ['user_id'],
          where: { user_id: { in: userIds } },
          _count: { _all: true },
        }),
        prisma.watch_history.groupBy({
          by: ['user_id'],
          where: { user_id: { in: userIds } },
          _count: { _all: true },
        }),
        prisma.progress_items.groupBy({
          by: ['user_id'],
          where: { user_id: { in: userIds } },
          _count: { _all: true },
        }),
        prisma.sessions.groupBy({
          by: ['user'],
          where: { user: { in: userIds } },
          _count: { _all: true },
        }),
        prisma.user_settings.findMany({
          where: { id: { in: userIds } },
          select: { id: true, addons: true },
        }),
      ]);

    bookmarksCountMap = new Map(bookmarksGroup.map(g => [g.user_id, g._count._all]));
    watchHistoryCountMap = new Map(watchHistoryGroup.map(g => [g.user_id, g._count._all]));
    progressCountMap = new Map(progressGroup.map(g => [g.user_id, g._count._all]));
    sessionsCountMap = new Map(sessionsGroup.map(g => [g.user, g._count._all]));

    addonsCountMap = new Map(
      settingsList.map(s => {
        const count = Array.isArray(s.addons) ? s.addons.length : 0;
        return [s.id, count];
      })
    );
  }

  const items = users.map(u => ({
    id: u.id,
    nickname: u.nickname,
    email: u.email,
    created_at: u.created_at,
    last_logged_in: u.last_logged_in,
    permissions: u.permissions,
    profile: u.profile,
    counts: {
      bookmarks: bookmarksCountMap.get(u.id) || 0,
      watchHistory: watchHistoryCountMap.get(u.id) || 0,
      progress: progressCountMap.get(u.id) || 0,
      sessions: sessionsCountMap.get(u.id) || 0,
      addons: addonsCountMap.get(u.id) || 0,
    },
  }));

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
