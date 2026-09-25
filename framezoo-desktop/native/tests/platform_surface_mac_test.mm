#if defined(__APPLE__)

#import <Cocoa/Cocoa.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <mutex>
#include <thread>

#include "platform_surface.h"

namespace {

struct PaintState {
  std::mutex mutex;
  std::condition_variable cv;
  int paint_count = 0;
  bool callback_started = false;
  bool disable_started = false;
  bool disable_finished = false;
  bool disabled_while_painting = false;
};

void paint_callback(void* user, NativeSurface*) {
  auto* state = static_cast<PaintState*>(user);
  std::unique_lock<std::mutex> lock(state->mutex);
  state->paint_count += 1;
  state->callback_started = true;
  state->cv.notify_all();
  state->cv.wait(lock, [state] { return state->disable_started; });

  state->disabled_while_painting = state->cv.wait_for(
      lock,
      std::chrono::milliseconds(100),
      [state] { return state->disable_finished; }
  );
}

void drain_main_queue() {
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
}

}  // namespace

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSWindow* window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 64, 64)
                  styleMask:NSWindowStyleMaskTitled
                    backing:NSBackingStoreBuffered
                      defer:NO];
    if (!window) return 1;
    window.releasedWhenClosed = NO;

    PaintState paint_state;
    NativeSurface* surface = surface_create(
        window.contentView,
        {0, 0, 64, 64},
        paint_callback,
        &paint_state
    );
    if (!surface) {
      [window release];
      return 2;
    }

    [window orderFront:nil];
    NSView* surface_view = window.contentView.subviews.lastObject;
    // Queue a paint, then disable from a worker while drawRect is active.
    // The old implementation returned from disable while the callback still
    // held the player pointer; a subsequent destroy could then cause UAF.
    surface_request_paint(surface);
    std::thread disabler([&] {
      std::unique_lock<std::mutex> lock(paint_state.mutex);
      paint_state.cv.wait(lock, [&] { return paint_state.callback_started; });
      paint_state.disable_started = true;
      paint_state.cv.notify_all();
      lock.unlock();

      surface_disable_paint(surface);

      lock.lock();
      paint_state.disable_finished = true;
      paint_state.cv.notify_all();
    });
    [surface_view drawRect:surface_view.bounds];
    disabler.join();

    {
      std::lock_guard<std::mutex> lock(paint_state.mutex);
      if (paint_state.paint_count != 1 || paint_state.disabled_while_painting) {
        surface_destroy(surface);
        [window close];
        [window release];
        return 3;
      }
    }

    const int paints_before_destroy = paint_state.paint_count;
    surface_destroy(surface);
    drain_main_queue();

    [window close];
    [window release];
    return paint_state.paint_count == paints_before_destroy ? 0 : 4;
  }
}

#endif
