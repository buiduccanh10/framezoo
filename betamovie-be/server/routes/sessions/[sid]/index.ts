import { useAuth } from '~/utils/auth';
import { z } from 'zod';

const updateSessionSchema = z.object({
  deviceName: z.string().max(500).min(1).optional(),
});

export default defineEventHandler(async event => {
  const sessionId = getRouterParam(event, 'sid');
  const auth = useAuth();

  const currentSession = await auth.getCurrentSession();

  const targetedSession = await prisma.sessions.findUnique({
    where: { id: sessionId },
  });

  if (!targetedSession) {
    if (event.method === 'DELETE') {
      return { id: sessionId };
    }

    throw createError({
      statusCode: 404,
      message: 'Session cannot be found',
    });
  }

  if (targetedSession.user !== currentSession.user) {
    throw createError({
      statusCode: 401,
      message:
        event.method === 'DELETE'
          ? 'Cannot delete sessions you do not own'
          : 'Cannot edit sessions other than your own',
    });
  }

  if (event.method === 'PATCH') {
    const body = await readBody(event);
    const validatedBody = updateSessionSchema.parse(body);

    if (validatedBody.deviceName) {
      await prisma.sessions.update({
        where: { id: sessionId },
        data: {
          device: validatedBody.deviceName,
        },
      });
    }

    const updatedSession = await prisma.sessions.findUnique({
      where: { id: sessionId },
    });

    return {
      id: updatedSession.id,
      user: updatedSession.user,
      createdAt: updatedSession.created_at,
      accessedAt: updatedSession.accessed_at,
      expiresAt: updatedSession.expires_at,
      device: updatedSession.device,
      userAgent: updatedSession.user_agent,
      current: updatedSession.id === currentSession.id,
    };
  }

  if (event.method === 'DELETE') {
    const sid = event.context.params?.sid;
    const sessionExists = await prisma.sessions.findUnique({
      where: { id: sid },
    });

    if (!sessionExists) {
      return { success: true };
    }
    await auth.getSessionAndBump(sid);

    await prisma.sessions.delete({
      where: { id: sessionId },
    });

    if (currentSession.id === sessionId) {
      auth.clearSessionCookie(event);
    }

    return { id: sessionId };
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
