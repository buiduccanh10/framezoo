import { colors } from './colors';

export interface AppTheme {
  id: string;
  name: string;
  colors: typeof colors;
}

export const themes: AppTheme[] = [
  { id: 'ember', name: 'Ember', colors },
];

export const defaultTheme = themes[0];
