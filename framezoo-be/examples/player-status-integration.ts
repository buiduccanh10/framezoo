// Example frontend implementation for the player status API

/**
 * Function to send player status to the backend
 */
export async function sendPlayerStatus({
  userId,
  roomCode,
  isHost,
  content,
  player,
}: {
  userId: string;
  roomCode: string;
  isHost: boolean;
  content: {
    title: string;
    type: string;
  };
  player: {
    isPlaying: boolean;
    isPaused: boolean;
    isLoading: boolean;
    hasPlayedOnce: boolean;
    time: number;
    duration: number;
    volume: number;
    playbackRate: number;
    buffered: number;
  };
}) {
  try {
    const response = await fetch('/api/player/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        roomCode,
        isHost,
        content,
        player,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send player status: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Successfully sent player status update', data);
    return data;
  } catch (error) {
    console.error('Error sending player status:', error);
    throw error;
  }
}

/**
 * Function to get player status for a specific user in a room
 */
export async function getPlayerStatus(userId: string, roomCode: string) {
  try {
    const response = await fetch(`/api/player/status?userId=${userId}&roomCode=${roomCode}`);

    if (!response.ok) {
      throw new Error(`Failed to get player status: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Retrieved player status data:', data);
    return data;
  } catch (error) {
    console.error('Error getting player status:', error);
    throw error;
  }
}

/**
 * Function to get status for all users in a room
 */
export async function getRoomStatuses(roomCode: string) {
  try {
    const response = await fetch(`/api/player/status?roomCode=${roomCode}`);

    if (!response.ok) {
      throw new Error(`Failed to get room statuses: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Retrieved room statuses data:', data);
    return data;
  } catch (error) {
    console.error('Error getting room statuses:', error);
    throw error;
  }
}

/**
 * Example implementation for updating WebhookReporter to use the API
 */
export function ModifiedWebhookReporter() {
  // Example replacing the Discord webhook code
  /*
  useEffect(() => {
    // Skip if watch party is not enabled or no status
    if (!watchPartyEnabled || !latestStatus || !latestStatus.hasPlayedOnce) return;

    const now = Date.now();

    // Create a state fingerprint to detect meaningful changes
    const stateFingerprint = JSON.stringify({
      isPlaying: latestStatus.isPlaying,
      isPaused: latestStatus.isPaused,
      isLoading: latestStatus.isLoading,
      time: Math.floor(latestStatus.time / 5) * 5, // Round to nearest 5 seconds
      volume: Math.round(latestStatus.volume * 100),
      playbackRate: latestStatus.playbackRate,
    });

    // Check if state has changed meaningfully AND
    // it's been at least 5 seconds since last report
    const hasStateChanged = stateFingerprint !== lastReportedStateRef.current;
    const timeThresholdMet = now - lastReportTime.current >= 5000;

    if (!hasStateChanged && !timeThresholdMet) return;

    let contentTitle = "Unknown content";
    let contentType = "";

    if (meta) {
      if (meta.type === "movie") {
        contentTitle = meta.title;
        contentType = "Movie";
      } else if (meta.type === "show" && meta.episode) {
        contentTitle = `${meta.title} - S${meta.season?.number || 0}E${meta.episode.number || 0}`;
        contentType = "TV Show";
      }
    }

    // Send to our backend instead of Discord
    const sendToBackend = async () => {
      try {
        await sendPlayerStatus({
          userId,
          roomCode: roomCode || 'none',
          isHost: isHost || false,
          content: {
            title: contentTitle,
            type: contentType || 'Unknown',
          },
          player: {
            isPlaying: latestStatus.isPlaying,
            isPaused: latestStatus.isPaused,
            isLoading: latestStatus.isLoading,
            hasPlayedOnce: latestStatus.hasPlayedOnce,
            time: latestStatus.time,
            duration: latestStatus.duration,
            volume: latestStatus.volume,
            playbackRate: latestStatus.playbackRate,
            buffered: latestStatus.buffered,
          },
        });

        // Update last report time and fingerprint
        lastReportTime.current = now;
        lastReportedStateRef.current = stateFingerprint;

        console.log("Sent player status update to backend", {
          time: new Date().toISOString(),
          isPlaying: latestStatus.isPlaying,
          currentTime: Math.floor(latestStatus.time),
          userId,
          content: contentTitle,
          roomCode,
        });
      } catch (error) {
        console.error("Failed to send player status to backend", error);
      }
    };

    sendToBackend();
  }, [
    latestStatus,
    statusHistory.length,
    userId,
    account,
    meta,
    watchPartyEnabled,
    roomCode,
    isHost,
  ]);
  */
}
