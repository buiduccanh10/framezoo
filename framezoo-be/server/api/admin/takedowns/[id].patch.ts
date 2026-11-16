import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';

import { requireAdmin } from '~/utils/admin';
import { prisma } from '~/utils/prisma';
import { invalidateTakedownCache } from '~/utils/takedown';

const updateRuleSchema = z.object({
  active: z.boolean().optional(),
  reason: z.string().trim().min(1).max(2000).optional(),
  rightsHolder: z.string().trim().max(255).nullable().optional(),
  referenceId: z.string().trim().max(255).nullable().optional(),
});

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

  const body = await readBody(event);
  const parsed = updateRuleSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid update payload' });
  }

  const rule = await prisma.takedown_rules.update({
    where: { id },
    data: {
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
      ...(parsed.data.rightsHolder !== undefined
        ? { rights_holder: parsed.data.rightsHolder }
        : {}),
      ...(parsed.data.referenceId !== undefined
        ? { reference_id: parsed.data.referenceId }
        : {}),
    },
  });

  invalidateTakedownCache();

  return {
    success: true,
    rule,
  };
});
