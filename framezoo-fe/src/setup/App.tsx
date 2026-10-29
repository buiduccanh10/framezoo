import { DeepLinkPage } from "@/landing/DeepLinkPage";
import { InstallGuidePage } from "@/landing/InstallGuidePage";
import { LandingCategoryPage } from "@/landing/LandingCategoryPage";
import { LandingFloatDonate } from "@/landing/LandingFloatDonate";
import { LandingFloatFeedback } from "@/landing/LandingFloatFeedback";
import { LandingPage } from "@/landing/LandingPage";
import { LegalPage, getLegalTabFromPathname } from "@/landing/LegalPage";
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

  const isDeepLink =
    currentPathname.startsWith("/media/") ||
    currentPathname.startsWith("/browse/") ||
    currentPathname.startsWith("/discover");

  const landingCategory = getLandingSeoCategory(currentPathname);
  const legalTab = getLegalTabFromPathname(currentPathname);

  const renderContent = () => {
    if (legalTab) {
      return <LegalPage initialTab={legalTab} />;
    }

    if (
      currentPathname === "/guide/install" ||
      currentPathname === "/install-guide" ||
      currentPathname === "/docs/install" ||
      currentPathname.startsWith("/guide/install/")
    ) {
      return <InstallGuidePage />;
    }

    if (landingCategory) {
      return (
        <LandingCategoryPage
          category={landingCategory.id as LandingSeoCategoryId}
        />
      );
    }

    if (isDeepLink) {
      const fullPath = currentPathname + currentSearch;
      return <DeepLinkPage path={fullPath} />;
    }

    return <LandingPage />;
  };

  return (
    <>
      {renderContent()}
      {!isDeepLink && (
        <>
          <LandingFloatDonate />
          <LandingFloatFeedback />
        </>
      )}
    </>
  );
}
