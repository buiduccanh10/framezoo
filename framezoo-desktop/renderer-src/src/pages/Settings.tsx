import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import {
  base64ToBuffer,
  decryptData,
  encryptData,
} from "@/backend/accounts/crypto";
import { getSessions, updateSession } from "@/backend/accounts/sessions";
import { getSettings, updateSettings } from "@/backend/accounts/settings";
import { editUser } from "@/backend/accounts/user";
import { Button } from "@/components/buttons/Button";
import { SearchBarInput } from "@/components/form/SearchBar";
import { ThinContainer } from "@/components/layout/ThinContainer";
import { WideContainer } from "@/components/layout/WideContainer";
import { Modal, ModalCard, useModal } from "@/components/overlays/Modal";
import { UserIcons } from "@/components/UserIcon";
import { Divider } from "@/components/utils/Divider";
import { Heading1, Heading2, Paragraph } from "@/components/utils/Text";
import { Transition } from "@/components/utils/Transition";
import { useAuth } from "@/hooks/auth/useAuth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useIsIOS, useIsMobile, useIsPWA } from "@/hooks/useIsMobile";
import { useSettingsState } from "@/hooks/useSettingsState";
import { AccountActionsPart } from "@/pages/parts/settings/AccountActionsPart";
import { AccountEditPart } from "@/pages/parts/settings/AccountEditPart";
import { AppearancePart } from "@/pages/parts/settings/AppearancePart";
import { CaptionsPart } from "@/pages/parts/settings/CaptionsPart";
import { ConnectionsPart } from "@/pages/parts/settings/ConnectionsPart";
import { DeviceListPart } from "@/pages/parts/settings/DeviceListPart";
import { RegisterCalloutPart } from "@/pages/parts/settings/RegisterCalloutPart";
import { SidebarPart } from "@/pages/parts/settings/SidebarPart";
import { PageTitle } from "@/pages/parts/util/PageTitle";
import { AccountWithToken, useAuthStore } from "@/stores/auth";
import { useBannerSize } from "@/stores/banner";
import { useLanguageStore } from "@/stores/language";
import { usePreferencesStore } from "@/stores/preferences";
import { useSubtitleStore } from "@/stores/subtitles";
import { usePreviewThemeStore, useThemeStore } from "@/stores/theme";
import { scrollToElement, scrollToHash } from "@/utils/scroll";

import { SubPageLayout } from "./layouts/SubPageLayout";
import { PreferencesPart } from "./parts/settings/PreferencesPart";
import { TorrentPart } from "./parts/settings/TorrentPart";

function SettingsLayout(props: {
  className?: string;
  children: React.ReactNode;
  searchQuery: string;
  onSearchChange: (value: string, force: boolean) => void;
  onSearchUnFocus: (newSearch?: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (category: string | null) => void;
  onCategoryChange?: (category: string | null) => void;
  showConnections: boolean;
}) {
  const { className } = props;
  const { t } = useTranslation();
  const { isMobile } = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);
  const bannerSize = useBannerSize();

  const isPWA = useIsPWA();
  const isIOS = useIsIOS();
  const isIOSPWA = isIOS && isPWA;

  // Navbar height is 80px (h-20)
  const navbarHeight = 80;
  // On desktop: inline with navbar (same top position + 14px adjustment)
  // On mobile: below navbar (navbar height + banner)
  const topOffset = isMobile
    ? navbarHeight + bannerSize + (isIOSPWA ? 34 : 0)
    : bannerSize + 14;

  return (
    <WideContainer ultraWide classNames="overflow-visible">
      {/* Floating Search Bar - starts in sticky state */}
      <div
        className="fixed left-0 right-0 z-[600]"
        style={{
          top: `${topOffset}px`,
        }}
      >
        <ThinContainer>
          <SearchBarInput
            ref={searchRef}
            onChange={props.onSearchChange}
            value={props.searchQuery}
            onUnFocus={props.onSearchUnFocus}
            placeholder={t("settings.search.placeholder")}
            isSticky
            hideTooltip
          />
        </ThinContainer>
      </div>

      <div
        className={classNames(
          "grid gap-12",
          isMobile ? "grid-cols-1" : "lg:grid-cols-[280px,1fr]",
        )}
        data-settings-content
      >
        <SidebarPart
          selectedCategory={props.selectedCategory}
          setSelectedCategory={props.setSelectedCategory}
          onCategoryChange={props.onCategoryChange}
          searchQuery={props.searchQuery}
          showConnections={props.showConnections}
        />
        <div className={className}>{props.children}</div>
        <div className="block lg:hidden">
          <Divider />
        </div>
      </div>
    </WideContainer>
  );
}

