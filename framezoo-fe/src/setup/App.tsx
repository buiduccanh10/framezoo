import { DeepLinkPage } from "@/landing/DeepLinkPage";
import { LandingPage } from "@/landing/LandingPage";

export default function App() {
  const path = window.location.pathname;

  // Paths that should trigger a deep link redirect instead of showing the landing page
  const isDeepLink =
    path.startsWith("/media/") ||
    path.startsWith("/browse/") ||
    path.startsWith("/discover");

  if (isDeepLink) {
    const fullPath = window.location.pathname + window.location.search;
    return <DeepLinkPage path={fullPath} />;
  }

  return <LandingPage />;
}
