import { defineEventHandler, getRouterParam, createError } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'ID phản hồi là bắt buộc',
    });
  }

  const existing = await prisma.feedbacks.findUnique({
    where: { id },
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Không tìm thấy phản hồi',
    });
  }

  await prisma.feedbacks.delete({
    where: { id },
  });

  return {
    success: true,
    message: 'Đã xóa phản hồi thành công',
  };
});
