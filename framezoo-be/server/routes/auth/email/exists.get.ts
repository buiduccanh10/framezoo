import { z } from 'zod';
import { normalizeEmail } from '~/utils/accountIdentifier';
import { prisma } from '~/utils/prisma';

const querySchema = z.object({
  email: z.string().trim().email().max(255),
});

export default defineEventHandler(async event => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: 'Valid email is required',
    });
  }

  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.users.findUnique({
    where: { email },
    select: { id: true },
  });

  return {
    exists: !!user,
  };
});
