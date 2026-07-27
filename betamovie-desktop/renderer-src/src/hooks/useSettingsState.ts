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

export function useSettingsState(
  theme: string | null,
  appLanguage: string,
  subtitleStyling: SubtitleStyling,
  deviceName: string,
  nickname: string,
  proxyUrls: string[] | null,
  backendUrl: string | null,
  febboxKey: string | null,
  debridToken: string | null,
  debridService: string,
  tidbKey: string | null,
  profile:
    | {
        colorA: string;
        colorB: string;
        icon: string;
      }
    | undefined,
  enableAutoplay: boolean,
  enableSkipCredits: boolean,
  enableAutoSkipSegments: boolean,
  proxyTmdb: boolean,
  enableDoubleClickToSeek: boolean,
  enableAutoResumeOnPlaybackError: boolean,
  customTheme: {
    primary: string;
    secondary: string;
    tertiary: string;
  },
) {
  const [proxyUrlsState, setProxyUrls, resetProxyUrls, proxyUrlsChanged] =
    useDerived(proxyUrls);
  const [backendUrlState, setBackendUrl, resetBackendUrl, backendUrlChanged] =
    useDerived(backendUrl);
  const [febboxKeyState, setFebboxKey, resetFebboxKey, febboxKeyChanged] =
    useDerived(febboxKey);
  const [
    debridTokenState,
    setdebridToken,
    resetdebridToken,
    debridTokenChanged,
  ] = useDerived(debridToken);
  const [
    debridServiceState,
    setdebridService,
    _resetdebridService,
    debridServiceChanged,
  ] = useDerived(debridService);
  const [tidbKeyState, setTIDBKey, resetTIDBKey, tidbKeyChanged] =
    useDerived(tidbKey);
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
  const [subStylingState, setSubStyling, resetSubStyling, subStylingChanged] =
    useDerived(subtitleStyling);
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
  const [proxyTmdbState, setProxyTmdbState, resetProxyTmdb, proxyTmdbChanged] =
    useDerived(proxyTmdb);
  const [
    enableDoubleClickToSeekState,
    setEnableDoubleClickToSeekState,
    resetEnableDoubleClickToSeek,
    enableDoubleClickToSeekChanged,
  ] = useDerived(enableDoubleClickToSeek);
  const [
    enableAutoResumeOnPlaybackErrorState,
    setEnableAutoResumeOnPlaybackErrorState,
    resetEnableAutoResumeOnPlaybackError,
    enableAutoResumeOnPlaybackErrorChanged,
  ] = useDerived(enableAutoResumeOnPlaybackError);
  const [
    customThemeState,
    setCustomThemeState,
    resetCustomTheme,
    customThemeChanged,
  ] = useDerived(customTheme);
  const setCustomThemeStore = useThemeStore((s) => s.setCustomTheme);

  function reset() {
    resetTheme();
    resetPreviewTheme();
    resetAppLanguage();
    resetSubStyling();
    resetProxyUrls();
    resetBackendUrl();
    resetFebboxKey();
    resetdebridToken();
    resetTIDBKey();
    resetDeviceName();
    resetNickname();
    resetProfile();

    resetEnableAutoplay();
    resetEnableSkipCredits();
    resetEnableAutoSkipSegments();

    resetProxyTmdb();
    resetEnableDoubleClickToSeek();
    resetEnableAutoResumeOnPlaybackError();
    resetCustomTheme();
  }

  const changed =
    themeChanged ||
    appLanguageChanged ||
    subStylingChanged ||
    deviceNameChanged ||
    nicknameChanged ||
    backendUrlChanged ||
    proxyUrlsChanged ||
    febboxKeyChanged ||
    debridTokenChanged ||
    debridServiceChanged ||
    tidbKeyChanged ||
    profileChanged ||
    enableAutoplayChanged ||
    enableSkipCreditsChanged ||
    enableAutoSkipSegmentsChanged ||
    proxyTmdbChanged ||
    enableDoubleClickToSeekChanged ||
    enableAutoResumeOnPlaybackErrorChanged ||
    customThemeChanged;

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
    proxyUrls: {
      state: proxyUrlsState,
      set: setProxyUrls,
      changed: proxyUrlsChanged,
    },
    backendUrl: {
      state: backendUrlState,
      set: setBackendUrl,
      changed: backendUrlChanged,
    },
    febboxKey: {
      state: febboxKeyState,
      set: setFebboxKey,
      changed: febboxKeyChanged,
    },
    debridToken: {
      state: debridTokenState,
      set: setdebridToken,
      changed: debridTokenChanged,
    },
    debridService: {
      state: debridServiceState,
      set: setdebridService,
      changed: debridServiceChanged,
    },
    tidbKey: {
      state: tidbKeyState,
      set: setTIDBKey,
      changed: tidbKeyChanged,
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
    enableDoubleClickToSeek: {
      state: enableDoubleClickToSeekState,
      set: setEnableDoubleClickToSeekState,
      changed: enableDoubleClickToSeekChanged,
    },
    enableAutoResumeOnPlaybackError: {
      state: enableAutoResumeOnPlaybackErrorState,
      set: setEnableAutoResumeOnPlaybackErrorState,
      changed: enableAutoResumeOnPlaybackErrorChanged,
    },
    customTheme: {
      state: customThemeState,
      set: (v: { primary: string; secondary: string; tertiary: string }) => {
        setCustomThemeState(v);
        setCustomThemeStore(v);
      },
      changed: customThemeChanged,
    },
  };
}
