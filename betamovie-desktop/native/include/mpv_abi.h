#pragma once

#include <stddef.h>
#include <stdint.h>

struct mpv_handle;
struct mpv_render_context;

enum mpv_format {
  MPV_FORMAT_NONE = 0,
  MPV_FORMAT_STRING = 1,
  MPV_FORMAT_OSD_STRING = 2,
  MPV_FORMAT_FLAG = 3,
  MPV_FORMAT_INT64 = 4,
  MPV_FORMAT_DOUBLE = 5,
  MPV_FORMAT_NODE = 6,
  MPV_FORMAT_NODE_ARRAY = 7,
  MPV_FORMAT_NODE_MAP = 8,
  MPV_FORMAT_BYTE_ARRAY = 9,
};

enum mpv_event_id {
  MPV_EVENT_NONE = 0,
  MPV_EVENT_SHUTDOWN = 1,
  MPV_EVENT_LOG_MESSAGE = 2,
  MPV_EVENT_START_FILE = 6,
  MPV_EVENT_END_FILE = 7,
  MPV_EVENT_FILE_LOADED = 8,
  MPV_EVENT_IDLE = 11,
  MPV_EVENT_VIDEO_RECONFIG = 17,
  MPV_EVENT_PROPERTY_CHANGE = 22,
};

enum mpv_render_param_type {
  MPV_RENDER_PARAM_INVALID = 0,
  MPV_RENDER_PARAM_API_TYPE = 1,
  MPV_RENDER_PARAM_OPENGL_INIT_PARAMS = 2,
  MPV_RENDER_PARAM_OPENGL_FBO = 3,
  MPV_RENDER_PARAM_FLIP_Y = 4,
};

struct mpv_node {
  union {
    char* string;
    int64_t int64;
    double double_;
    int flag;
    struct mpv_node_list* list;
    struct mpv_byte_array* ba;
  };
  int format;
};

struct mpv_node_list {
  int num;
  struct mpv_node* values;
  char** keys;
};

struct mpv_byte_array {
  void* data;
  size_t size;
};

struct mpv_event {
  int event_id;
  int error;
  uint64_t reply_userdata;
  void* data;
};

struct mpv_event_property {
  const char* name;
  int format;
  void* data;
};

struct mpv_event_end_file {
  int reason;
  int error;
  int64_t playlist_entry_id;
  int64_t playlist_insert_id;
  int playlist_insert_num_entries;
};

struct mpv_event_log_message {
  const char* prefix;
  const char* level;
  const char* text;
  int log_level;
};

struct mpv_opengl_init_params {
  void* (*get_proc_address)(void* ctx, const char* name);
  void* get_proc_address_ctx;
};

struct mpv_opengl_fbo {
  int fbo;
  int w;
  int h;
  int internal_format;
};

struct mpv_render_param {
  int type;
  void* data;
};

using mpv_wakeup_callback = void (*)(void* ctx);
using mpv_render_update_fn = void (*)(void* ctx);

static_assert(MPV_FORMAT_NODE_ARRAY == 7);
static_assert(MPV_FORMAT_NODE_MAP == 8);
static_assert(MPV_EVENT_LOG_MESSAGE == 2);
static_assert(MPV_EVENT_PROPERTY_CHANGE == 22);
static_assert(sizeof(mpv_event) == 24);
static_assert(sizeof(mpv_node) == 16);
