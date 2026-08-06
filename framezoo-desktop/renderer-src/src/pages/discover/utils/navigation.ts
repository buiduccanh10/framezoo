import { DiscoverView } from "@/stores/discover";

export function getDiscoverBackUrl(lastView: DiscoverView | null) {
  if (!lastView?.url) return null;

  if (lastView.url === "/discover" || lastView.url.startsWith("/discover/")) {
    return lastView.url;
  }

  if (lastView.url.startsWith("/discover?")) {
    return lastView.url;
  }

  return null;
}
