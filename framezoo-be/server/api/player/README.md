# Player Status API

This API allows for tracking and retrieving player status data for users in watch party rooms. Status data is automatically cleaned up if it's older than 30 minutes.

## Endpoints

### POST `/api/player/status`

Send a player status update.

**Request Body:**

```json
{
  "userId": "user123", // Required: User identifier
  "roomCode": "room456", // Required: Room code
  "isHost": true, // Optional: Whether the user is the host
  "content": {
    // Optional: Content information
    "title": "Movie Title",
    "type": "Movie", // "Movie", "TV Show", etc.
    "tmdbId": 12345, // Optional: TMDB ID for the content
    "seasonNumber": 1, // Optional: Season number (for TV shows)
    "episodeNumber": 3 // Optional: Episode number (for TV shows)
  },
  "player": {
    // Optional: Player state
    "isPlaying": true,
    "isPaused": false,
    "isLoading": false,
    "hasPlayedOnce": true,
    "time": 120.5, // Current playback position in seconds
    "duration": 3600, // Total content duration in seconds
    "volume": 0.8, // Volume level (0-1)
    "playbackRate": 1, // Playback speed
    "buffered": 180 // Buffered seconds
  }
}
```

**Response:**

```json
{
  "success": true,
  "timestamp": 1625097600000 // The timestamp assigned to this status update
}
```

### GET `/api/player/status?userId=user123&roomCode=room456`

Get status updates for a specific user in a specific room.

**Query Parameters:**

- `userId`: User identifier
- `roomCode`: Room code

**Response:**

```json
{
  "userId": "user123",
  "roomCode": "room456",
  "statuses": [
    {
      "userId": "user123",
      "roomCode": "room456",
      "isHost": true,
      "content": {
        "title": "Movie Title",
        "type": "Movie",
        "tmdbId": 12345,
        "seasonNumber": null,
        "episodeNumber": null
      },
      "player": {
        "isPlaying": true,
        "isPaused": false,
        "isLoading": false,
        "hasPlayedOnce": true,
        "time": 120.5,
        "duration": 3600,
        "volume": 0.8,
        "playbackRate": 1,
        "buffered": 180
      },
      "timestamp": 1625097600000
    }
    // More status updates if available
  ]
}
```

### GET `/api/player/status?roomCode=room456`

Get status updates for all users in a specific room.

**Query Parameters:**

- `roomCode`: Room code

**Response:**

```json
{
  "roomCode": "room456",
  "users": {
    "user123": [
      {
        "userId": "user123",
        "roomCode": "room456",
        "isHost": true,
        "content": {
          "title": "Show Title",
          "type": "TV Show",
          "tmdbId": 67890,
          "seasonNumber": 2,
          "episodeNumber": 5
        },
        "player": {
          "isPlaying": true,
          "isPaused": false,
          "isLoading": false,
          "hasPlayedOnce": true,
          "time": 120.5,
          "duration": 3600,
          "volume": 0.8,
          "playbackRate": 1,
          "buffered": 180
        },
        "timestamp": 1625097600000
      }
      // More status updates for this user if available
    ],
    "user456": [
      // Status updates for another user
    ]
  }
}
```

## Notes

- Status data is automatically cleaned up if it's older than 30 minutes
- The system keeps a maximum of 5 status updates per user per room
- Timestamps are in milliseconds since epoch (Unix timestamp)
