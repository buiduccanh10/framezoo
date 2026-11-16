import { createError, defineEventHandler, setHeader } from 'h3';

import { useAuth } from '~/utils/auth';
import { parseFeedbackAttachments } from '~/utils/feedback-storage';
import { decryptPiiOrNull } from '~/utils/piiCrypto';
import { prisma } from '~/utils/prisma';

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  if (!userId) {
    throw createError({ statusCode: 400, message: 'User ID is required' });
  }

  const session = await useAuth().getCurrentSession();
  if (session.user !== userId) {
    throw createError({ statusCode: 403, message: 'Cannot export another user data' });
  }

  const [
    user,
    settings,
    bookmarks,
    progressItems,
    watchHistory,
    groupOrder,
    credentials,
    sessions,
    feedbacks,
  ] = await Promise.all([
    prisma.users.findUnique({ where: { id: userId } }),
    prisma.user_settings.findUnique({ where: { id: userId } }),
    prisma.bookmarks.findMany({ where: { user_id: userId } }),
    prisma.progress_items.findMany({ where: { user_id: userId } }),
    prisma.watch_history.findMany({ where: { user_id: userId } }),
    prisma.user_group_order.findUnique({ where: { user_id: userId } }),
    prisma.user_provider_credentials.findMany({
      where: { user_id: userId },
      select: { provider: true, created_at: true, updated_at: true },
    }),
    prisma.sessions.findMany({
      where: { user: userId },
      select: {
        id: true,
        device: true,
        user_agent: true,
        app_version: true,
        created_at: true,
        accessed_at: true,
        expires_at: true,
      },
    }),
    prisma.feedbacks.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  if (!user) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="framezoo-personal-data-${encodeURIComponent(user.id)}.json"`
  );
  setHeader(event, 'Cache-Control', 'private, no-store');

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: '2026-11',
    account: {
      id: user.id,
      namespace: user.namespace,
      nickname: user.nickname,
      email: decryptPiiOrNull(user.email),
      emailVerifiedAt: user.email_verified_at,
      profile: user.profile,
      ratings: user.ratings,
      createdAt: user.created_at,
      lastLoggedIn: user.last_logged_in,
      appVersion: user.app_version,
      legalConsent: {
        termsVersion: user.terms_version,
        privacyVersion: user.privacy_version,
        consentedAt: user.consented_at,
        platform: user.consent_platform,
        ageConfirmed: user.age_confirmed,
      },
    },
    settings: settings || null,
    groupOrder: groupOrder?.group_order || [],
    bookmarks,
    progressItems: progressItems.map(item => ({
      ...item,
      duration: Number(item.duration),
      watched: Number(item.watched),
    })),
    watchHistory,
    configuredCredentialProviders: credentials,
    activeSessions: sessions,
    submittedReports: feedbacks.map(item => ({
      id: item.id,
      category: item.category,
      title: item.title,
      description: item.description,
      contact: decryptPiiOrNull(item.contact),
      targetUrlOrId: item.target_url_or_id,
      rightsOwnerName: item.rights_owner_name,
      swornStatement: item.sworn_statement,
      status: item.status,
      slaDueAt: item.sla_due_at,
      resolvedAt: item.resolved_at,
      createdAt: item.created_at,
      attachments: parseFeedbackAttachments(item.attachments).map(att => ({
        name: att.name,
        type: att.type,
        kind: att.kind,
        size: att.size,
      })),
    })),
  };
});
