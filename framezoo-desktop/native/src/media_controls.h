#pragma once

#include <string>

using MediaCommandCallback = void (*)(void* user, const char* command);

bool media_controls_register(
    void* window_handle,
    MediaCommandCallback callback,
    void* user,
    std::string* error
);

void media_controls_unregister();

bool media_controls_set_playback_state(bool playing, std::string* error);

bool media_controls_set_metadata(
    const std::string& title,
    const std::string& artist,
    const std::string& album_title,
    const std::string& artwork_path,
    std::string* error
);

bool media_controls_set_navigation_availability(
    bool previous_enabled,
    bool next_enabled,
    std::string* error
);
