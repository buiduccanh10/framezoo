import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';

import { requireAdmin } from '~/utils/admin';
import { TAKEDOWN_TARGET_TYPES } from '~/utils/legalConstants';
import { prisma } from '~/utils/prisma';
import { invalidateTakedownCache, normalizeTakedownPattern } from '~/utils/takedown';

const createRuleSchema = z.object({
  targetType: z.enum(TAKEDOWN_TARGET_TYPES),
  pattern: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(2000),
  rightsHolder: z.string().trim().max(255).nullable().optional(),
  referenceId: z.string().trim().max(255).nullable().optional(),
  active: z.boolean().optional().default(true),
});

export default defineEventHandler(async event => {
  const admin = await requireAdmin(event);
  const body = await readBody(event);
  const parsed = createRuleSchema.safeParse(body);

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: 'Dữ liệu takedown rule không hợp lệ',
      cause: parsed.error.issues,
    });
  }

  const normalizedPattern = normalizeTakedownPattern(parsed.data.targetType, parsed.data.pattern);
  if (!normalizedPattern) {
    throw createError({
      statusCode: 400,
      message: 'Mẫu chặn (pattern) không hợp lệ',
    });
  }

  const rule = await prisma.takedown_rules.create({
    data: {
      target_type: parsed.data.targetType,
      pattern: normalizedPattern,
      reason: parsed.data.reason,
      rights_holder: parsed.data.rightsHolder || null,
      reference_id: parsed.data.referenceId || null,
      active: parsed.data.active,
      created_by: admin.username,
    },
  });

  invalidateTakedownCache();

  return {
    success: true,
    rule,
  };
});
