export function getLandingHashId(hash: string) {
  if (!hash.startsWith("#")) return null;

  const encodedId = hash.slice(1);
  if (!encodedId) return null;

  try {
    const id = decodeURIComponent(encodedId);
    return id || null;
  } catch {
    return null;
  }
}

export function scrollToLandingHash(
  hash = window.location.hash,
  behavior: ScrollBehavior = "smooth",
) {
  const id = getLandingHashId(hash);
  if (!id) return false;

  const target = document.getElementById(id);
  if (!target) return false;

  const navigation = document.querySelector<HTMLElement>(".landing-nav");
  const navigationHeight = navigation?.getBoundingClientRect().height ?? 0;
  const top =
    target.getBoundingClientRect().top + window.scrollY - navigationHeight - 18;

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.scrollTo({
    top: Math.max(0, top),
    behavior:
      behavior === "smooth" && prefersReducedMotion ? "instant" : behavior,
  });
  return true;
}

export function navigateToLandingHash(hash: string) {
  if (!hash.startsWith("#")) return false;

  if (window.location.hash !== hash) {
    window.history.pushState(null, "", hash);
  }

  return scrollToLandingHash(hash, "smooth");
}
