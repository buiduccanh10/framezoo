import { defineEventHandler, createError } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';
import { summarizeClientPlatform } from '~/utils/guestUtils';
import { decryptPiiOrNull } from '~/utils/piiCrypto';

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
    select: {
      id: true,
      nickname: true,
      email: true,
      created_at: true,
      last_logged_in: true,
      permissions: true,
      profile: true,
      namespace: true,
      app_version: true,
    },
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  const [settings, sessionsList] = await Promise.all([
    prisma.user_settings.findUnique({
      where: { id: userId },
      select: {
        application_theme: true,
        application_language: true,
        default_subtitle_language: true,
        enable_autoplay: true,
        enable_skip_credits: true,
      },
    }),
    prisma.sessions.findMany({
      where: { user: userId },
      orderBy: { accessed_at: 'desc' },
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
  ]);

  const now = new Date();
  const activeSessions = sessionsList.filter(s => s.expires_at > now);

  const latestSessionAccessedAt = sessionsList[0]?.accessed_at;
  const lastActive =
    latestSessionAccessedAt &&
    (!user.last_logged_in || latestSessionAccessedAt > user.last_logged_in)
      ? latestSessionAccessedAt
      : user.last_logged_in;

  const userSettings = settings
    ? {
        applicationTheme: settings.application_theme,
        applicationLanguage: settings.application_language,
        defaultSubtitleLanguage: settings.default_subtitle_language,
        enableAutoplay: settings.enable_autoplay,
        enableSkipCredits: settings.enable_skip_credits,
      }
    : null;

  const currentVersion =
    sessionsList.find(s => s.app_version)?.app_version || user.app_version || null;

  return {
    user: {
      id: user.id,
      nickname: user.nickname,
      email: decryptPiiOrNull(user.email),
      created_at: user.created_at,
      last_logged_in: lastActive,
      permissions: user.permissions,
      profile: user.profile,
      namespace: user.namespace,
      app_version: currentVersion,
    },
    settings: userSettings,
    sessions: activeSessions.map(s => ({
      id: s.id,
      device: s.device,
      platform: summarizeClientPlatform(s.user_agent),
      app_version: s.app_version,
      created_at: s.created_at,
      accessed_at: s.accessed_at,
      expires_at: s.expires_at,
    })),
    counts: {
      sessions: activeSessions.length,
    },
  };
});
