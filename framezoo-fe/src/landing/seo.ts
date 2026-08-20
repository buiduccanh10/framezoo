import { type LandingLocale, getLandingCopy } from "./i18n";

const SITE_URL = "https://framezoo.top";
const SOCIAL_IMAGE_URL = `${SITE_URL}/embed-preview-1.png`;
const DEFAULT_SEO_TITLE = "Framezoo Player | AI Subtitle Sync";
const DEFAULT_SEO_DESCRIPTION =
  "Framezoo is a player with AI subtitle sync, dual subtitles, rich media metadata, and addon support.";

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
      title:
        locale === "en"
          ? DEFAULT_SEO_TITLE
          : `${copy.hero.title} ${copy.hero.titleAccent} | Framezoo`,
      description:
        locale === "en" ? DEFAULT_SEO_DESCRIPTION : copy.hero.description,
      canonical: `${SITE_URL}/`,
    };
  }

  const categoryMetadata = {
    experience: {
      title: copy.features.experienceTitle,
      description: copy.features.overviewDescription,
    },
    ecosystem: {
      title: copy.features.ecosystemTitle,
      description: copy.features.ecosystemDescription,
    },
    "create-addon": {
      title: copy.addonGuide.title,
      description: copy.addonGuide.description,
    },
    download: {
      title: copy.download.title,
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

export function applyLandingSeo(
  locale: LandingLocale,
  category: LandingSeoCategoryId | null = null,
) {
  if (typeof document === "undefined") return;

  const metadata = getLandingSeoMetadata(locale, category);

  document.title = metadata.title;
  setMeta("name", "description", metadata.description);
  setMeta("property", "og:title", metadata.title);
  setMeta("property", "og:description", metadata.description);
  setMeta("property", "og:url", metadata.canonical);
  setMeta("property", "og:image", SOCIAL_IMAGE_URL);
  setMeta("property", "og:image:alt", "Framezoo player");
  setMeta(
    "property",
    "og:locale",
    locale === "en" ? "en_US" : locale.replace("-", "_"),
  );
  setMeta("name", "twitter:title", metadata.title);
  setMeta("name", "twitter:description", metadata.description);
  setMeta("name", "twitter:image", SOCIAL_IMAGE_URL);
  setCanonicalUrl(metadata.canonical);
}
