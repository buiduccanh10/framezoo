import { defineEventHandler, getQuery } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';
import { parseFeedbackAttachments } from '~/utils/feedback-storage';
import { FEEDBACK_CATEGORIES } from '~/utils/legalConstants';
import { decryptPiiOrNull, hashContactIndex, hashEmailIndex } from '~/utils/piiCrypto';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const query = getQuery(event);
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 120) : '';
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '10'), 10) || 10));
  const status =
    query.status === 'pending' || query.status === 'resolved' ? query.status : undefined;
  const rawCategory = typeof query.category === 'string' ? query.category.trim().toLowerCase() : '';
  const category = (FEEDBACK_CATEGORIES as readonly string[]).includes(rawCategory)
    ? rawCategory
    : undefined;
  const matchingUsers = search
    ? await prisma.users.findMany({
        where: {
          OR: [
            { nickname: { contains: search, mode: 'insensitive' } },
            { email_hash: hashEmailIndex(search) },
            { id: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 1000,
      })
    : [];
  const where: any = {};
  if (status) where.status = status;
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { contact_hash: hashContactIndex(search) },
      ...(matchingUsers.length ? [{ user_id: { in: matchingUsers.map(user => user.id) } }] : []),
    ];
  }
  const statsWhere = search && where.OR ? { OR: where.OR } : {};
  const now = new Date();

  const [total, pending, resolved, pendingCopyright, pendingPrivacy, overdueCompliance, feedbacks] =
    await Promise.all([
      prisma.feedbacks.count({ where }),
      prisma.feedbacks.count({ where: { ...statsWhere, status: 'pending' } }),
      prisma.feedbacks.count({ where: { ...statsWhere, status: 'resolved' } }),
      prisma.feedbacks.count({ where: { ...statsWhere, status: 'pending', category: 'copyright' } }),
      prisma.feedbacks.count({ where: { ...statsWhere, status: 'pending', category: 'privacy' } }),
      prisma.feedbacks.count({
        where: { ...statsWhere, status: 'pending', sla_due_at: { lt: now } },
      }),
      prisma.feedbacks.findMany({
        where,
        orderBy: [{ sla_due_at: 'asc' }, { created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

  const userIds = [
    ...new Set(
      feedbacks
        .map(f => f.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];

  let userMap = new Map<string, { id: string; nickname: string; email: string | null }>();

  if (userIds.length > 0) {
    const users = await prisma.users.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        nickname: true,
        email: true,
      },
    });
    userMap = new Map(
      users.map(u => [u.id, { id: u.id, nickname: u.nickname, email: decryptPiiOrNull(u.email) }])
    );
  }

  const items = feedbacks.map(f => {
    const user = f.user_id ? userMap.get(f.user_id) || null : null;
    return {
      id: f.id,
      title: f.title,
      description: f.description,
      contact: decryptPiiOrNull(f.contact),
      status: f.status,
      category: f.category,
      target_url_or_id: f.target_url_or_id,
      rights_owner_name: f.rights_owner_name,
      sworn_statement: f.sworn_statement,
      sla_due_at: f.sla_due_at,
      resolved_at: f.resolved_at,
      user_id: f.user_id,
      user: user
        ? {
            id: user.id,
            nickname: user.nickname,
            email: user.email,
          }
        : null,
      attachments: parseFeedbackAttachments(f.attachments).map(attachment => ({
        key: attachment.key,
        name: attachment.name,
        type: attachment.type,
        kind: attachment.kind,
        size: attachment.size,
        url: `/api/feedback/${encodeURIComponent(f.id)}/attachments/${encodeURIComponent(attachment.key)}`,
      })),
      created_at: f.created_at,
      updated_at: f.updated_at,
    };
  });

  return {
    success: true,
    feedbacks: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    stats: {
      total,
      pending,
      resolved,
      pendingCopyright,
      pendingPrivacy,
      overdueCompliance,
    },
  };
});
