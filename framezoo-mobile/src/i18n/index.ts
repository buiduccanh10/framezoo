import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  fallbackLng: 'en',
  lng: 'en',
  resources: {
    en: {
      translation: {
        appName: 'Framezoo',
        retry: 'Retry',
      },
    },
  },
});

export default i18n;
