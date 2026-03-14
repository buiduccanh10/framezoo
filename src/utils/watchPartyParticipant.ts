const WATCH_PARTY_PARTICIPANT_STORAGE_KEY = "__MW::watchPartyParticipantId";
const WATCH_PARTY_GUEST_NICKNAME_STORAGE_KEY = "__MW::watchPartyGuestNickname";

const generateParticipantId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `wp-${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2, 10);
  return `wp-${Date.now().toString(36)}-${random}`;
};

/**
 * Returns a stable participant id for this browser profile.
 * The id is persisted in localStorage and reused across sessions.
 */
export const getOrCreateWatchPartyParticipantId = (): string => {
  const existing = localStorage.getItem(WATCH_PARTY_PARTICIPANT_STORAGE_KEY);
  if (existing && existing.length > 0) {
    return existing;
  }

  const participantId = generateParticipantId();
  localStorage.setItem(WATCH_PARTY_PARTICIPANT_STORAGE_KEY, participantId);
  return participantId;
};

/**
 * Returns a stable nickname for anonymous watch-party participants.
 */
export const getOrCreateWatchPartyGuestNickname = (): string => {
  const existing = localStorage.getItem(WATCH_PARTY_GUEST_NICKNAME_STORAGE_KEY);
  if (existing && existing.length > 0) {
    return existing;
  }

  const participantId = getOrCreateWatchPartyParticipantId();
  const suffix = participantId.replace("wp-", "").slice(0, 4).toUpperCase();
  const nickname = `Guest-${suffix}`;
  localStorage.setItem(WATCH_PARTY_GUEST_NICKNAME_STORAGE_KEY, nickname);
  return nickname;
};
