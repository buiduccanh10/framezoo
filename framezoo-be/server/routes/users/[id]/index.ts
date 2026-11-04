import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { scopedLogger } from '~/utils/logger';

const log = scopedLogger('user-profile');

const userProfileSchema = z.object({
  profile: z
    .object({
      icon: z.string(),
      colorA: z.string(),
      colorB: z.string(),
    })
    .optional(),
  nickname: z.string().min(1).max(255).optional(),
});

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;

  if (event.method === 'GET') {
    const session = await useAuth().getCurrentSession();
    if (session.user !== userId) {
      throw createError({
        statusCode: 403,
        message: 'Cannot read other users',
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

    return {
      id: user.id,
      namespace: user.namespace,
      nickname: (user as any).nickname,
      email: user.email,
      profile: user.profile,
    };
  }

  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot modify other users',
    });
  }

  if (event.method === 'PATCH') {
    try {
      const body = await readBody(event);
      log.info('Updating user profile', { userId, body });

      const validatedBody = userProfileSchema.parse(body);

      const updateData: any = {};
      if (validatedBody.profile) {
        updateData.profile = validatedBody.profile;
      }
      if (validatedBody.nickname !== undefined) {
        updateData.nickname = validatedBody.nickname;
      }

      const user = await prisma.users.update({
        where: { id: userId },
        data: updateData,
      });

      log.info('User profile updated successfully', { userId });

      return {
        id: user.id,
        publicKey: user.public_key,
        namespace: user.namespace,
        nickname: (user as any).nickname,
        email: user.email,
        profile: user.profile,
        permissions: user.permissions,
        createdAt: user.created_at,
        lastLoggedIn: user.last_logged_in,
      };
    } catch (error) {
      log.error('Failed to update user profile', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof z.ZodError) {
        throw createError({
          statusCode: 400,
          message: 'Invalid profile data',
          cause: error.issues,
        });
      }

      throw createError({
        statusCode: 500,
        message: 'Failed to update user profile',
        cause: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  if (event.method === 'DELETE') {
    try {
      log.info('Deleting user account', { userId });

      await prisma.$transaction(async tx => {
        const user = await tx.users.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        if (!user) {
          throw createError({ statusCode: 404, message: 'User not found' });
        }

        const otpWhere = {
          OR: [{ user_id: userId }, ...(user.email ? [{ email: user.email }] : [])],
        };
        const challenges = await tx.email_otp_challenges.findMany({
          where: otpWhere,
          select: { id: true },
        });
        if (challenges.length) {
          await tx.email_outbox.deleteMany({
            where: { challenge_id: { in: challenges.map(challenge => challenge.id) } },
          });
        }
        await tx.email_otp_challenges.deleteMany({ where: otpWhere });
        if (user.email) {
          await tx.otp_idempotency_keys.deleteMany({
            where: { scope: { contains: `:${user.email}:` } },
          });
        }

        await tx.bookmarks.deleteMany({
          where: { user_id: userId },
        });

        await tx.progress_items.deleteMany({
          where: { user_id: userId },
        });
        await tx.watch_history.deleteMany({ where: { user_id: userId } });
        await tx.user_group_order.deleteMany({ where: { user_id: userId } });
        await tx.user_settings.deleteMany({ where: { id: userId } });
        await tx.user_provider_credentials.deleteMany({
          where: { user_id: userId },
        });

        await tx.sessions.deleteMany({
          where: { user: userId },
        });

        // Reports can contain evidence needed for support or copyright claims.
        // Remove the account link; users can request report deletion separately.
        await tx.feedbacks.updateMany({
          where: { user_id: userId },
          data: { user_id: null },
        });

        await tx.users.delete({
          where: { id: userId },
        });
      });

      log.info('User account deleted successfully', { userId });

      return { success: true, message: 'User account deleted successfully' };
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) {
        throw error;
      }
      log.error('Failed to delete user account', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw createError({
        statusCode: 500,
        message: 'Failed to delete user account',
        cause: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
