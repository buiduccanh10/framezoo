#if defined(_WIN32)

#include "media_controls.h"

#include <windows.h>
#include <eventtoken.h>
#include <windows.media.h>
#include <SystemMediaTransportControlsInterop.h>
#include <roapi.h>
#include <wrl.h>
#include <wrl/event.h>
#include <wrl/wrappers/corewrappers.h>

#include <mutex>
#include <string>

namespace {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using ::EventRegistrationToken;
using ABI::Windows::Media::ISystemMediaTransportControls;
using ABI::Windows::Media::ISystemMediaTransportControlsButtonPressedEventArgs;
using ABI::Windows::Media::ISystemMediaTransportControlsDisplayUpdater;
using ABI::Windows::Media::IVideoDisplayProperties;
using ABI::Windows::Media::SystemMediaTransportControlsButton;
using ABI::Windows::Media::SystemMediaTransportControlsButton_Next;
using ABI::Windows::Media::SystemMediaTransportControlsButton_Pause;
using ABI::Windows::Media::SystemMediaTransportControlsButton_Play;
using ABI::Windows::Media::SystemMediaTransportControlsButton_Previous;
using ABI::Windows::Media::MediaPlaybackStatus_Paused;
using ABI::Windows::Media::MediaPlaybackStatus_Playing;
using ABI::Windows::Media::MediaPlaybackType_Video;
using ButtonPressedHandler =
    __FITypedEventHandler_2_Windows__CMedia__CSystemMediaTransportControls_Windows__CMedia__CSystemMediaTransportControlsButtonPressedEventArgs;

using ::ISystemMediaTransportControlsInterop;

std::mutex controls_mutex;
ComPtr<ISystemMediaTransportControls> controls;
ComPtr<ButtonPressedHandler> button_handler;
EventRegistrationToken button_token{};
MediaCommandCallback controls_callback = nullptr;
void* controls_user = nullptr;
bool ro_initialized = false;

std::wstring utf8_to_wide(const std::string& value) {
  if (value.empty()) return {};
  const int length = MultiByteToWideChar(
      CP_UTF8,
      MB_ERR_INVALID_CHARS,
      value.data(),
      static_cast<int>(value.size()),
      nullptr,
      0
  );
  if (length <= 0) return {};
  std::wstring result(static_cast<size_t>(length), L'\0');
  if (MultiByteToWideChar(
          CP_UTF8,
          MB_ERR_INVALID_CHARS,
          value.data(),
          static_cast<int>(value.size()),
          result.data(),
          length
      ) != length) {
    return {};
  }
  return result;
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

HRESULT on_button_pressed(
    ISystemMediaTransportControls*,
    ISystemMediaTransportControlsButtonPressedEventArgs* args
) {
  if (!args) return E_INVALIDARG;
  SystemMediaTransportControlsButton button{};
  HRESULT result = args->get_Button(&button);
  if (FAILED(result)) return result;

  switch (button) {
    case SystemMediaTransportControlsButton_Play:
      emit_command("play");
      break;
    case SystemMediaTransportControlsButton_Pause:
      emit_command("pause");
      break;
    case SystemMediaTransportControlsButton_Next:
      emit_command("next");
      break;
    case SystemMediaTransportControlsButton_Previous:
      emit_command("previous");
      break;
    default:
      break;
  }
  return S_OK;
}

bool ensure_ro_initialized(std::string* error) {
  if (ro_initialized) return true;
  const HRESULT result = RoInitialize(RO_INIT_MULTITHREADED);
  if (result == RPC_E_CHANGED_MODE) {
    // Electron may have initialized this thread as STA already. WinRT calls
    // remain valid; only skip the matching uninitialize in that case.
    ro_initialized = false;
    return true;
  }
  if (FAILED(result)) {
    if (error) *error = "RoInitialize failed: " + std::to_string(result);
    return false;
  }
  ro_initialized = true;
  return true;
}

}  // namespace

bool media_controls_register(
    void* window_handle,
    MediaCommandCallback callback,
    void* user,
    std::string* error
) {
  if (!window_handle) {
    if (error) *error = "media window handle is required";
    return false;
  }
  if (!callback) {
    if (error) *error = "media command callback is required";
    return false;
  }

  std::lock_guard<std::mutex> lock(controls_mutex);
  if (!ensure_ro_initialized(error)) return false;

  if (controls && button_handler) {
    controls->remove_ButtonPressed(button_token);
    button_handler.Reset();
    controls.Reset();
  }

  ComPtr<ISystemMediaTransportControlsInterop> interop;
  const HRESULT factory_result =
      RoGetActivationFactory(
          Microsoft::WRL::Wrappers::HStringReference(
              RuntimeClass_Windows_Media_SystemMediaTransportControls
          ).Get(),
          IID_PPV_ARGS(&interop)
      );
  if (FAILED(factory_result)) {
    if (error) *error = "SMTC activation failed: " + std::to_string(factory_result);
    return false;
  }

  const HRESULT window_result = interop->GetForWindow(
      static_cast<HWND>(window_handle),
      IID_PPV_ARGS(&controls)
  );
  if (FAILED(window_result)) {
    if (error) *error = "SMTC window binding failed: " + std::to_string(window_result);
    controls.Reset();
    return false;
  }

  auto handler = Callback<ButtonPressedHandler>(&on_button_pressed);
  if (!handler) {
    if (error) *error = "SMTC button handler allocation failed";
    controls.Reset();
    return false;
  }
  const HRESULT handler_result = controls->add_ButtonPressed(
      handler.Get(),
      &button_token
  );
  if (FAILED(handler_result)) {
    if (error) *error = "SMTC button handler registration failed: " +
        std::to_string(handler_result);
    controls.Reset();
    return false;
  }
  button_handler = handler;
  controls_callback = callback;
  controls_user = user;

  controls->put_IsEnabled(TRUE);
  controls->put_IsPlayEnabled(TRUE);
  controls->put_IsPauseEnabled(TRUE);
  controls->put_IsNextEnabled(FALSE);
  controls->put_IsPreviousEnabled(FALSE);
  controls->put_PlaybackStatus(MediaPlaybackStatus_Paused);
  return true;
}

void media_controls_unregister() {
  std::lock_guard<std::mutex> lock(controls_mutex);
  if (controls && button_handler) {
    controls->remove_ButtonPressed(button_token);
  }
  button_handler.Reset();
  controls.Reset();
  controls_callback = nullptr;
  controls_user = nullptr;
  if (ro_initialized) {
    RoUninitialize();
    ro_initialized = false;
  }
}

bool media_controls_set_playback_state(bool playing, std::string* error) {
  std::lock_guard<std::mutex> lock(controls_mutex);
  if (!controls) {
    if (error) *error = "SMTC is not registered";
    return false;
  }
  const HRESULT result = controls->put_PlaybackStatus(
      playing
          ? MediaPlaybackStatus_Playing
          : MediaPlaybackStatus_Paused
  );
  if (FAILED(result)) {
    if (error) *error = "SMTC playback state failed: " + std::to_string(result);
    return false;
  }
  return true;
}

bool media_controls_set_metadata(
    const std::string& title,
    const std::string& artist,
    const std::string& album_title,
    std::string* error
) {
  std::lock_guard<std::mutex> lock(controls_mutex);
  if (!controls) {
    if (error) *error = "SMTC is not registered";
    return false;
  }

  ComPtr<ISystemMediaTransportControlsDisplayUpdater> display_updater;
  HRESULT result = controls->get_DisplayUpdater(&display_updater);
  if (FAILED(result)) {
    if (error) {
      *error = "SMTC display updater failed: " + std::to_string(result);
    }
    return false;
  }

  result = display_updater->put_Type(MediaPlaybackType_Video);
  if (FAILED(result)) {
    if (error) {
      *error = "SMTC display type failed: " + std::to_string(result);
    }
    return false;
  }

  ComPtr<IVideoDisplayProperties> video_properties;
  result = display_updater->get_VideoProperties(&video_properties);
  if (FAILED(result)) {
    if (error) {
      *error = "SMTC video properties failed: " + std::to_string(result);
    }
    return false;
  }

  const std::wstring title_value = utf8_to_wide(title);
  const std::wstring artist_value = utf8_to_wide(artist);
  const std::wstring album_value = utf8_to_wide(album_title);
  if ((!title.empty() && title_value.empty()) ||
      (!artist.empty() && artist_value.empty()) ||
      (!album_title.empty() && album_value.empty())) {
    if (error) *error = "SMTC metadata contains invalid UTF-8";
    return false;
  }

  result = video_properties->put_Title(
      Microsoft::WRL::Wrappers::HStringReference(title_value.c_str()).Get()
  );
  if (SUCCEEDED(result)) {
    std::wstring subtitle = artist_value;
    if (!artist_value.empty() && !album_value.empty()) subtitle += L" - ";
    subtitle += album_value;
    result = video_properties->put_Subtitle(
        Microsoft::WRL::Wrappers::HStringReference(subtitle.c_str()).Get()
    );
  }
  if (FAILED(result)) {
    if (error) *error = "SMTC metadata update failed: " + std::to_string(result);
    return false;
  }

  result = display_updater->Update();
  if (FAILED(result)) {
    if (error) *error = "SMTC metadata commit failed: " + std::to_string(result);
    return false;
  }
  return true;
}

bool media_controls_set_navigation_availability(
    bool previous_enabled,
    bool next_enabled,
    std::string* error
) {
  std::lock_guard<std::mutex> lock(controls_mutex);
  if (!controls) {
    if (error) *error = "SMTC is not registered";
    return false;
  }
  HRESULT result = controls->put_IsPreviousEnabled(previous_enabled ? TRUE : FALSE);
  if (SUCCEEDED(result)) {
    result = controls->put_IsNextEnabled(next_enabled ? TRUE : FALSE);
  }
  if (FAILED(result)) {
    if (error) {
      *error = "SMTC navigation availability failed: " + std::to_string(result);
    }
    return false;
  }
  return true;
}

#endif
