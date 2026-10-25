import { defineEventHandler, createError, readBody } from 'h3';
import { z } from 'zod';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';

const updateSchema = z.object({
  nickname: z.string().min(1, 'Nickname cannot be empty').max(50, 'Nickname too long').optional(),
  email: z.string().email('Invalid email address').nullable().optional().or(z.literal('')),
});

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const userId = event.context.params?.id;
  if (!userId) {
    throw createError({
      statusCode: 400,
      message: 'User ID is required',
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

  const rawBody = await readBody(event);
  const validated = updateSchema.parse(rawBody);

  const updateData: any = {};

  if (validated.nickname !== undefined && validated.nickname !== user.nickname) {
    // Check if new nickname is already taken by another user
    const existing = await prisma.users.findFirst({
      where: {
        nickname: { equals: validated.nickname, mode: 'insensitive' },
        id: { not: userId },
      },
    });
    if (existing) {
      throw createError({
        statusCode: 400,
        message: 'Nickname already in use by another user',
      });
    }
    updateData.nickname = validated.nickname;
  }

  if (validated.email !== undefined) {
    const newEmail = validated.email === '' ? null : validated.email;
    if (newEmail !== user.email) {
      if (newEmail) {
        // Check if new email is already taken by another user
        const existingEmail = await prisma.users.findFirst({
          where: {
            email: { equals: newEmail, mode: 'insensitive' },
            id: { not: userId },
          },
        });
        if (existingEmail) {
          throw createError({
            statusCode: 400,
            message: 'Email already in use by another user',
          });
        }
      }
      updateData.email = newEmail;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return {
      user: {
        id: user.id,
        nickname: user.nickname,
        email: user.email,
        created_at: user.created_at,
        last_logged_in: user.last_logged_in,
        permissions: user.permissions,
        profile: user.profile,
      },
    };
  }

  const updatedUser = await prisma.users.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      nickname: true,
      email: true,
      created_at: true,
      last_logged_in: true,
      permissions: true,
      profile: true,
    },
  });

  return { user: updatedUser };
});
