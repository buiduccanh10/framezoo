import { defineEventHandler, createError } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const userId = event.context.params?.id;
  if (!userId) {
    throw createError({
      statusCode: 400,
      message: 'User ID is required',
    });
  }

  const deletedCount = await prisma.$transaction(async tx => {
    const [user, agg] = await Promise.all([
      tx.users.findUnique({
        where: { id: userId },
        select: { last_logged_in: true },
      }),
      tx.sessions.aggregate({
        where: { user: userId },
        _max: { accessed_at: true },
      }),
    ]);

    const maxAccessed = agg._max.accessed_at;
    if (user && maxAccessed && (!user.last_logged_in || maxAccessed > user.last_logged_in)) {
      await tx.users.update({
        where: { id: userId },
        data: { last_logged_in: maxAccessed },
      });
    }

    const deleted = await tx.sessions.deleteMany({
      where: { user: userId },
    });
    return deleted.count;
  });

  return {
    success: true,
    revokedCount: deletedCount,
    message: `Đã đăng xuất ${deletedCount} phiên hoạt động của người dùng`,
  };
});
