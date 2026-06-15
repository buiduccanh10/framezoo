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
          cause: error.errors,
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

      // Delete related records first
      await prisma.$transaction(async tx => {
        // Delete user bookmarks
        await tx.bookmarks.deleteMany({
          where: { user_id: userId },
        });

        await tx.progress_items.deleteMany({
          where: { user_id: userId },
        });

        await tx.user_settings
          .delete({
            where: { id: userId },
          })
          .catch(() => {});

        await tx.sessions.deleteMany({
          where: { user: userId },
        });

        await tx.users.delete({
          where: { id: userId },
        });
      });

      log.info('User account deleted successfully', { userId });

      return { success: true, message: 'User account deleted successfully' };
    } catch (error) {
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
