#if defined(__APPLE__)

#include "media_controls.h"

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>
#import <IOKit/pwr_mgt/IOPMLib.h>

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
IOPMAssertionID display_assertion = kIOPMNullAssertionID;
id<NSObject> process_activity = nil;

void acquire_display_sleep_assertion() {
  if (display_assertion == kIOPMNullAssertionID) {
    IOPMAssertionCreateWithName(
        kIOPMAssertionTypePreventUserIdleDisplaySleep,
        kIOPMAssertionLevelOn,
        CFSTR("Framezoo video playback"),
        &display_assertion
    );
  }
  if (!process_activity) {
    process_activity = [[[NSProcessInfo processInfo]
        beginActivityWithOptions:(NSActivityIdleDisplaySleepDisabled |
                                 NSActivityIdleSystemSleepDisabled |
                                 NSActivityUserInitiated)
                          reason:@"Framezoo video playback"] retain];
  }
}

void release_display_sleep_assertion() {
  if (display_assertion != kIOPMNullAssertionID) {
    IOPMAssertionRelease(display_assertion);
    display_assertion = kIOPMNullAssertionID;
  }
  if (process_activity) {
    [[NSProcessInfo processInfo] endActivity:process_activity];
    [process_activity release];
    process_activity = nil;
  }
}

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
  release_display_sleep_assertion();
  controls_callback = nullptr;
  controls_user = nullptr;
}

bool media_controls_set_playback_state(bool playing, std::string* error) {
  std::lock_guard<std::mutex> lock(controls_mutex);
  if (playing) {
    acquire_display_sleep_assertion();
  } else {
    release_display_sleep_assertion();
  }

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
    const std::string& artwork_path,
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
  if (!artwork_path.empty()) {
    const std::string normalized_path = artwork_path;
    NSString* path_value = string_from_utf8(normalized_path);
    NSImage* image = path_value.length > 0
        ? [[NSImage alloc] initWithContentsOfFile:path_value]
        : nil;
    if (image) {
      MPMediaItemArtwork* artwork = [[MPMediaItemArtwork alloc]
          initWithBoundsSize:image.size
              requestHandler:^NSImage*(NSSize) { return image; }];
      if (artwork) info[MPMediaItemPropertyArtwork] = artwork;
    }
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