export function AccountSettings(props: {
  account: AccountWithToken;
  deviceName: string;
  setDeviceName: (s: string) => void;
  nickname: string;
  setNickname: (s: string) => void;
  colorA: string;
  setColorA: (s: string) => void;
  colorB: string;
  setColorB: (s: string) => void;
  userIcon: UserIcons;
  setUserIcon: (s: UserIcons) => void;
}) {
  const url = useBackendUrl();
  const { account } = props;
  const [sessionsResult, execSessions] = useAsyncFn(() => {
    if (!url) return Promise.resolve([]);
    return getSessions(url, account);
  }, [account, url]);
  useEffect(() => {
    execSessions();
  }, [execSessions]);

  return (
    <>
      <AccountEditPart
        deviceName={props.deviceName}
        setDeviceName={props.setDeviceName}
        nickname={props.nickname}
        setNickname={props.setNickname}
        colorA={props.colorA}
        setColorA={props.setColorA}
        colorB={props.colorB}
        setColorB={props.setColorB}
        userIcon={props.userIcon}
        setUserIcon={props.setUserIcon}
      />
      <DeviceListPart
        error={!!sessionsResult.error}
        loading={sessionsResult.loading}
        sessions={sessionsResult.value ?? []}
        onChange={execSessions}
      />
      <AccountActionsPart />
    </>
  );
}

