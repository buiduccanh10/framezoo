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

  const deleted = await prisma.sessions.deleteMany({
    where: { user: userId },
  });

  return {
    success: true,
    revokedCount: deleted.count,
    message: `Đã đăng xuất ${deleted.count} phiên hoạt động của người dùng`,
  };
});
