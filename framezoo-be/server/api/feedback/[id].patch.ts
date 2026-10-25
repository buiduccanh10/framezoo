import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
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

  const body = await readBody<{ status?: string }>(event);
  const status = body?.status;

  if (!status || !['pending', 'resolved'].includes(status)) {
    throw createError({
      statusCode: 400,
      message: 'Trạng thái không hợp lệ (pending hoặc resolved)',
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

  const updated = await prisma.feedbacks.update({
    where: { id },
    data: {
      status,
      updated_at: new Date(),
    },
  });

  return {
    success: true,
    feedback: updated,
  };
});
