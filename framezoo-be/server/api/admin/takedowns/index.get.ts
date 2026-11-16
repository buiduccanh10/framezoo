import { defineEventHandler, getQuery } from 'h3';

import { requireAdmin } from '~/utils/admin';
import { TAKEDOWN_TARGET_TYPES } from '~/utils/legalConstants';
import { prisma } from '~/utils/prisma';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const query = getQuery(event);
  const rawType = typeof query.targetType === 'string' ? query.targetType.trim() : '';
  const targetType = (TAKEDOWN_TARGET_TYPES as readonly string[]).includes(rawType)
    ? rawType
    : undefined;
  const active =
    query.active === 'true' ? true : query.active === 'false' ? false : undefined;
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 120) : '';

  const where: Record<string, unknown> = {};
  if (targetType) where.target_type = targetType;
  if (active !== undefined) where.active = active;
  if (search) {
    where.OR = [
      { pattern: { contains: search, mode: 'insensitive' } },
      { reason: { contains: search, mode: 'insensitive' } },
      { rights_holder: { contains: search, mode: 'insensitive' } },
      { reference_id: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [rules, totalActive] = await Promise.all([
    prisma.takedown_rules.findMany({
      where,
      orderBy: [{ active: 'desc' }, { created_at: 'desc' }],
      take: 200,
    }),
    prisma.takedown_rules.count({ where: { active: true } }),
  ]);

  return {
    success: true,
    rules,
    stats: {
      total: rules.length,
      active: totalActive,
    },
  };
});
