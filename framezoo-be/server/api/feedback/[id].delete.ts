import { defineEventHandler, getRouterParam, createError } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';
import { parseFeedbackAttachments, removeFeedbackAttachments } from '~/utils/feedback-storage';

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

  const attachments = parseFeedbackAttachments(existing.attachments);
  try {
    await removeFeedbackAttachments(attachments);
  } catch (error) {
    console.error('[feedback] attachment removal failed:', error);
    throw createError({
      statusCode: 503,
      message: 'Không thể xóa files đính kèm, vui lòng thử lại sau',
    });
  }

  await prisma.feedbacks.delete({ where: { id } });

  return {
    success: true,
    message: 'Đã xóa phản hồi thành công',
  };
});
