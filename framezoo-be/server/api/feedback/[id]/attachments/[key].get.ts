import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { requireAdmin } from '~/utils/admin';
import { prisma } from '~/utils/prisma';
import { downloadFeedbackAttachment, parseFeedbackAttachments } from '~/utils/feedback-storage';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const id = getRouterParam(event, 'id');
  const key = getRouterParam(event, 'key');
  if (!id || !key) throw createError({ statusCode: 400, message: 'Attachment is required' });

  const feedback = await prisma.feedbacks.findUnique({
    where: { id },
    select: { attachments: true },
  });
  const attachment = parseFeedbackAttachments(feedback?.attachments).find(item => item.key === key);
  if (!attachment) throw createError({ statusCode: 404, message: 'Attachment not found' });

  let buffer: Buffer;
  try {
    buffer = await downloadFeedbackAttachment(attachment);
  } catch {
    throw createError({ statusCode: 404, message: 'Attachment not found' });
  }

  setResponseHeader(event, 'Content-Type', attachment.type);
  setResponseHeader(event, 'Content-Length', buffer.length);
  setResponseHeader(
    event,
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(attachment.name)}"`
  );
  setResponseHeader(event, 'Cache-Control', 'private, no-store');
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  return buffer;
});
