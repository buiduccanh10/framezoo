import { defineEventHandler } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const feedbacks = await prisma.feedbacks.findMany({
    orderBy: { created_at: 'desc' },
  });

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
  };
});
