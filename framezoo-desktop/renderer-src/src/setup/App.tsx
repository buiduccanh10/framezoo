import { ReactElement, Suspense, useEffect, useState } from "react";
import { lazyWithPreload } from "react-lazy-with-preload";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import { convertLegacyUrl, isLegacyUrl } from "@/backend/metadata/getmeta";
import {
  decodeTMDBId,
  generateQuickSearchMediaUrl,
} from "@/backend/metadata/tmdb";
import { AuthModal } from "@/components/overlays/AuthModal";
import { DetailsModal } from "@/components/overlays/detailsModal";
import { KeyboardCommandsEditModal } from "@/components/overlays/KeyboardCommandsEditModal";
import { KeyboardCommandsModal } from "@/components/overlays/KeyboardCommandsModal";
import { ToastProvider } from "@/components/overlays/ToastProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useGlobalKeyboardEvents } from "@/hooks/useGlobalKeyboardEvents";
import { useOnlineListener } from "@/hooks/usePing";
import { AddonsPage } from "@/pages/addons/AddonsPage";
import { AllBookmarks } from "@/pages/bookmarks/AllBookmarks";
import { DiscoverMore } from "@/pages/discover/AllMovieLists";
import { Discover } from "@/pages/discover/Discover";
import { MoreContent } from "@/pages/discover/MoreContent";
import MaintenancePage from "@/pages/errors/MaintenancePage";
import { NotFoundPage } from "@/pages/errors/NotFoundPage";
import { HomePage } from "@/pages/HomePage";
import { Marked } from "@/pages/marked/Marked";
import { MigrationPage } from "@/pages/migration/Migration";
import { MigrationDownloadPage } from "@/pages/migration/MigrationDownload";
import { MigrationUploadPage } from "@/pages/migration/MigrationUpload";
import { WatchHistory } from "@/pages/watchHistory/WatchHistory";
import { Layout } from "@/setup/Layout";
import { useHistoryListener } from "@/stores/history";
import {
  useClearModalsOnNavigation,
  useOverlayStack,
} from "@/stores/interface/overlayStack";
import { LanguageProvider } from "@/stores/language";
import { usePreferencesStore } from "@/stores/preferences";

const PlayerView = lazyWithPreload(() => import("@/pages/PlayerView"));
const DesktopPipPage = lazyWithPreload(() => import("@/pages/DesktopPip"));
const SettingsPage = lazyWithPreload(() => import("@/pages/Settings"));

PlayerView.preload();
DesktopPipPage.preload();
SettingsPage.preload();

function LegacyUrlView({ children }: { children: ReactElement }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const url = location.pathname;
    if (!isLegacyUrl(url)) return;
    convertLegacyUrl(location.pathname).then((convertedUrl) => {
      navigate(convertedUrl ?? "/discover", { replace: true });
    });
  }, [location.pathname, navigate]);

  if (isLegacyUrl(location.pathname)) return null;
  return children;
}

function QuickSearch() {
  const { query } = useParams<{ query: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (query) {
      generateQuickSearchMediaUrl(query).then((url) => {
        navigate(url ?? "/discover", { replace: true });
      });
    } else {
      navigate("/discover", { replace: true });
    }
  }, [query, navigate]);

  return null;
}

function QueryView() {
  const { query } = useParams<{ query: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (query) {
      navigate(`/browse/${encodeURIComponent(query)}`, { replace: true });
    } else {
      navigate("/discover", { replace: true });
    }
  }, [query, navigate]);

  return null;
}

export const maintenanceTime = "March 31th 11:00 PM - 5:00 AM EST";

