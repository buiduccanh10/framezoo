cmake_minimum_required(VERSION 3.20)

project(framezoo_libmpv_native LANGUAGES CXX)

if(NOT WIN32 AND NOT APPLE)
  message(FATAL_ERROR "framezoo-desktop native playback supports macOS and Windows only")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT DEFINED NODE_INCLUDE_DIR)
  message(FATAL_ERROR "NODE_INCLUDE_DIR is required")
endif()

add_library(libmpv MODULE
  src/addon.cpp
  src/mpv_dynamic.cpp
)

if(WIN32)
  target_sources(libmpv PRIVATE src/platform_surface_win.cpp src/win_delay_load_hook.cpp)
  target_link_libraries(libmpv PRIVATE opengl32 user32 gdi32 delayimp)
  if(NOT DEFINED NODE_LIB)
    message(FATAL_ERROR "NODE_LIB is required on Windows")
  endif()
  target_link_libraries(libmpv PRIVATE "${NODE_LIB}")
  if(MSVC)
    target_link_options(libmpv PRIVATE "/DELAYLOAD:node.exe")
  endif()
  set_target_properties(libmpv PROPERTIES PREFIX "" SUFFIX ".node")
else()
  enable_language(OBJCXX)
  target_sources(libmpv PRIVATE src/platform_surface_mac.mm)
  target_link_libraries(libmpv PRIVATE "-framework Cocoa" "-framework OpenGL")
  target_link_options(libmpv PRIVATE "-undefined" "dynamic_lookup")
  set_target_properties(libmpv PROPERTIES PREFIX "" SUFFIX ".node")
endif()

target_include_directories(libmpv PRIVATE
  ${NODE_INCLUDE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

if(DEFINED LIBMPV_ROOT)
  target_include_directories(libmpv PRIVATE "${LIBMPV_ROOT}/include")
  if(WIN32)
    target_link_directories(libmpv PRIVATE "${LIBMPV_ROOT}/lib" "${LIBMPV_ROOT}")
  else()
    target_link_directories(libmpv PRIVATE "${LIBMPV_ROOT}/lib" "${LIBMPV_ROOT}")
  endif()
endif()

target_compile_definitions(libmpv PRIVATE NAPI_VERSION=8)

if(MSVC)
  target_compile_options(libmpv PRIVATE /W4 /EHsc)
else()
  target_compile_options(libmpv PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(APPLE)
  set_target_properties(libmpv PROPERTIES
    BUILD_RPATH "@loader_path"
    INSTALL_RPATH "@loader_path"
  )
elseif(WIN32)
  set_target_properties(libmpv PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
  )
endif()
