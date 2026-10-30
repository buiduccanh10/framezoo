import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { SubtitleStyling } from "@/stores/subtitles";
import { usePreviewThemeStore, useThemeStore } from "@/stores/theme";

export function useDerived<T>(
  initial: T,
): [T, Dispatch<SetStateAction<T>>, () => void, boolean] {
  const [overwrite, setOverwrite] = useState<T | undefined>(undefined);
  useEffect(() => {
    setOverwrite(undefined);
  }, [initial]);
  const changed = useMemo(
    () =>
      JSON.stringify(overwrite) !== JSON.stringify(initial) &&
      overwrite !== undefined,
    [overwrite, initial],
  );
  const setter = useCallback<Dispatch<SetStateAction<T>>>(
    (inp) => {
      if (!(inp instanceof Function)) setOverwrite(inp);
      else setOverwrite((s) => inp(s !== undefined ? s : initial));
    },
    [initial, setOverwrite],
  );
  const data = overwrite === undefined ? initial : overwrite;

  const reset = useCallback(() => setOverwrite(undefined), [setOverwrite]);

  return [data, setter, reset, changed];
}

export interface ProfileSettings {
  colorA: string;
  colorB: string;
  icon: string;
}

export function useSettingsState(
  theme: string | null,
  appLanguage: string,
  subtitleStyling: SubtitleStyling,
  secondarySubtitleStyling: SubtitleStyling,
  deviceName: string,
  nickname: string,
  backendUrl: string | null,
  profile: ProfileSettings | undefined,
  enableAutoplay: boolean,
  enableSkipCredits: boolean,
  enableAutoSkipSegments: boolean,
  proxyTmdb: boolean,
  customTheme: {
    primary: string;
    secondary: string;
    tertiary: string;
  },
  homeSectionOrder: string[],
) {
  const [backendUrlState, setBackendUrl, resetBackendUrl, backendUrlChanged] =
    useDerived(backendUrl);
  const [themeState, setTheme, resetTheme, themeChanged] = useDerived(theme);
  const setPreviewTheme = usePreviewThemeStore((s) => s.setPreviewTheme);
  const resetPreviewTheme = useCallback(
    () => setPreviewTheme(theme),
    [setPreviewTheme, theme],
  );
  const [
    appLanguageState,
    setAppLanguage,
    resetAppLanguage,
    appLanguageChanged,
  ] = useDerived(appLanguage);
  const [
    subStylingState,
    setSubStyling,
    resetSubStyling,
    subStylingChanged,
  ] = useDerived(subtitleStyling);
  const [
    secondarySubStylingState,
    setSecondarySubStyling,
    resetSecondarySubStyling,
    secondarySubStylingChanged,
  ] = useDerived(secondarySubtitleStyling);
  const [
    deviceNameState,
    setDeviceNameState,
    resetDeviceName,
    deviceNameChanged,
  ] = useDerived(deviceName);
  const [nicknameState, setNicknameState, resetNickname, nicknameChanged] =
    useDerived(nickname);
  const [profileState, setProfileState, resetProfile, profileChanged] =
    useDerived(profile);

  const [
    enableAutoplayState,
    setEnableAutoplayState,
    resetEnableAutoplay,
    enableAutoplayChanged,
  ] = useDerived(enableAutoplay);
  const [
    enableSkipCreditsState,
    setEnableSkipCreditsState,
    resetEnableSkipCredits,
    enableSkipCreditsChanged,
  ] = useDerived(enableSkipCredits);
  const [
    enableAutoSkipSegmentsState,
    setEnableAutoSkipSegmentsState,
    resetEnableAutoSkipSegments,
    enableAutoSkipSegmentsChanged,
  ] = useDerived(enableAutoSkipSegments);

  const [
    proxyTmdbState,
    setProxyTmdbState,
    resetProxyTmdb,
    proxyTmdbChanged,
  ] = useDerived(proxyTmdb);
  const [
    customThemeState,
    setCustomThemeState,
    resetCustomTheme,
    customThemeChanged,
  ] = useDerived(customTheme);
  const [
    homeSectionOrderState,
    setHomeSectionOrderState,
    resetHomeSectionOrder,
    homeSectionOrderChanged,
  ] = useDerived(homeSectionOrder);
  const setCustomThemeStore = useThemeStore((s) => s.setCustomTheme);

  function reset() {
    resetTheme();
    resetPreviewTheme();
    resetAppLanguage();
    resetSubStyling();
    resetSecondarySubStyling();
    resetBackendUrl();
    resetDeviceName();
    resetNickname();
    resetProfile();

    resetEnableAutoplay();
    resetEnableSkipCredits();
    resetEnableAutoSkipSegments();

    resetProxyTmdb();
    resetCustomTheme();
    resetHomeSectionOrder();
  }

  const changed =
    themeChanged ||
    appLanguageChanged ||
    subStylingChanged ||
    secondarySubStylingChanged ||
    deviceNameChanged ||
    nicknameChanged ||
    backendUrlChanged ||
    profileChanged ||
    enableAutoplayChanged ||
    enableSkipCreditsChanged ||
    enableAutoSkipSegmentsChanged ||
    proxyTmdbChanged ||
    customThemeChanged ||
    homeSectionOrderChanged;

  return {
    reset,
    changed,
    theme: {
      state: themeState,
      set: setTheme,
      changed: themeChanged,
    },
    appLanguage: {
      state: appLanguageState,
      set: setAppLanguage,
      changed: appLanguageChanged,
    },
    subtitleStyling: {
      state: subStylingState,
      set: setSubStyling,
      changed: subStylingChanged,
    },
    secondarySubtitleStyling: {
      state: secondarySubStylingState,
      set: setSecondarySubStyling,
      changed: secondarySubStylingChanged,
    },
    deviceName: {
      state: deviceNameState,
      set: setDeviceNameState,
      changed: deviceNameChanged,
    },
    nickname: {
      state: nicknameState,
      set: setNicknameState,
      changed: nicknameChanged,
    },
    backendUrl: {
      state: backendUrlState,
      set: setBackendUrl,
      changed: backendUrlChanged,
    },
    profile: {
      state: profileState,
      set: setProfileState,
      changed: profileChanged,
    },

    enableAutoplay: {
      state: enableAutoplayState,
      set: setEnableAutoplayState,
      changed: enableAutoplayChanged,
    },
    enableSkipCredits: {
      state: enableSkipCreditsState,
      set: setEnableSkipCreditsState,
      changed: enableSkipCreditsChanged,
    },
    enableAutoSkipSegments: {
      state: enableAutoSkipSegmentsState,
      set: setEnableAutoSkipSegmentsState,
      changed: enableAutoSkipSegmentsChanged,
    },
    proxyTmdb: {
      state: proxyTmdbState,
      set: setProxyTmdbState,
      changed: proxyTmdbChanged,
    },
    customTheme: {
      state: customThemeState,
      set: (v: { primary: string; secondary: string; tertiary: string }) => {
        setCustomThemeState(v);
        setCustomThemeStore(v);
      },
      changed: customThemeChanged,
    },
    homeSectionOrder: {
      state: homeSectionOrderState,
      set: setHomeSectionOrderState,
      changed: homeSectionOrderChanged,
    },
  };
}
