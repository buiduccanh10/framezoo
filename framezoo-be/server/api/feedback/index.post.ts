import { defineEventHandler, readBody, createError, getHeader, getCookie } from 'h3';
import { randomUUID } from 'crypto';
import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';

export default defineEventHandler(async event => {
  const body = await readBody<{ title?: string; description?: string }>(event);

  const title = body?.title?.trim();
  const description = body?.description?.trim();

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
      }
    }
  } catch (err) {
    // Non-blocking: continue as guest if resolving user fails
    console.warn('[feedback] could not resolve user session:', err);
  }

  const feedback = await prisma.feedbacks.create({
    data: {
      id: randomUUID(),
      title,
      description,
      status: 'pending',
      user_id: userId,
    },
  });

  return {
    success: true,
    feedback,
  };
});
