import { DeepLinkPage } from "@/landing/DeepLinkPage";
import { LandingCategoryPage } from "@/landing/LandingCategoryPage";
import { LandingPage } from "@/landing/LandingPage";
import {
  type LandingSeoCategoryId,
  getLandingSeoCategory,
} from "@/landing/seo";

interface AppProps {
  pathname?: string;
  search?: string;
}

export default function App({ pathname, search }: AppProps = {}) {
  const currentPathname =
    pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "/");
  const currentSearch =
    search ?? (typeof window !== "undefined" ? window.location.search : "");

  const landingCategory = getLandingSeoCategory(currentPathname);
  if (landingCategory) {
    return (
      <LandingCategoryPage
        category={landingCategory.id as LandingSeoCategoryId}
      />
    );
  }

  // Paths that should trigger a deep link redirect instead of showing the landing page
  const isDeepLink =
    currentPathname.startsWith("/media/") ||
    currentPathname.startsWith("/browse/") ||
    currentPathname.startsWith("/discover");

  if (isDeepLink) {
    const fullPath = currentPathname + currentSearch;
    return <DeepLinkPage path={fullPath} />;
  }

  return <LandingPage />;
}
