export const CURRENT_TERMS_VERSION = '2026-11';
export const CURRENT_PRIVACY_VERSION = '2026-11';

export const FEEDBACK_CATEGORIES = [
  'bug',
  'feature',
  'copyright',
  'privacy',
  'other',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const TAKEDOWN_TARGET_TYPES = [
  'addon_domain',
  'tmdb_id',
  'imdb_id',
  'subtitle_id',
  'infohash',
] as const;

export type TakedownTargetType = (typeof TAKEDOWN_TARGET_TYPES)[number];

// Vietnam Decree 17/2023 & PDPD Law 91/2025: process copyright/privacy requests within 24h SLA.
export const COMPLIANCE_SLA_HOURS = 24;

export function normalizeFeedbackCategory(raw: unknown): FeedbackCategory {
  if (typeof raw !== 'string') return 'bug';
  const normalized = raw.trim().toLowerCase();
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(normalized)
    ? (normalized as FeedbackCategory)
    : 'bug';
}

export function computeFeedbackSlaDueAt(
  category: FeedbackCategory,
  createdAt: Date = new Date()
): Date | null {
  if (category !== 'copyright' && category !== 'privacy') return null;
  return new Date(createdAt.getTime() + COMPLIANCE_SLA_HOURS * 60 * 60 * 1000);
}