function App() {
  useHistoryListener();
  useOnlineListener();
  useGlobalKeyboardEvents();
  useClearModalsOnNavigation();

  const location = useLocation();
  const navigate = useNavigate();
  const showModal = useOverlayStack((s) => s.showModal);

  // Automatically restore previous window state if navigating away from video player routes
  useEffect(() => {
    if (!location.pathname.startsWith("/media/")) {
      const electronApi = (window as any).electronAPI;
      if (electronApi?.exitPlayerFullscreen) {
        void electronApi.exitPlayerFullscreen();
      }
    }
  }, [location.pathname]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const detailParam = searchParams.get("detail");
    if (detailParam) {
      const decoded = decodeTMDBId(detailParam);
      if (decoded) {
        showModal("details", {
          id: Number(decoded.id),
          type: decoded.type === "movie" ? "movie" : "show",
        });

        // Remove the query parameter from URL to keep it clean
        searchParams.delete("detail");
        const newSearch = searchParams.toString();
        navigate(
          {
            pathname: location.pathname,
            search: newSearch ? `?${newSearch}` : "",
          },
          { replace: true },
        );
      }
    }
  }, [location.search, location.pathname, navigate, showModal]);
  const maintenance = false; // Shows maintance page
  const [showDowntime, setShowDowntime] = useState(maintenance);

  const handleButtonClick = () => {
    setShowDowntime(false);
  };

  useEffect(() => {
    const sessionToken = sessionStorage.getItem("downtimeToken");
    if (!sessionToken && maintenance) {
      setShowDowntime(true);
      sessionStorage.setItem("downtimeToken", "true");
    }
  }, [setShowDowntime, maintenance]);

  useEffect(() => {
    if (window.electronAPI?.onDeepLink) {
      const cleanup = window.electronAPI.onDeepLink((deepLinkPath) => {
        // Remove leading slash if any to ensure correct navigation path, but navigate works with absolute path within router
        navigate(
          deepLinkPath.startsWith("/") ? deepLinkPath : `/${deepLinkPath}`,
        );
      });
      return cleanup;
    }
  }, [navigate]);

  const torrentMaxSize = usePreferencesStore((s) => s.torrentMaxSize);
  useEffect(() => {
    if (window.electronAPI?.setTorrentMaxSize) {
      window.electronAPI.setTorrentMaxSize(torrentMaxSize).catch(() => {});
    }
  }, [torrentMaxSize]);

  return (
    <Layout>
      <LanguageProvider />
      <KeyboardCommandsModal id="keyboard-commands" />
      <KeyboardCommandsEditModal id="keyboard-commands-edit" />
      <DetailsModal id="details" />
      <DetailsModal id="discover-details" />
      <DetailsModal id="player-details" />
      <AuthModal />
      <ToastProvider />
      {!showDowntime && (
        <>
          <Routes>
            {/* Functional routes */}
            <Route
              path="/desktop-pip"
              element={
                <Suspense fallback={null}>
                  <DesktopPipPage />
                </Suspense>
              }
            />
            <Route path="/s/:query" element={<QuickSearch />} />
            <Route path="/search/:type" element={<Navigate to="/browse" />} />
            <Route path="/search/:type/:query?" element={<QueryView />} />

            {/* Public pages */}
            <Route path="/" element={<Navigate to="/discover" replace />} />
            <Route path="/browse/:query?" element={<HomePage />} />
            <Route path="/discover" element={<Discover />} />
            <Route
              path="/discover/more/:contentType/:mediaType"
              element={<MoreContent />}
            />
            <Route
              path="/discover/more/:contentType/:id/:mediaType"
              element={<MoreContent />}
            />
            <Route path="/discover/more/:category" element={<MoreContent />} />
            <Route path="/discover/all" element={<DiscoverMore />} />
            <Route
              path="/media/:media"
              element={
                <LegacyUrlView>
                  <Suspense fallback={null}>
                    <PlayerView />
                  </Suspense>
                </LegacyUrlView>
              }
            />
            <Route
              path="/media/:media/:season/:episode"
              element={
                <LegacyUrlView>
                  <Suspense fallback={null}>
                    <PlayerView />
                  </Suspense>
                </LegacyUrlView>
              }
            />
            <Route path="/addons" element={<AddonsPage />} />
            <Route
              path="/settings"
              element={
                <Suspense fallback={null}>
                  <SettingsPage />
                </Suspense>
              }
            />
            <Route path="/migration" element={<MigrationPage />} />
            <Route
              path="/migration/download"
              element={<MigrationDownloadPage />}
            />

            {/* User data routes */}
            <Route element={<ProtectedRoute />}>
              <Route
                path="/migration/upload"
                element={<MigrationUploadPage />}
              />
              <Route path="/bookmarks" element={<AllBookmarks />} />
              <Route path="/marked" element={<Marked />} />
              <Route path="/watch-history" element={<WatchHistory />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </>
      )}
      {showDowntime && (
        <MaintenancePage onHomeButtonClick={handleButtonClick} />
      )}
    </Layout>
  );
}

export default App;
