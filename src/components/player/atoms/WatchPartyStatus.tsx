import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { useWatchPartySync } from "@/hooks/useWatchPartySync";
import { useAuthStore } from "@/stores/auth";
import { getProgressPercentage } from "@/stores/progress";
import { useWatchPartyStore } from "@/stores/watchParty";
import { getOrCreateWatchPartyParticipantId } from "@/utils/watchPartyParticipant";

export function WatchPartyStatus() {
  const { t } = useTranslation();
  const { enabled, roomCode, isHost, showStatusOverlay } = useWatchPartyStore();
  const [expanded, setExpanded] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [lastUserCount, setLastUserCount] = useState(1);
  const account = useAuthStore((s) => s.account);
  const currentParticipantId = useMemo(
    () => account?.userId ?? getOrCreateWatchPartyParticipantId(),
    [account?.userId],
  );

  const {
    roomUsers,
    hostUser,
    isBehindHost,
    isAheadOfHost,
    timeDifferenceFromHost,
    syncWithHost,
    isSyncing,
    userCount,
  } = useWatchPartySync();

  // Show notification when users join
  useEffect(() => {
    if (userCount === lastUserCount) return;

    if (userCount > lastUserCount) {
      setShowNotification(true);
      const timer = setTimeout(() => setShowNotification(false), 3000);
      setLastUserCount(userCount);
      return () => clearTimeout(timer);
    }

    setLastUserCount(userCount);
  }, [userCount, lastUserCount]);

  // If watch party is not enabled or overlay is hidden, don't show anything
  if (!enabled || !roomCode || !showStatusOverlay) return null;

  // Toggle expanded state
  const handleToggleExpanded = () => {
    setExpanded(!expanded);
  };

  // Get display name for a user (nickname if it's the current user, otherwise truncated userId)
  const getDisplayName = (
    nickname: string | undefined,
    participantId: string,
  ) => {
    if (currentParticipantId === participantId) {
      return t("watchParty.you");
    }
    if (nickname && nickname.trim().length > 0) {
      return nickname;
    }
    return t("watchParty.guestFallback");
  };

  return (
    <div
      className={`w-[280px] max-w-[calc(100vw-2rem)] rounded-xl border border-mediaCard-hoverAccent/25 bg-mediaCard-shadow/75 p-3 text-white text-xs backdrop-blur-md transition-all duration-300 ${
        showNotification
          ? "ring-1 ring-buttons-purple shadow-lg shadow-buttons-purple/40"
          : ""
      }`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon icon={Icons.WATCH_PARTY} className="h-4 w-4 text-type-logo" />
          <span className="font-semibold">
            {isHost ? t("watchParty.hosting") : t("watchParty.watching")}
          </span>
        </div>
        <span className="rounded-md bg-mediaCard-hoverBackground px-2 py-0.5 font-mono tracking-wider text-type-logo">
          {roomCode}
        </span>
      </div>

      <div className="mt-1 flex w-full items-center justify-between gap-2 text-type-secondary">
        <button
          type="button"
          className="rounded p-0.5 transition-colors hover:bg-mediaCard-hoverBackground"
          onClick={handleToggleExpanded}
          aria-label="Toggle room members"
        >
          <Icon
            icon={expanded ? Icons.CHEVRON_DOWN : Icons.CHEVRON_RIGHT}
            className="w-3 h-3"
          />
        </button>
        <span className="truncate">
          {roomUsers.length <= 1
            ? t("watchParty.alone")
            : t("watchParty.withCount", { count: roomUsers.length - 1 })}
        </span>

        {/* Sync status indicator */}
        {!isHost && hostUser && (
          <div className="flex items-center gap-1">
            <div
              className={`w-2 h-2 rounded-full ${
                isBehindHost || isAheadOfHost ? "bg-red-500" : "bg-green-500"
              }`}
            />
            <span className="text-xs">
              {isBehindHost || isAheadOfHost
                ? t("watchParty.status.outOfSync")
                : t("watchParty.status.inSync")}
            </span>
          </div>
        )}
      </div>

      {expanded && roomUsers.length > 1 && (
        <div className="mt-2 w-full border-t border-mediaCard-hoverBackground/70 pt-2">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-type-secondary">
            {t("watchParty.viewers", { count: roomUsers.length })}
          </div>
          <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
            {roomUsers.map((user) => (
              <div
                key={user.participantId}
                className="flex items-center justify-between rounded-md bg-mediaCard-hoverBackground/50 px-2 py-1.5 text-xs"
              >
                <span className="flex items-center gap-1">
                  <Icon
                    icon={user.isHost ? Icons.RISING_STAR : Icons.USER}
                    className={`h-3 w-3 ${user.isHost ? "text-onboarding-best" : "text-type-secondary"}`}
                  />
                  <span className={user.isHost ? "text-onboarding-best" : ""}>
                    {getDisplayName(user.nickname, user.participantId)}
                  </span>
                </span>
                <span className="text-type-secondary">
                  {user.player.duration > 0
                    ? `${Math.floor(getProgressPercentage(user.player.time, user.player.duration))}%`
                    : `${Math.floor(user.player.time)}s`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isHost && hostUser && (isBehindHost || isAheadOfHost) && (
        <div className="mt-2 w-full">
          <Button
            theme="secondary"
            className="flex w-full items-center justify-center gap-1 bg-buttons-purple/60 px-2 py-1 text-xs hover:bg-buttons-purpleHover/80"
            onClick={syncWithHost}
            disabled={isSyncing}
          >
            <Icon icon={Icons.CLOCK} className="w-3 h-3" />
            <span className="whitespace-nowrap">
              {isSyncing
                ? t("watchParty.syncing")
                : isBehindHost
                  ? t("watchParty.behindHost", {
                      seconds: Math.abs(Math.round(timeDifferenceFromHost)),
                    })
                  : t("watchParty.aheadOfHost", {
                      seconds: Math.round(timeDifferenceFromHost),
                    })}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
