import { defineEventHandler, getQuery } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const query = getQuery(event);
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 120) : '';
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '20'), 10) || 20));
  const status = query.status === 'pending' || query.status === 'resolved' ? query.status : undefined;
  const matchingUsers = search
    ? await prisma.users.findMany({
        where: {
          OR: [
            { nickname: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { id: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 1000,
      })
    : [];
  const where: any = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      ...(matchingUsers.length ? [{ user_id: { in: matchingUsers.map(user => user.id) } }] : []),
    ];
  }
  const statsWhere = search && where.OR ? { OR: where.OR } : {};

  const [total, pending, resolved, feedbacks] = await Promise.all([
    prisma.feedbacks.count({ where }),
    prisma.feedbacks.count({ where: { ...statsWhere, status: 'pending' } }),
    prisma.feedbacks.count({ where: { ...statsWhere, status: 'resolved' } }),
    prisma.feedbacks.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ]);

  const userIds = [
    ...new Set(
      feedbacks
        .map(f => f.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];

  let userMap = new Map<string, { id: string; nickname: string; email: string | null }>();

  if (userIds.length > 0) {
    const users = await prisma.users.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        nickname: true,
        email: true,
      },
    });
    userMap = new Map(users.map(u => [u.id, u]));
  }

  const items = feedbacks.map(f => {
    const user = f.user_id ? userMap.get(f.user_id) || null : null;
    return {
      id: f.id,
      title: f.title,
      description: f.description,
      status: f.status,
      user_id: f.user_id,
      user: user
        ? {
            id: user.id,
            nickname: user.nickname,
            email: user.email,
          }
        : null,
      created_at: f.created_at,
      updated_at: f.updated_at,
    };
  });

  return {
    success: true,
    feedbacks: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    stats: { total, pending, resolved },
  };
});
