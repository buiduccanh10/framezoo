#pragma once

#include <string>

#include "mpv_abi.h"

struct MpvApi {
  void* library = nullptr;

  mpv_handle* (*create)() = nullptr;
  int (*initialize)(mpv_handle*) = nullptr;
  int (*set_option_string)(mpv_handle*, const char*, const char*) = nullptr;
  int (*command)(mpv_handle*, const char* const*) = nullptr;
  mpv_event* (*wait_event)(mpv_handle*, double) = nullptr;
  int (*observe_property)(mpv_handle*, uint64_t, const char*, mpv_format) =
      nullptr;
  int (*get_property)(mpv_handle*, const char*, mpv_format, void*) = nullptr;
  char* (*get_property_string)(mpv_handle*, const char*) = nullptr;
  void (*free_node_contents)(mpv_node*) = nullptr;
  void (*free_memory)(void*) = nullptr;
  void (*terminate_destroy)(mpv_handle*) = nullptr;
  int (*request_log_messages)(mpv_handle*, const char*) = nullptr;

  int (*render_context_create)(
      mpv_render_context**,
      mpv_handle*,
      mpv_render_param*
  ) = nullptr;
  void (*render_context_free)(mpv_render_context*) = nullptr;
  void (*render_context_set_update_callback)(
      mpv_render_context*,
      mpv_render_update_fn,
      void*
  ) = nullptr;
  uint64_t (*render_context_update)(mpv_render_context*) = nullptr;
  int (*render_context_render)(mpv_render_context*, mpv_render_param*) =
      nullptr;
  void (*render_context_report_swap)(mpv_render_context*) = nullptr;

  bool load(std::string* error);
  void unload();
};
