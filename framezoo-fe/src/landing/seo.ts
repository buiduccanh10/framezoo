import { type LandingLocale, getLandingCopy } from "./i18n";

const SITE_URL = "https://framezoo.top";
const SOCIAL_IMAGE_URL = `${SITE_URL}/embed-preview-1.png`;

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

export function applyLandingSeo(locale: LandingLocale) {
  if (typeof document === "undefined") return;

  const copy = getLandingCopy(locale);
  const title = `${copy.hero.title} ${copy.hero.titleAccent} | Framezoo`;
  const description = copy.hero.description;

  document.title = title;
  setMeta("name", "description", description);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url", `${SITE_URL}/`);
  setMeta("property", "og:image", SOCIAL_IMAGE_URL);
  setMeta("property", "og:locale", locale);
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", SOCIAL_IMAGE_URL);
  setCanonicalUrl(`${SITE_URL}/`);
}
