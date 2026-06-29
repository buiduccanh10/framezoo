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
  proxyUrls: z.array(z.string()).nullable().optional(),
  febboxKey: z.string().nullable().optional(),
  debridToken: z.string().nullable().optional(),
  debridService: z.string().nullable().optional(),
  tidbKey: z.string().nullable().optional(),
  enableAutoplay: z.boolean().optional().default(true),
  enableSkipCredits: z.boolean().optional().default(true),
  enableDiscover: z.boolean().optional().default(true),
  enableFeatured: z.boolean().optional().default(false),
  enableDetailsModal: z.boolean().optional().default(false),
  enableImageLogos: z.boolean().optional().default(true),
  enableCarouselView: z.boolean().optional().default(false),
  forceCompactEpisodeView: z.boolean().optional().default(false),
  sourceOrder: z.array(z.string()).optional().default([]),
  enableSourceOrder: z.boolean().optional().default(false),
  disabledSources: z.array(z.string()).optional().default([]),
  embedOrder: z.array(z.string()).optional().default([]),
  enableEmbedOrder: z.boolean().optional().default(false),
  disabledEmbeds: z.array(z.string()).optional().default([]),
  proxyTmdb: z.boolean().optional().default(false),
  enableLowPerformanceMode: z.boolean().optional().default(false),
  enableHoldToBoost: z.boolean().optional().default(false),
  homeSectionOrder: z.array(z.string()).optional().default([]),
  manualSourceSelection: z.boolean().optional().default(false),
  enableDoubleClickToSeek: z.boolean().optional().default(false),
  enableAutoResumeOnPlaybackError: z.boolean().optional().default(false),
  enablePauseOverlay: z.boolean().optional().default(false),
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
        proxyUrls: settings?.proxy_urls.length === 0 ? null : settings?.proxy_urls || null,
        febboxKey: settings?.febbox_key || null,
        debridToken: settings?.debrid_token || null,
        debridService: settings?.debrid_service || null,
        tidbKey: settings?.tidb_key || null,
        enableAutoplay: settings?.enable_autoplay ?? true,
        enableSkipCredits: settings?.enable_skip_credits ?? true,
        enableDiscover: settings?.enable_discover ?? true,
        enableFeatured: settings?.enable_featured ?? false,
        enableDetailsModal: settings?.enable_details_modal ?? false,
        enableImageLogos: settings?.enable_image_logos ?? true,
        enableCarouselView: settings?.enable_carousel_view ?? false,
        forceCompactEpisodeView: settings?.force_compact_episode_view ?? false,
        sourceOrder: settings?.source_order || [],
        enableSourceOrder: settings?.enable_source_order ?? false,
        disabledSources: settings?.disabled_sources || [],
        embedOrder: settings?.embed_order || [],
        enableEmbedOrder: settings?.enable_embed_order ?? false,
        disabledEmbeds: settings?.disabled_embeds || [],
        proxyTmdb: settings?.proxy_tmdb ?? false,
        enableLowPerformanceMode: settings?.enable_low_performance_mode ?? false,
        enableHoldToBoost: settings?.enable_hold_to_boost ?? false,
        homeSectionOrder: settings?.home_section_order || [],
        manualSourceSelection: settings?.manual_source_selection ?? false,
        enableDoubleClickToSeek: settings?.enable_double_click_to_seek ?? false,
        enableAutoResumeOnPlaybackError: settings?.enable_auto_resume_on_playback_error ?? false,
        enablePauseOverlay: settings?.enable_pause_overlay ?? false,
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
      log.info('Updating user settings', { userId, body });

      const validatedBody = userSettingsSchema.parse(body);

      const createData = {
        application_theme: validatedBody.applicationTheme ?? null,
        custom_theme: validatedBody.customTheme ?? null,
        application_language: validatedBody.applicationLanguage,
        default_subtitle_language: validatedBody.defaultSubtitleLanguage ?? null,
        proxy_urls: validatedBody.proxyUrls === null ? [] : validatedBody.proxyUrls || [],
        febbox_key: validatedBody.febboxKey ?? null,
        debrid_token: validatedBody.debridToken ?? null,
        debrid_service: validatedBody.debridService ?? null,
        tidb_key: validatedBody.tidbKey ?? null,
        enable_autoplay: validatedBody.enableAutoplay,
        enable_skip_credits: validatedBody.enableSkipCredits,
        enable_discover: validatedBody.enableDiscover,
        enable_featured: validatedBody.enableFeatured,
        enable_details_modal: validatedBody.enableDetailsModal,
        enable_image_logos: validatedBody.enableImageLogos,
        enable_carousel_view: validatedBody.enableCarouselView,
        force_compact_episode_view: validatedBody.forceCompactEpisodeView,
        source_order: validatedBody.sourceOrder || [],
        enable_source_order: validatedBody.enableSourceOrder,
        disabled_sources: validatedBody.disabledSources || [],
        embed_order: validatedBody.embedOrder || [],
        enable_embed_order: validatedBody.enableEmbedOrder,
        disabled_embeds: validatedBody.disabledEmbeds || [],
        proxy_tmdb: validatedBody.proxyTmdb,
        enable_low_performance_mode: validatedBody.enableLowPerformanceMode,
        enable_hold_to_boost: validatedBody.enableHoldToBoost,
        home_section_order: validatedBody.homeSectionOrder || [],
        manual_source_selection: validatedBody.manualSourceSelection,
        enable_double_click_to_seek: validatedBody.enableDoubleClickToSeek,
        enable_auto_resume_on_playback_error: validatedBody.enableAutoResumeOnPlaybackError,
        enable_pause_overlay: validatedBody.enablePauseOverlay,
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
      if (Object.prototype.hasOwnProperty.call(body, 'proxyUrls'))
        updateData.proxy_urls = createData.proxy_urls;
      if (Object.prototype.hasOwnProperty.call(body, 'febboxKey'))
        updateData.febbox_key = createData.febbox_key;
      if (Object.prototype.hasOwnProperty.call(body, 'debridToken'))
        updateData.debrid_token = createData.debrid_token;
      if (Object.prototype.hasOwnProperty.call(body, 'debridService'))
        updateData.debrid_service = createData.debrid_service;
      if (Object.prototype.hasOwnProperty.call(body, 'tidbKey'))
        updateData.tidb_key = createData.tidb_key;
      if (Object.prototype.hasOwnProperty.call(body, 'enableAutoplay'))
        updateData.enable_autoplay = createData.enable_autoplay;
      if (Object.prototype.hasOwnProperty.call(body, 'enableSkipCredits'))
        updateData.enable_skip_credits = createData.enable_skip_credits;
      if (Object.prototype.hasOwnProperty.call(body, 'enableDiscover'))
        updateData.enable_discover = createData.enable_discover;
      if (Object.prototype.hasOwnProperty.call(body, 'enableFeatured'))
        updateData.enable_featured = createData.enable_featured;
      if (Object.prototype.hasOwnProperty.call(body, 'enableDetailsModal'))
        updateData.enable_details_modal = createData.enable_details_modal;
      if (Object.prototype.hasOwnProperty.call(body, 'enableImageLogos'))
        updateData.enable_image_logos = createData.enable_image_logos;
      if (Object.prototype.hasOwnProperty.call(body, 'enableCarouselView'))
        updateData.enable_carousel_view = createData.enable_carousel_view;
      if (Object.prototype.hasOwnProperty.call(body, 'forceCompactEpisodeView'))
        updateData.force_compact_episode_view = createData.force_compact_episode_view;
      if (Object.prototype.hasOwnProperty.call(body, 'sourceOrder'))
        updateData.source_order = createData.source_order;
      if (Object.prototype.hasOwnProperty.call(body, 'enableSourceOrder'))
        updateData.enable_source_order = createData.enable_source_order;
      if (Object.prototype.hasOwnProperty.call(body, 'disabledSources'))
        updateData.disabled_sources = createData.disabled_sources;
      if (Object.prototype.hasOwnProperty.call(body, 'embedOrder'))
        updateData.embed_order = createData.embed_order;
      if (Object.prototype.hasOwnProperty.call(body, 'enableEmbedOrder'))
        updateData.enable_embed_order = createData.enable_embed_order;
      if (Object.prototype.hasOwnProperty.call(body, 'disabledEmbeds'))
        updateData.disabled_embeds = createData.disabled_embeds;
      if (Object.prototype.hasOwnProperty.call(body, 'proxyTmdb'))
        updateData.proxy_tmdb = createData.proxy_tmdb;
      if (Object.prototype.hasOwnProperty.call(body, 'enableLowPerformanceMode'))
        updateData.enable_low_performance_mode = createData.enable_low_performance_mode;
      if (Object.prototype.hasOwnProperty.call(body, 'enableHoldToBoost'))
        updateData.enable_hold_to_boost = createData.enable_hold_to_boost;
      if (Object.prototype.hasOwnProperty.call(body, 'homeSectionOrder'))
        updateData.home_section_order = createData.home_section_order;
      if (Object.prototype.hasOwnProperty.call(body, 'manualSourceSelection'))
        updateData.manual_source_selection = createData.manual_source_selection;
      if (Object.prototype.hasOwnProperty.call(body, 'enableDoubleClickToSeek'))
        updateData.enable_double_click_to_seek = createData.enable_double_click_to_seek;
      if (Object.prototype.hasOwnProperty.call(body, 'enableAutoResumeOnPlaybackError'))
        updateData.enable_auto_resume_on_playback_error =
          createData.enable_auto_resume_on_playback_error;
      if (Object.prototype.hasOwnProperty.call(body, 'enablePauseOverlay'))
        updateData.enable_pause_overlay = createData.enable_pause_overlay;

      log.info('Preparing to upsert settings', {
        userId,
        updateData,
        createData: { id: userId, ...createData },
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
        proxyUrls: settings.proxy_urls.length === 0 ? null : settings.proxy_urls,
        febboxKey: settings.febbox_key,
        debridToken: settings.debrid_token,
        debridService: settings.debrid_service,
        tidbKey: settings.tidb_key,
        enableAutoplay: settings.enable_autoplay,
        enableSkipCredits: settings.enable_skip_credits,
        enableDiscover: settings.enable_discover,
        enableFeatured: settings.enable_featured,
        enableDetailsModal: settings.enable_details_modal,
        enableImageLogos: settings.enable_image_logos,
        enableCarouselView: settings.enable_carousel_view,
        forceCompactEpisodeView: settings.force_compact_episode_view,
        sourceOrder: settings.source_order,
        enableSourceOrder: settings.enable_source_order,
        disabledSources: settings.disabled_sources,
        embedOrder: settings.embed_order,
        enableEmbedOrder: settings.enable_embed_order,
        disabledEmbeds: settings.disabled_embeds,
        proxyTmdb: settings.proxy_tmdb,
        enableLowPerformanceMode: settings.enable_low_performance_mode,
        enableHoldToBoost: settings.enable_hold_to_boost,
        homeSectionOrder: settings.home_section_order,
        manualSourceSelection: settings.manual_source_selection,
        enableDoubleClickToSeek: settings.enable_double_click_to_seek,
        enableAutoResumeOnPlaybackError: settings.enable_auto_resume_on_playback_error,
        enablePauseOverlay: settings.enable_pause_overlay,
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
          cause: error.errors,
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
