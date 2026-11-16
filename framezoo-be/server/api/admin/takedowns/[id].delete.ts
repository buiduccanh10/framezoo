import { createError, defineEventHandler, getRouterParam } from 'h3';

import { requireAdmin } from '~/utils/admin';
import { prisma } from '~/utils/prisma';
import { invalidateTakedownCache } from '~/utils/takedown';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Rule ID is required' });
  }

  const existing = await prisma.takedown_rules.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Takedown rule not found' });
  }

  await prisma.takedown_rules.delete({ where: { id } });
  invalidateTakedownCache();

  return {
    success: true,
  };
});
