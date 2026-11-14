import {
  defineEventHandler,
  readBody,
  createError,
  getHeader,
  getCookie,
  readMultipartFormData,
} from 'h3';
import { randomUUID } from 'crypto';
import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';
import { touchGuestActivityFromEvent } from '~/utils/guestTracking';
import { encryptPii, hashContactIndex } from '~/utils/piiCrypto';
import {
  MAX_FEEDBACK_FILE_BYTES,
  FeedbackMalwareError,
  FeedbackScannerUnavailableError,
  isValidFeedbackContact,
  normalizeFeedbackContact,
  removeFeedbackAttachments,
  uploadFeedbackAttachments,
  validateFeedbackFileParts,
} from '~/utils/feedback-storage';

export default defineEventHandler(async event => {
  const contentType = getHeader(event, 'content-type') || '';
  const contentLength = Number(getHeader(event, 'content-length') || 0);
  if (contentLength > MAX_FEEDBACK_FILE_BYTES + 1024 * 1024) {
    throw createError({
      statusCode: 413,
      message: 'Tổng dung lượng files không được vượt quá 55 MB',
    });
  }

  let title: string | undefined;
  let description: string | undefined;
  let contact: string | null;
  let fileParts: { filename?: string; type?: string; data: Uint8Array }[] = [];

  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const parts = await readMultipartFormData(event);
    const titlePart = parts?.find(part => part.name === 'title' && !part.filename);
    const descriptionPart = parts?.find(part => part.name === 'description' && !part.filename);
    const contactPart = parts?.find(part => part.name === 'contact' && !part.filename);
    title = titlePart ? Buffer.from(titlePart.data).toString('utf8').trim() : undefined;
    description = descriptionPart
      ? Buffer.from(descriptionPart.data).toString('utf8').trim()
      : undefined;
    contact = normalizeFeedbackContact(
      contactPart ? Buffer.from(contactPart.data).toString('utf8') : undefined
    );
    fileParts = (parts || [])
      .filter(
        part =>
          (part.name === 'files' || part.name === 'attachments' || part.name === 'images') &&
          Boolean(part.filename)
      )
      .map(part => ({ filename: part.filename, type: part.type, data: part.data }));
    try {
      validateFeedbackFileParts(fileParts);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File không hợp lệ';
      throw createError({ statusCode: message.includes('vượt quá') ? 413 : 400, message });
    }
  } else {
    const body = await readBody<{ title?: string; description?: string; contact?: string }>(event);
    title = body?.title?.trim();
    description = body?.description?.trim();
    contact = normalizeFeedbackContact(body?.contact);
  }

  if (!title || !description) {
    throw createError({
      statusCode: 400,
      message: 'Tiêu đề và nội dung mô tả vấn đề là bắt buộc',
    });
  }

  if (title.length > 255) {
    throw createError({
      statusCode: 400,
      message: 'Tiêu đề không được vượt quá 255 ký tự',
    });
  }

  // Attempt to resolve logged-in user if token is present
  let userId: string | null = null;
  const auth = useAuth();

  try {
    const authHeader = getHeader(event, 'authorization');
    const cookieToken = getCookie(event, auth.sessionCookieName);
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : cookieToken || null;

    if (token) {
      const payload = auth.verifyAccessToken(token);
      if (payload?.sid) {
        const session = await auth.getSession(payload.sid);
        if (session?.user) {
          const user = await prisma.users.findUnique({
            where: { id: session.user },
            select: { id: true },
          });
          if (user) {
            userId = user.id;
          }
        }
      } else {
        const guestPayload = auth.verifyGuestToken(token);
        if (guestPayload) {
          void touchGuestActivityFromEvent(event, guestPayload.gid);
        }
      }
    }
  } catch (err) {
    // Non-blocking: continue as guest if resolving user fails
    console.warn('[feedback] could not resolve user session:', err);
  }

  // Guest submissions must include a valid email or phone contact so support can reply.
  if (!userId && !contact) {
    throw createError({
      statusCode: 400,
      message: 'Vui lòng nhập email hoặc số điện thoại để chúng tôi phản hồi',
    });
  }

  if (contact && !isValidFeedbackContact(contact)) {
    throw createError({
      statusCode: 400,
      message: 'Thông tin liên hệ phải là email hoặc số điện thoại hợp lệ',
    });
  }

  const feedbackId = randomUUID();
  let attachments;
  try {
    attachments = await uploadFeedbackAttachments(feedbackId, fileParts);
  } catch (error) {
    if (error instanceof FeedbackMalwareError) {
      throw createError({ statusCode: 400, message: error.message });
    }
    if (error instanceof FeedbackScannerUnavailableError) {
      throw createError({
        statusCode: 503,
        message: 'Không thể kiểm tra an toàn file, vui lòng thử lại sau',
      });
    }
    console.error('[feedback] attachment upload failed:', error);
    throw createError({
      statusCode: 503,
      message: 'Không thể lưu file đính kèm, vui lòng thử lại sau',
    });
  }

  try {
    const feedback = await prisma.feedbacks.create({
      data: {
        id: feedbackId,
        title,
        description,
        contact: contact ? encryptPii(contact) : null,
        contact_hash: contact ? hashContactIndex(contact) : null,
        status: 'pending',
        user_id: userId,
        attachments,
      },
    });

    return {
      success: true,
      feedback: {
        ...feedback,
        contact,
        attachments: attachments.map(attachment => ({
          key: attachment.key,
          name: attachment.name,
          type: attachment.type,
          kind: attachment.kind,
          size: attachment.size,
        })),
      },
    };
  } catch (error) {
    if (attachments.length > 0) {
      try {
        await removeFeedbackAttachments(attachments);
      } catch (cleanupError) {
        console.error('[feedback] attachment cleanup failed:', cleanupError);
      }
    }
    throw error;
  }
});
