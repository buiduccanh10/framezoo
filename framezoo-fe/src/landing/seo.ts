import { type LandingLocale, getLandingCopy } from "./i18n";

const SITE_URL = "https://framezoo.top";
const SOCIAL_IMAGE_URL = `${SITE_URL}/og-preview.jpg?v=2`;
const SOCIAL_IMAGE_WIDTH = "1024";
const SOCIAL_IMAGE_HEIGHT = "595";
const DEFAULT_SEO_TITLE = "Framezoo - Fast & Smooth Video Streaming";
const DEFAULT_SEO_DESCRIPTION =
  "Framezoo is a high-speed video streaming player designed to be smooth, intuitive, and easy to use. Explore rich movie metadata, sync subtitles with video streams without limits, and load subtitles from multiple sources.";

export const LANDING_SEO_CATEGORIES = [
  { id: "experience", path: "/experience" },
  { id: "ecosystem", path: "/ecosystem" },
  { id: "create-addon", path: "/create-addon" },
  { id: "download", path: "/download" },
] as const;

export type LandingSeoCategoryId =
  (typeof LANDING_SEO_CATEGORIES)[number]["id"];

export function getLandingSeoCategory(pathname: string) {
  return LANDING_SEO_CATEGORIES.find((category) => category.path === pathname);
}

export function getLandingSeoMetadata(
  locale: LandingLocale,
  category: LandingSeoCategoryId | null = null,
) {
  const copy = getLandingCopy(locale);

  if (!category) {
    return {
      title: copy.seo?.title || DEFAULT_SEO_TITLE,
      description: copy.seo?.description || DEFAULT_SEO_DESCRIPTION,
      canonical: `${SITE_URL}/`,
    };
  }

  const categoryMetadata = {
    experience: {
      title: locale === "en" ? "Features & Experience" : copy.nav.features,
      description: copy.features.overviewDescription,
    },
    ecosystem: {
      title: locale === "en" ? "Addon Ecosystem" : copy.nav.addons,
      description: copy.features.ecosystemDescription,
    },
    "create-addon": {
      title: locale === "en" ? "Build an Addon" : copy.nav.addonGuide,
      description: copy.addonGuide.description,
    },
    download: {
      title: locale === "en" ? "Downloads" : copy.nav.download,
      description: copy.download.description,
    },
  }[category];
  const path =
    LANDING_SEO_CATEGORIES.find((item) => item.id === category)?.path ?? "/";

  return {
    title: `${categoryMetadata.title} | Framezoo`,
    description: categoryMetadata.description,
    canonical: `${SITE_URL}${path}`,
  };
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  );

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.content = content;
}

function setCanonicalUrl(url: string) {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );

  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }

  element.href = url;
}

export function applyPageSeo(
  locale: LandingLocale,
  metadata: { title: string; description: string; path: string },
) {
  if (typeof document === "undefined") return;

  const canonical = `${SITE_URL}${metadata.path}`;

  document.title = metadata.title;
  setMeta("name", "robots", "index,follow,max-image-preview:large");
  setMeta("name", "description", metadata.description);
  setMeta("name", "thumbnail", SOCIAL_IMAGE_URL);
  setMeta("property", "og:title", metadata.title);
  setMeta("property", "og:description", metadata.description);
  setMeta("property", "og:url", canonical);
  setMeta("property", "og:image", SOCIAL_IMAGE_URL);
  setMeta("property", "og:image:width", SOCIAL_IMAGE_WIDTH);
  setMeta("property", "og:image:height", SOCIAL_IMAGE_HEIGHT);
  setMeta("property", "og:image:alt", "Framezoo player");
  setMeta(
    "property",
    "og:locale",
    locale === "en" ? "en_US" : locale.replace("-", "_"),
  );
  setMeta("name", "twitter:title", metadata.title);
  setMeta("name", "twitter:description", metadata.description);
  setMeta("name", "twitter:image", SOCIAL_IMAGE_URL);
  setCanonicalUrl(canonical);
}

export function applyLandingSeo(
  locale: LandingLocale,
  category: LandingSeoCategoryId | null = null,
) {
  const metadata = getLandingSeoMetadata(locale, category);
  const path = category
    ? (LANDING_SEO_CATEGORIES.find((item) => item.id === category)?.path ?? "/")
    : "/";

  applyPageSeo(locale, {
    title: metadata.title,
    description: metadata.description,
    path,
  });
}
