-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "disabled_embeds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "disabled_sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "embed_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "enable_double_click_to_seek" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_embed_order" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_hold_to_boost" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_low_performance_mode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_native_subtitles" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "force_compact_episode_view" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "home_section_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "manual_source_selection" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "real_debrid_key" VARCHAR(255);
