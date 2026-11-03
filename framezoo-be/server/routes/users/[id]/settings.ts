import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { scopedLogger } from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const log = scopedLogger('user-settings');

const userSettingsSchema = z.object({
  applicationTheme: z.string().nullable().optional(),
  customTheme: z
    .object({
      primary: z.string(),
      secondary: z.string(),
      tertiary: z.string(),
    })
    .nullable()
    .optional(),
  applicationLanguage: z.string().optional().default('en'),
  defaultSubtitleLanguage: z.string().nullable().optional(),
  enableAutoplay: z.boolean().optional().default(true),
  enableSkipCredits: z.boolean().optional().default(false),
  proxyTmdb: z.boolean().optional().default(false),
  addons: z.array(z.any()).optional().default([]),
  nativeSubtitlesEnabled: z.boolean().optional().default(true),
});

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;

  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Permission denied',
    });
  }

  // First check if user exists
  const user = await prisma.users.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  if (event.method === 'GET') {
    try {
      const settings = await prisma.user_settings.findUnique({
        where: { id: userId },
      });

      return {
        id: userId,
        applicationTheme: settings?.application_theme || null,
        customTheme: settings?.custom_theme || null,
        applicationLanguage: settings?.application_language || 'en',
        defaultSubtitleLanguage: settings?.default_subtitle_language || null,
        enableAutoplay: settings?.enable_autoplay ?? true,
        enableSkipCredits: settings?.enable_skip_credits ?? false,
        proxyTmdb: settings?.proxy_tmdb ?? false,
        addons: (settings?.addons as any[]) || [],
        nativeSubtitlesEnabled: settings?.native_subtitles_enabled ?? true,
      };
    } catch (error) {
      log.error('Failed to get user settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw createError({
        statusCode: 500,
        message: 'Failed to get user settings',
      });
    }
  }

  if (event.method === 'PUT') {
    try {
      const body = await readBody(event);
      log.info('Updating user settings', {
        userId,
        fields: body && typeof body === 'object' ? Object.keys(body) : [],
      });

      const validatedBody = userSettingsSchema.parse(body);

      const createData = {
        application_theme: validatedBody.applicationTheme ?? null,
        custom_theme: validatedBody.customTheme ?? null,
        application_language: validatedBody.applicationLanguage,
        default_subtitle_language: validatedBody.defaultSubtitleLanguage ?? null,
        enable_autoplay: validatedBody.enableAutoplay,
        enable_skip_credits: validatedBody.enableSkipCredits,
        proxy_tmdb: validatedBody.proxyTmdb,
        addons: validatedBody.addons || [],
        native_subtitles_enabled: validatedBody.nativeSubtitlesEnabled,
      };

      const updateData: Partial<typeof createData> = {};
      if (Object.prototype.hasOwnProperty.call(body, 'applicationTheme'))
        updateData.application_theme = createData.application_theme;
      if (Object.prototype.hasOwnProperty.call(body, 'customTheme'))
        updateData.custom_theme = createData.custom_theme;
      if (Object.prototype.hasOwnProperty.call(body, 'applicationLanguage'))
        updateData.application_language = createData.application_language;
      if (Object.prototype.hasOwnProperty.call(body, 'defaultSubtitleLanguage'))
        updateData.default_subtitle_language = createData.default_subtitle_language;
      if (Object.prototype.hasOwnProperty.call(body, 'enableAutoplay'))
        updateData.enable_autoplay = createData.enable_autoplay;
      if (Object.prototype.hasOwnProperty.call(body, 'enableSkipCredits'))
        updateData.enable_skip_credits = createData.enable_skip_credits;
      if (Object.prototype.hasOwnProperty.call(body, 'proxyTmdb'))
        updateData.proxy_tmdb = createData.proxy_tmdb;
      if (Object.prototype.hasOwnProperty.call(body, 'addons'))
        updateData.addons = createData.addons;
      if (Object.prototype.hasOwnProperty.call(body, 'nativeSubtitlesEnabled'))
        updateData.native_subtitles_enabled = createData.native_subtitles_enabled;

      log.info('Preparing to upsert settings', {
        userId,
        updatedFields: Object.keys(updateData),
      });

      const settings = await prisma.user_settings.upsert({
        where: { id: userId },
        update: updateData,
        create: {
          id: userId,
          ...createData,
        },
      });

      log.info('Settings updated successfully', { userId });

      return {
        id: userId,
        applicationTheme: settings.application_theme,
        customTheme: settings.custom_theme,
        applicationLanguage: settings.application_language,
        defaultSubtitleLanguage: settings.default_subtitle_language,
        enableAutoplay: settings.enable_autoplay,
        enableSkipCredits: settings.enable_skip_credits,
        proxyTmdb: settings.proxy_tmdb,
        addons: (settings.addons as any[]) || [],
        nativeSubtitlesEnabled: settings.native_subtitles_enabled,
      };
    } catch (error) {
      log.error('Failed to update user settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof z.ZodError) {
        throw createError({
          statusCode: 400,
          message: 'Invalid settings data',
          cause: error.issues,
        });
      }

      throw createError({
        statusCode: 500,
        message: 'Failed to update settings',
        cause: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
