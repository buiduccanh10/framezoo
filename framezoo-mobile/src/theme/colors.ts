export const colors = {
  background: '#030303',
  surface: '#0d0d0d',
  surfaceRaised: '#151515',
  surfaceHover: '#202020',
  border: '#313131',
  text: '#ffffff',
  textSecondary: '#b6b6b6',
  textDimmed: '#777777',
  accent: '#CF1F1F',
  accentStrong: '#B30000',
  success: '#60d26a',
  danger: '#f46e6e',
  warning: '#fff599',
  black: '#000000',
} as const;

export type ColorName = keyof typeof colors;
