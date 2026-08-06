-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "enable_autoplay" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enable_carousel_view" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_details_modal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_discover" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enable_featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_image_logos" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enable_skip_credits" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enable_source_order" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_thumbnails" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proxy_tmdb" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source_order" TEXT[] DEFAULT ARRAY[]::TEXT[];
