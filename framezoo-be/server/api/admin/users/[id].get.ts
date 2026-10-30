import { defineEventHandler, createError } from 'h3';
import { prisma } from '~/utils/prisma';
import { requireAdmin } from '~/utils/admin';

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

  const [settings, sessionsList, bookmarksCount, progressCount, watchHistoryCount] =
    await Promise.all([
      prisma.user_settings.findUnique({
        where: { id: userId },
      }),
      prisma.sessions.findMany({
        where: { user: userId },
        orderBy: { accessed_at: 'desc' },
        select: {
          id: true,
          device: true,
          user_agent: true,
          created_at: true,
          accessed_at: true,
          expires_at: true,
        },
      }),
      prisma.bookmarks.count({ where: { user_id: userId } }),
      prisma.progress_items.count({ where: { user_id: userId } }),
      prisma.watch_history.count({ where: { user_id: userId } }),
    ]);

  const latestSessionAccessedAt = sessionsList[0]?.accessed_at;
  const lastActive =
    latestSessionAccessedAt &&
    (!user.last_logged_in || latestSessionAccessedAt > user.last_logged_in)
      ? latestSessionAccessedAt
      : user.last_logged_in;

  let userSettings = null;
  if (settings) {
    userSettings = {
      applicationTheme: settings.application_theme,
      applicationLanguage: settings.application_language,
      defaultSubtitleLanguage: settings.default_subtitle_language,
      enableAutoplay: settings.enable_autoplay,
      enableSkipCredits: settings.enable_skip_credits,
      proxyTmdb: settings.proxy_tmdb,
      addons: Array.isArray(settings.addons) ? settings.addons : [],
    };
  }

  return {
    user: {
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      created_at: user.created_at,
      last_logged_in: lastActive,
      permissions: user.permissions,
      profile: user.profile,
      public_key: user.public_key,
      namespace: user.namespace,
    },
    settings: userSettings,
    sessions: sessionsList,
    counts: {
      bookmarks: bookmarksCount,
      progress: progressCount,
      watchHistory: watchHistoryCount,
      sessions: sessionsList.length,
      addons: settings && Array.isArray(settings.addons) ? settings.addons.length : 0,
    },
  };
});
