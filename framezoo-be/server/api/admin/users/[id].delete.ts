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

  const user = await prisma.users.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  await prisma.$transaction(async tx => {
    await tx.bookmarks.deleteMany({ where: { user_id: userId } });
    await tx.progress_items.deleteMany({ where: { user_id: userId } });
    await tx.watch_history.deleteMany({ where: { user_id: userId } });
    await tx.user_group_order.deleteMany({ where: { user_id: userId } }).catch(() => {});
    await tx.user_settings.deleteMany({ where: { id: userId } }).catch(() => {});
    await tx.sessions.deleteMany({ where: { user: userId } });
    await tx.feedbacks.updateMany({ where: { user_id: userId }, data: { user_id: null } });
    await tx.users.delete({ where: { id: userId } });
  });

  return {
    success: true,
    message: `User ${user.nickname} (${userId}) deleted successfully`,
  };
});