export function SettingsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // TIDB segment submissions are now handled by the backend, so the legacy
  // client-side "Connections" settings section stays hidden.
  const shouldShowConnections = false;
  const validCategories = useMemo(
    () => [
      "settings-account",
      "settings-preferences",
      "settings-appearance",
      "settings-captions",
      "settings-torrent",
      ...(shouldShowConnections ? ["settings-connection"] : []),
    ],
    [shouldShowConnections],
  );
  const backendChangeModal = useModal("settings-backend-change-confirmation");
  const [pendingBackendChange, setPendingBackendChange] = useState<
    string | null
  >(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const hashId = hash.substring(1); // Remove the # symbol
      if (validCategories.includes(hashId)) {
        // It's a category hash
        setSelectedCategory(hashId);
        scrollToHash(hash);
      } else {
        // Try to find the element anyway (might be a sub-section)
        try {
          if (hash && !hash.includes("/")) {
            const element = document.querySelector(hash);
            if (element) {
              // Find which category this element belongs to
              const parentSection = element.closest('[id^="settings-"]');
              if (parentSection) {
                const categoryId = parentSection.id;
                if (validCategories.includes(categoryId)) {
                  setSelectedCategory(categoryId);
                  scrollToHash(hash, { delay: 100 });
                }
              } else {
                scrollToHash(hash);
              }
            }
          }
        } catch {
          // Ignore invalid selector errors
        }
      }
    }
  }, [validCategories]);

  // Handle hash changes after initial load
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash) {
        const hashId = hash.substring(1);
        if (validCategories.includes(hashId)) {
          setSelectedCategory(hashId);
          scrollToHash(hash, { delay: 100 });
        } else {
          try {
            if (hash && !hash.includes("/")) {
              const element = document.querySelector(hash);
              if (element) {
                const parentSection = element.closest('[id^="settings-"]');
                if (parentSection) {
                  const categoryId = parentSection.id;
                  if (validCategories.includes(categoryId)) {
                    setSelectedCategory(categoryId);
                    scrollToHash(hash, { delay: 100 });
                  }
                } else {
                  scrollToHash(hash);
                }
              }
            }
          } catch {
            // Ignore invalid selector errors
          }
        }
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [validCategories]);

  const { t } = useTranslation();
  const activeTheme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const customTheme = useThemeStore((s) => s.customTheme);
  const setCustomTheme = useThemeStore((s) => s.setCustomTheme);
  const previewTheme = usePreviewThemeStore((s) => s.previewTheme);
  const setPreviewTheme = usePreviewThemeStore((s) => s.setPreviewTheme);

  // Baseline for custom theme so "changed" is detected when only colors change.
  // Only updated on load from backend or after save; prevents useDerived from
  // resetting when we update the store for preview.
  const [customThemeBaseline, setCustomThemeBaseline] = useState<{
    primary: string;
    secondary: string;
    tertiary: string;
  } | null>(null);
  useEffect(() => {
    if (customThemeBaseline === null) {
      setCustomThemeBaseline(customTheme);
    }
  }, [customTheme, customThemeBaseline]);

  // Simple text search with highlighting
  const handleSearchChange = useCallback((value: string, _force: boolean) => {
    setSearchQuery(value);
    // When searching, clear category selection to show all sections
    if (value.trim()) {
      setSelectedCategory(null);
    }

    // Remove existing highlights
    const existingHighlights = document.querySelectorAll(".search-highlight");
    existingHighlights.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ""), el);
        parent.normalize();
      }
    });

    if (value.trim()) {
      // Find and highlight matching text
      const walker = document.createTreeWalker(
        document.querySelector("[data-settings-content]") || document.body,
        NodeFilter.SHOW_TEXT,
        null,
      );

      let node = walker.nextNode();

      while (node) {
        const text = node.textContent || "";
        const lowerText = text.toLowerCase();
        const lowerValue = value.toLowerCase();

        if (lowerText.includes(lowerValue)) {
          const regex = new RegExp(
            `(${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
          );
          const highlightedText = text.replace(
            regex,
            '<span class="search-highlight bg-yellow-200 text-black px-1 rounded">$1</span>',
          );

          if (highlightedText !== text) {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = highlightedText;
            const parent = node.parentNode;
            if (parent) {
              while (wrapper.firstChild) {
                parent.insertBefore(wrapper.firstChild, node);
              }
              parent.removeChild(node);
            }
          }
        }
        node = walker.nextNode();
      }

      // Scroll to first highlighted element
      scrollToElement(".search-highlight", {
        behavior: "smooth",
        block: "center",
      });
    }
  }, []);

  const handleSearchUnFocus = useCallback((newSearch?: string) => {
    if (newSearch !== undefined) {
      setSearchQuery(newSearch);
    }
  }, []);

  const handleCategoryChange = useCallback(
    (category: string | null) => {
      if (searchQuery.trim()) return;
      const sectionId = category ?? "settings-account";
      setTimeout(() => {
        scrollToElement(`#${sectionId}`, {
          behavior: "smooth",
          block: "start",
          offset: 120, // Account for fixed search bar
        });
      }, 100); // Wait for section to render after tab switch
    },
    [searchQuery],
  );

  const appLanguage = useLanguageStore((s) => s.language);
  const setAppLanguage = useLanguageStore((s) => s.setLanguage);

  const subStyling = useSubtitleStore((s) => s.styling);
  const setSubStyling = useSubtitleStore((s) => s.updateStyling);
  const subSecondaryStyling = useSubtitleStore((s) => s.secondaryStyling);
  const setSubSecondaryStyling = useSubtitleStore(
    (s) => s.updateSecondaryStyling,
  );

  const proxySet = useAuthStore((s) => s.proxySet);
  const setProxySet = useAuthStore((s) => s.setProxySet);

  const backendUrlSetting = useAuthStore((s) => s.backendUrl);
  const setBackendUrl = useAuthStore((s) => s.setBackendUrl);

  const febboxKey = usePreferencesStore((s) => s.febboxKey);
  const setFebboxKey = usePreferencesStore((s) => s.setFebboxKey);

  const debridToken = usePreferencesStore((s) => s.debridToken);
  const setdebridToken = usePreferencesStore((s) => s.setdebridToken);
  const debridService = usePreferencesStore((s) => s.debridService);
  const setdebridService = usePreferencesStore((s) => s.setdebridService);

  const tidbKey = usePreferencesStore((s) => s.tidbKey);
  const setTIDBKey = usePreferencesStore((s) => s.setTIDBKey);

  const enableAutoplay = usePreferencesStore((s) => s.enableAutoplay);
  const setEnableAutoplay = usePreferencesStore((s) => s.setEnableAutoplay);

  const enableSkipCredits = usePreferencesStore((s) => s.enableSkipCredits);
  const setEnableSkipCredits = usePreferencesStore(
    (s) => s.setEnableSkipCredits,
  );

  const enableAutoSkipSegments = usePreferencesStore(
    (s) => s.enableAutoSkipSegments,
  );
  const setEnableAutoSkipSegments = usePreferencesStore(
    (s) => s.setEnableAutoSkipSegments,
  );

  const proxyTmdb = usePreferencesStore((s) => s.proxyTmdb);
  const setProxyTmdb = usePreferencesStore((s) => s.setProxyTmdb);

  const setEnableDoubleClickToSeek = usePreferencesStore(
    (s) => s.setEnableDoubleClickToSeek,
  );

  const enableAutoResumeOnPlaybackError = usePreferencesStore(
    (s) => s.enableAutoResumeOnPlaybackError,
  );
  const setEnableAutoResumeOnPlaybackError = usePreferencesStore(
    (s) => s.setEnableAutoResumeOnPlaybackError,
  );
  const setEnableNumberKeySeeking = usePreferencesStore(
    (s) => s.setEnableNumberKeySeeking,
  );

  const account = useAuthStore((s) => s.account);
  const updateProfile = useAuthStore((s) => s.setAccountProfile);
  const updateDeviceName = useAuthStore((s) => s.updateDeviceName);
  const updateNickname = useAuthStore((s) => s.setAccountNickname);
  const decryptedName = useMemo(() => {
    if (!account) return "";
    try {
      return decryptData(account.deviceName, base64ToBuffer(account.seed));
    } catch (error) {
      console.warn("Failed to decrypt device name, using fallback:", error);
      // Return a fallback device name if decryption fails
      return t("settings.account.devices.unknownDevice");
    }
  }, [account, t]);

  const backendUrl = useBackendUrl();

  const { logout } = useAuth();
  const user = useAuthStore();

  useEffect(() => {
    const loadSettings = async () => {
      if (account && backendUrl) {
        const settings = await getSettings(backendUrl, account);
        if (settings.applicationTheme !== undefined) {
          setTheme(settings.applicationTheme);
        }
        if (settings.applicationLanguage) {
          setAppLanguage(settings.applicationLanguage);
        }
        if (settings.proxyUrls !== undefined) {
          setProxySet(settings.proxyUrls?.filter((v) => v !== "") ?? null);
        }
        if (settings.febboxKey !== undefined) {
          setFebboxKey(settings.febboxKey);
        }
        if (settings.debridToken !== undefined) {
          setdebridToken(settings.debridToken);
        }
        if (settings.debridService) {
          setdebridService(settings.debridService);
        }

        if (settings.enableAutoplay !== undefined) {
          setEnableAutoplay(settings.enableAutoplay);
        }
        if (settings.enableSkipCredits !== undefined) {
          setEnableSkipCredits(settings.enableSkipCredits);
        }
        if (settings.enableAutoSkipSegments !== undefined) {
          setEnableAutoSkipSegments(settings.enableAutoSkipSegments);
        }

        if (settings.proxyTmdb !== undefined) {
          setProxyTmdb(settings.proxyTmdb);
        }
        if (settings.enableDoubleClickToSeek !== undefined) {
          setEnableDoubleClickToSeek(settings.enableDoubleClickToSeek);
        }
        if (settings.enableAutoResumeOnPlaybackError !== undefined) {
          setEnableAutoResumeOnPlaybackError(
            settings.enableAutoResumeOnPlaybackError,
          );
        }
        if (settings.enableNumberKeySeeking !== undefined) {
          setEnableNumberKeySeeking(settings.enableNumberKeySeeking);
        }
        if (settings.customTheme) {
          setCustomTheme(settings.customTheme);
          setCustomThemeBaseline(settings.customTheme);
        } else {
          setCustomThemeBaseline(useThemeStore.getState().customTheme);
        }
      }
    };
    loadSettings();
  }, [
    account,
    backendUrl,
    setTheme,
    setAppLanguage,
    setProxySet,
    setFebboxKey,
    setdebridToken,
    setdebridService,

    setEnableAutoplay,
    setEnableSkipCredits,
    setEnableAutoSkipSegments,
    setProxyTmdb,
    setEnableDoubleClickToSeek,
    setEnableAutoResumeOnPlaybackError,
    setEnableNumberKeySeeking,
    setCustomTheme,
  ]);

  const state = useSettingsState(
    activeTheme,
    appLanguage,
    subStyling,
    subSecondaryStyling,
    decryptedName,
    account?.nickname || "",
    proxySet,
    backendUrlSetting,
    febboxKey,
    debridToken,
    debridService,
    tidbKey,
    account ? account.profile : undefined,

    enableAutoplay,
    enableSkipCredits,
    enableAutoSkipSegments,
    proxyTmdb,
    true,
    enableAutoResumeOnPlaybackError,
    customThemeBaseline ?? customTheme,
  );

  useEffect(() => {
    setPreviewTheme(activeTheme ?? "default");
  }, [setPreviewTheme, activeTheme]);

  useEffect(() => {
    // Clear preview theme on unmount
    return () => {
      setPreviewTheme(null);
    };
  }, [setPreviewTheme]);

  const setThemeWithPreview = useCallback(
    (theme: string) => {
      state.theme.set(theme === "default" ? null : theme);
      setPreviewTheme(theme);
    },
    [state.theme, setPreviewTheme],
  );

  const saveChanges = useCallback(async () => {
    if (account && backendUrl) {
      if (
        state.appLanguage.changed ||
        state.theme.changed ||
        state.proxyUrls.changed ||
        state.febboxKey.changed ||
        state.debridToken.changed ||
        state.debridService.changed ||
        state.enableAutoplay.changed ||
        state.enableSkipCredits.changed ||
        state.enableAutoSkipSegments.changed ||
        state.proxyTmdb.changed ||
        state.enableDoubleClickToSeek.changed ||
        state.enableAutoResumeOnPlaybackError.changed ||
        state.customTheme.changed
      ) {
        await updateSettings(backendUrl, account, {
          applicationLanguage: state.appLanguage.state,
          applicationTheme: state.theme.state,
          proxyUrls: state.proxyUrls.state?.filter((v) => v !== "") ?? null,
          febboxKey: state.febboxKey.state,
          debridToken: state.debridToken.state,
          debridService: state.debridService.state,

          enableAutoplay: state.enableAutoplay.state,
          enableSkipCredits: state.enableSkipCredits.state,
          enableAutoSkipSegments: state.enableAutoSkipSegments.state,

          proxyTmdb: state.proxyTmdb.state,
          enableDoubleClickToSeek: state.enableDoubleClickToSeek.state,
          enableAutoResumeOnPlaybackError:
            state.enableAutoResumeOnPlaybackError.state,
          customTheme: state.customTheme.state,
        });
      }
      if (state.deviceName.changed) {
        const newDeviceName = await encryptData(
          state.deviceName.state,
          base64ToBuffer(account.seed),
        );
        await updateSession(backendUrl, account, {
          deviceName: newDeviceName,
        });
        updateDeviceName(newDeviceName);
      }
      if (state.nickname.changed) {
        await editUser(backendUrl, account, {
          nickname: state.nickname.state,
        });
        updateNickname(state.nickname.state);
      }
      if (state.profile.changed && state.profile.state) {
        await editUser(backendUrl, account, {
          profile: state.profile.state,
        });
        updateProfile(state.profile.state);
      }
    }

    setEnableAutoplay(state.enableAutoplay.state);
    setEnableSkipCredits(state.enableSkipCredits.state);
    setEnableAutoSkipSegments(state.enableAutoSkipSegments.state);

    setAppLanguage(state.appLanguage.state);
    setTheme(state.theme.state);
    setSubStyling(state.subtitleStyling.state);
    setSubSecondaryStyling(state.secondarySubtitleStyling.state);
    setProxySet(state.proxyUrls.state?.filter((v) => v !== "") ?? null);
    setFebboxKey(state.febboxKey.state);
    setdebridToken(state.debridToken.state);
    setdebridService(state.debridService.state);
    setTIDBKey(state.tidbKey.state);
    setProxyTmdb(state.proxyTmdb.state);
    setEnableDoubleClickToSeek(state.enableDoubleClickToSeek.state);
    setEnableAutoResumeOnPlaybackError(
      state.enableAutoResumeOnPlaybackError.state,
    );
    setCustomTheme(state.customTheme.state);
    setCustomThemeBaseline(state.customTheme.state);

    if (state.profile.state) {
      updateProfile(state.profile.state);
    }

    // when backend url gets changed, show confirmation and log the user out (only if logged in)
    if (state.backendUrl.changed) {
      let url = state.backendUrl.state;
      if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }
      if (account) {
        // User is logged in - show confirmation
        setPendingBackendChange(url);
        backendChangeModal.show();
        return;
      }
      // User is not logged in - just update without confirmation
      setBackendUrl(url);
    }
  }, [
    account,
    backendUrl,
    backendChangeModal,
    setPendingBackendChange,
    state,
    setBackendUrl,

    setFebboxKey,
    setdebridToken,
    setdebridService,
    setTIDBKey,
    setEnableAutoplay,
    setEnableSkipCredits,
    setEnableAutoSkipSegments,
    setAppLanguage,
    setTheme,
    setSubStyling,
    setSubSecondaryStyling,
    setProxySet,
    updateDeviceName,
    updateProfile,
    updateNickname,
    setProxyTmdb,
    setEnableDoubleClickToSeek,
    setEnableAutoResumeOnPlaybackError,
    setCustomTheme,
  ]);
  return (
    <SubPageLayout>
      <Helmet>
        <style type="text/css">{`
          html,
          body {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          html::-webkit-scrollbar,
          body::-webkit-scrollbar,
          .settings-page *::-webkit-scrollbar {
            display: none;
          }

          .settings-page * {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
        `}</style>
      </Helmet>
      <PageTitle subpage k="global.pages.settings" />
      <div className="settings-page">
        <SettingsLayout
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onSearchUnFocus={handleSearchUnFocus}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          onCategoryChange={handleCategoryChange}
          className="space-y-28"
          showConnections={shouldShowConnections}
        >
          {(searchQuery.trim() ||
            !selectedCategory ||
            selectedCategory === "settings-account") && (
            <div id="settings-account">
              <Heading1 border className="!mb-0">
                {t("settings.account.title")}
              </Heading1>
              {user.account && state.profile.state ? (
                <AccountSettings
                  account={user.account}
                  deviceName={state.deviceName.state}
                  setDeviceName={state.deviceName.set}
                  nickname={state.nickname.state}
                  setNickname={state.nickname.set}
                  colorA={state.profile.state.colorA}
                  setColorA={(v) => {
                    state.profile.set((s) =>
                      s ? { ...s, colorA: v } : undefined,
                    );
                  }}
                  colorB={state.profile.state.colorB}
                  setColorB={(v) =>
                    state.profile.set((s) =>
                      s ? { ...s, colorB: v } : undefined,
                    )
                  }
                  userIcon={state.profile.state.icon as any}
                  setUserIcon={(v) =>
                    state.profile.set((s) =>
                      s ? { ...s, icon: v } : undefined,
                    )
                  }
                />
              ) : (
                <RegisterCalloutPart />
              )}
            </div>
          )}
          {(searchQuery.trim() ||
            !selectedCategory ||
            selectedCategory === "settings-preferences") && (
            <div id="settings-preferences">
              <PreferencesPart
                language={state.appLanguage.state}
                setLanguage={state.appLanguage.set}
                enableAutoplay={state.enableAutoplay.state}
                setEnableAutoplay={state.enableAutoplay.set}
                enableSkipCredits={state.enableSkipCredits.state}
                setEnableSkipCredits={state.enableSkipCredits.set}
                enableAutoSkipSegments={state.enableAutoSkipSegments.state}
                setEnableAutoSkipSegments={state.enableAutoSkipSegments.set}
                enableDoubleClickToSeek
                setEnableDoubleClickToSeek={() => undefined}
                enableAutoResumeOnPlaybackError={
                  state.enableAutoResumeOnPlaybackError.state
                }
                setEnableAutoResumeOnPlaybackError={
                  state.enableAutoResumeOnPlaybackError.set
                }
              />
            </div>
          )}
          {(searchQuery.trim() ||
            !selectedCategory ||
            selectedCategory === "settings-appearance") && (
            <div id="settings-appearance">
              <AppearancePart
                active={previewTheme ?? "default"}
                inUse={activeTheme ?? "default"}
                setTheme={setThemeWithPreview}
                customTheme={state.customTheme.state}
                setCustomTheme={state.customTheme.set}
              />
            </div>
          )}
          {(searchQuery.trim() ||
            !selectedCategory ||
            selectedCategory === "settings-captions") && (
            <div id="settings-captions">
              <CaptionsPart
                styling={state.subtitleStyling.state}
                setStyling={state.subtitleStyling.set}
                secondaryStyling={state.secondarySubtitleStyling.state}
                setSecondaryStyling={state.secondarySubtitleStyling.set}
              />
            </div>
          )}
          {(searchQuery.trim() ||
            !selectedCategory ||
            selectedCategory === "settings-torrent") && (
            <div id="settings-torrent">
              <TorrentPart />
            </div>
          )}
          {shouldShowConnections &&
            (searchQuery.trim() ||
              !selectedCategory ||
              selectedCategory === "settings-connection") && (
              <div id="settings-connection">
                <ConnectionsPart
                  tidbKey={state.tidbKey.state}
                  setTIDBKey={state.tidbKey.set}
                />
              </div>
            )}
        </SettingsLayout>
      </div>
      <Transition
        animation="fade"
        show={state.changed}
        className="bg-settings-saveBar-background border-t border-settings-card-border/50 py-4 transition-opacity w-full fixed bottom-0 flex justify-between flex-col md:flex-row px-8 items-start md:items-center gap-3 z-[999]"
      >
        <p className="text-type-danger">{t("settings.unsaved")}</p>
        <div className="space-x-3 w-full md:w-auto flex">
          <Button
            className="w-full md:w-auto"
            theme="secondary"
            onClick={state.reset}
          >
            {t("settings.reset")}
          </Button>
          <Button
            className="w-full md:w-auto"
            theme="purple"
            onClick={saveChanges}
          >
            {t("settings.save")}
          </Button>
        </div>
      </Transition>
      {account && (
        <Modal id={backendChangeModal.id}>
          <ModalCard>
            <Heading2 className="!mt-0 !mb-4">
              {t("settings.connections.server.changeWarningTitle")}
            </Heading2>
            <Paragraph className="!mt-1 !mb-6">
              {t("settings.connections.server.changeWarning")}
            </Paragraph>
            <div className="flex justify-end gap-3">
              <Button
                theme="secondary"
                onClick={() => {
                  backendChangeModal.hide();
                  setPendingBackendChange(null);
                  state.backendUrl.set(backendUrlSetting);
                }}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                theme="purple"
                onClick={async () => {
                  backendChangeModal.hide();
                  if (pendingBackendChange !== null) {
                    await logout();
                    setBackendUrl(pendingBackendChange);
                    setPendingBackendChange(null);
                  }
                }}
              >
                {t("actions.confirm")}
              </Button>
            </div>
          </ModalCard>
        </Modal>
      )}
    </SubPageLayout>
  );
}

export default SettingsPage;
