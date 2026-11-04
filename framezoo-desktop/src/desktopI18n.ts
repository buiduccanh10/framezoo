import { app } from "electron";
import { locales, type Locales } from "@/assets/languages";

export type DesktopI18nKey =
  | "navigation.banner.appUpdate.newerVersionAvailableTitle"
  | "navigation.banner.appUpdate.newerVersionAvailable"
  | "navigation.banner.appUpdate.upToDateTitle"
  | "navigation.banner.appUpdate.upToDate"
  | "navigation.banner.appUpdate.updateFailedTitle"
  | "navigation.banner.appUpdate.downloadFailed"
  | "navigation.banner.appUpdate.checkFailed"
  | "update.newerVersionAvailableTitle"
  | "update.newerVersionAvailableMessage"
  | "update.upToDateTitle"
  | "update.upToDateMessage"
  | "update.updateFailedTitle"
  | "update.downloadFailedMessage"
  | "update.checkFailedMessage";

const KEY_ALIASES: Record<string, string> = {
  "update.newerVersionAvailableTitle":
    "navigation.banner.appUpdate.newerVersionAvailableTitle",
  "update.newerVersionAvailableMessage":
    "navigation.banner.appUpdate.newerVersionAvailable",
  "update.upToDateTitle": "navigation.banner.appUpdate.upToDateTitle",
  "update.upToDateMessage": "navigation.banner.appUpdate.upToDate",
  "update.updateFailedTitle": "navigation.banner.appUpdate.updateFailedTitle",
  "update.downloadFailedMessage": "navigation.banner.appUpdate.downloadFailed",
  "update.checkFailedMessage": "navigation.banner.appUpdate.checkFailed",
};

let activeDesktopLocale: string | null = null;

export function setDesktopLocale(locale: string) {
  if (typeof locale === "string" && locale.trim()) {
    activeDesktopLocale = locale.trim();
  }
}

export function resolveLocale(code: string): Locales {
  const normalized = code.trim();
  if (normalized in locales) return normalized as Locales;

  const base = normalized.split("-")[0]?.toLowerCase();
  if (base && base in locales) return base as Locales;

  // Try matching country prefix like pt-BR or zh-Hant
  const matchedKey = Object.keys(locales).find(
    (k) => k.toLowerCase() === normalized.toLowerCase(),
  );
  if (matchedKey) return matchedKey as Locales;

  const prefixMatch = Object.keys(locales).find(
    (k) => k.toLowerCase().split("-")[0] === base,
  );
  if (prefixMatch) return prefixMatch as Locales;

  return "en";
}

export function getDesktopLocale(): string {
  if (activeDesktopLocale) return resolveLocale(activeDesktopLocale);
  try {
    const sysLocale = app.getLocale();
    if (sysLocale) {
      return resolveLocale(sysLocale);
    }
  } catch {
    // Ignore error if app is not yet ready or in mock test environment
  }
  return "en";
}

function getNestedValue(obj: any, path: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return key in params ? String(params[key]) : `{{${key}}}`;
  });
}

export function tDesktop(
  key: DesktopI18nKey,
  params?: Record<string, string | number>,
  fallback?: string,
): string {
  const canonicalPath = KEY_ALIASES[key] ?? key;
  const localeKey = getDesktopLocale() as Locales;
  const localeDict = locales[localeKey];
  const enDict = locales.en;

  const raw =
    getNestedValue(localeDict, canonicalPath) ??
    getNestedValue(enDict, canonicalPath) ??
    fallback ??
    canonicalPath;

  return interpolate(raw, params);
}
