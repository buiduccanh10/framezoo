export interface SubtitleSettings {
  language: string;
  fontSize: number;
  delayMs: number;
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  language: 'en',
  fontSize: 18,
  delayMs: 0,
};
