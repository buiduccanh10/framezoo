#if defined(__APPLE__)

#include "media_controls.h"

#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>

#include <mutex>
#include <string>
#include <vector>

namespace {

struct Target {
  MPRemoteCommand* command = nil;
  id token = nil;
};

std::mutex controls_mutex;
MediaCommandCallback controls_callback = nullptr;
void* controls_user = nullptr;
std::vector<Target> targets;

void emit_command(const char* command) {
  MediaCommandCallback callback = nullptr;
  void* user = nullptr;
  {
    std::lock_guard<std::mutex> lock(controls_mutex);
    callback = controls_callback;
    user = controls_user;
  }
  if (callback) callback(user, command);
}

void remove_targets() {
  for (const Target& target : targets) {
    if (target.command && target.token) {
      [target.command removeTarget:target.token];
    }
  }
  targets.clear();
}

void add_target(MPRemoteCommand* command, const char* name) {
  id token = [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(
      MPRemoteCommandEvent*) {
    emit_command(name);
    return MPRemoteCommandHandlerStatusSuccess;
  }];
  if (token) targets.push_back({command, token});
}

NSString* string_from_utf8(const std::string& value) {
  return value.empty()
      ? @""
      : [NSString stringWithUTF8String:value.c_str()];
}

}  // namespace

bool media_controls_register(
    void*,
    MediaCommandCallback callback,
    void* user,
    std::string* error
) {
  if (!callback) {
    if (error) *error = "media command callback is required";
    return false;
  }

  std::lock_guard<std::mutex> lock(controls_mutex);
  remove_targets();
  controls_callback = callback;
  controls_user = user;

  MPRemoteCommandCenter* center = [MPRemoteCommandCenter sharedCommandCenter];
  if (!center) {
    controls_callback = nullptr;
    controls_user = nullptr;
    if (error) *error = "MPRemoteCommandCenter unavailable";
    return false;
  }

  add_target(center.togglePlayPauseCommand, "toggle-play-pause");
  add_target(center.playCommand, "play");
  add_target(center.pauseCommand, "pause");
  add_target(center.nextTrackCommand, "next");
  add_target(center.previousTrackCommand, "previous");
  center.nextTrackCommand.enabled = NO;
  center.previousTrackCommand.enabled = NO;
  return true;
}

void media_controls_unregister() {
  std::lock_guard<std::mutex> lock(controls_mutex);
  remove_targets();
  controls_callback = nullptr;
  controls_user = nullptr;
}

bool media_controls_set_playback_state(bool playing, std::string* error) {
  MPNowPlayingInfoCenter* center = [MPNowPlayingInfoCenter defaultCenter];
  if (!center) {
    if (error) *error = "MPNowPlayingInfoCenter unavailable";
    return false;
  }
  center.playbackState = playing
      ? MPNowPlayingPlaybackStatePlaying
      : MPNowPlayingPlaybackStatePaused;
  return true;
}

bool media_controls_set_metadata(
    const std::string& title,
    const std::string& artist,
    const std::string& album_title,
    std::string* error
) {
  MPNowPlayingInfoCenter* center = [MPNowPlayingInfoCenter defaultCenter];
  if (!center) {
    if (error) *error = "MPNowPlayingInfoCenter unavailable";
    return false;
  }

  NSMutableDictionary* info = [NSMutableDictionary dictionary];
  NSString* title_value = string_from_utf8(title);
  NSString* artist_value = string_from_utf8(artist);
  NSString* album_value = string_from_utf8(album_title);
  if (title_value.length > 0) {
    info[MPMediaItemPropertyTitle] = title_value;
  }
  if (artist_value.length > 0) {
    info[MPMediaItemPropertyArtist] = artist_value;
  }
  if (album_value.length > 0) {
    info[MPMediaItemPropertyAlbumTitle] = album_value;
  }
  center.nowPlayingInfo = info;
  return true;
}

bool media_controls_set_navigation_availability(
    bool previous_enabled,
    bool next_enabled,
    std::string* error
) {
  MPRemoteCommandCenter* center = [MPRemoteCommandCenter sharedCommandCenter];
  if (!center) {
    if (error) *error = "MPRemoteCommandCenter unavailable";
    return false;
  }
  center.previousTrackCommand.enabled = previous_enabled;
  center.nextTrackCommand.enabled = next_enabled;
  return true;
}

#endif
