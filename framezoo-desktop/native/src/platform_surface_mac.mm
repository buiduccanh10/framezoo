#if defined(__APPLE__)

#include "platform_surface.h"

#import <Cocoa/Cocoa.h>
#import <OpenGL/gl3.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <dlfcn.h>

struct NativeSurface;

@interface FrameZooMpvView : NSOpenGLView
@property(nonatomic, assign) NativeSurface* surface;
@end

struct NativeSurface {
  FrameZooMpvView* view = nil;
  NSView* anchor = nil;
  NSView* host = nil;
  SurfaceBounds bounds{};
  std::atomic<double> backing_scale_factor{1.0};
  std::atomic<uint64_t> paint_count{0};
  SurfacePaintCallback paint_callback = nullptr;
  void* user = nullptr;
};

void update_backing_scale_factor(NativeSurface* surface) {
  if (!surface || !surface->view) return;

  NSWindow* window = surface->view.window;
  if (window) {
    surface->backing_scale_factor.store(
        std::max<CGFloat>(1.0, window.backingScaleFactor),
        std::memory_order_relaxed
    );
  } else if (NSScreen* screen = NSScreen.mainScreen) {
    surface->backing_scale_factor.store(
        std::max<CGFloat>(1.0, screen.backingScaleFactor),
        std::memory_order_relaxed
    );
  }
}

NSRect surface_frame_in_host(NativeSurface* surface) {
  NSRect local_frame = NSMakeRect(
      surface->bounds.x,
      surface->bounds.y,
      surface->bounds.width,
      surface->bounds.height
  );
  if (surface->anchor && surface->host) {
    return [surface->anchor convertRect:local_frame toView:surface->host];
  }
  return local_frame;
}

void attach_surface(NativeSurface* surface, NSView* anchor) {
  if (!surface || !surface->view || !anchor) return;

  surface->anchor = anchor;
  // Electron returns the content view on macOS. Attach inside that view so
  // the Chromium view remains above the native playback surface.
  surface->host = anchor;
  NSView* chromium_view = nil;
  for (NSView* sibling in anchor.subviews) {
    if (sibling != surface->view) {
      chromium_view = sibling;
      break;
    }
  }
  [anchor addSubview:surface->view
         positioned:NSWindowBelow
         relativeTo:chromium_view];
  update_backing_scale_factor(surface);
  [surface->view setFrame:surface_frame_in_host(surface)];
  const NSRect backing_frame =
      [surface->view convertRectToBacking:surface->view.bounds];
  std::fprintf(
      stderr,
      "[libmpv-native] surface_attach anchor=%p host=%p superview=%p subviews=%lu "
      "frame=(%.0f,%.0f %.0fx%.0f) backing=(%d,%d) scale=%.2f\n",
      static_cast<void*>(anchor),
      static_cast<void*>(surface->host),
      static_cast<void*>([anchor superview]),
      static_cast<unsigned long>(anchor.subviews.count),
      surface->view.frame.origin.x,
      surface->view.frame.origin.y,
      surface->view.frame.size.width,
      surface->view.frame.size.height,
      static_cast<int>(std::ceil(backing_frame.size.width)),
      static_cast<int>(std::ceil(backing_frame.size.height)),
      surface->backing_scale_factor.load(std::memory_order_relaxed)
  );
}

@implementation FrameZooMpvView

- (BOOL)isFlipped {
  return YES;
}

- (NSView*)hitTest:(NSPoint)point {
  return nil;
}

- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  update_backing_scale_factor(self.surface);
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirtyRect {
  [super drawRect:dirtyRect];
  NativeSurface* surface = self.surface;
  if (!surface || !surface->paint_callback) return;

  const uint64_t paint_number = surface->paint_count.fetch_add(1) + 1;
  if (paint_number <= 5 || paint_number % 60 == 0) {
    std::fprintf(
        stderr,
        "[libmpv-native] paint count=%llu frame=(%.0f,%.0f %.0fx%.0f) "
        "backing=%dx%d\n",
        static_cast<unsigned long long>(paint_number),
        self.frame.origin.x,
        self.frame.origin.y,
        self.frame.size.width,
        self.frame.size.height,
        surface_width(surface),
        surface_height(surface)
    );
  }
  [[self openGLContext] makeCurrentContext];
  glViewport(0, 0, surface_width(surface), surface_height(surface));
  surface->paint_callback(surface->user, surface);
}

@end

NativeSurface* surface_create(
    void* parent_handle,
    SurfaceBounds bounds,
    SurfacePaintCallback paint_callback,
    void* user
) {
  auto* parent = static_cast<NSView*>(parent_handle);
  if (!parent) return nullptr;

  NSOpenGLPixelFormatAttribute attributes[] = {
      NSOpenGLPFAOpenGLProfile,
      NSOpenGLProfileVersion3_2Core,
      NSOpenGLPFAAccelerated,
      NSOpenGLPFAColorSize,
      24,
      NSOpenGLPFAAlphaSize,
      8,
      NSOpenGLPFADoubleBuffer,
      0,
  };
  auto* pixel_format =
      [[[NSOpenGLPixelFormat alloc] initWithAttributes:attributes] autorelease];
  if (!pixel_format) return nullptr;

  auto* surface = new NativeSurface();
  surface->bounds = bounds;
  surface->paint_callback = paint_callback;
  surface->user = user;
  surface->view = [[FrameZooMpvView alloc]
      initWithFrame:NSZeroRect
       pixelFormat:pixel_format];
  if (!surface->view) {
    delete surface;
    return nullptr;
  }

  surface->view.surface = surface;
  surface->view.wantsBestResolutionOpenGLSurface = YES;
  surface->view.wantsLayer = YES;
  surface->view.layer.opaque = NO;
  surface->view.layer.backgroundColor = NSColor.clearColor.CGColor;
  surface->view.autoresizingMask =
      NSViewWidthSizable | NSViewHeightSizable;
  attach_surface(surface, parent);
  [surface->view setNeedsDisplay:YES];
  return surface;
}

void surface_resize(NativeSurface* surface, SurfaceBounds bounds) {
  if (!surface || !surface->view) return;
  surface->bounds = bounds;
  update_backing_scale_factor(surface);
  [surface->view setFrame:surface_frame_in_host(surface)];
  [surface->view setNeedsDisplay:YES];
}

void surface_reparent(NativeSurface* surface, void* parent_handle) {
  if (!surface || !surface->view || !parent_handle) return;
  auto* parent = static_cast<NSView*>(parent_handle);
  [surface->view removeFromSuperview];
  attach_surface(surface, parent);
  [surface->view setNeedsDisplay:YES];
}

void surface_request_paint(NativeSurface* surface) {
  if (!surface || !surface->view) return;
  FrameZooMpvView* view = surface->view;
  [view retain];
  dispatch_async(dispatch_get_main_queue(), ^{
    [view setNeedsDisplay:YES];
    [view release];
  });
}

void surface_disable_paint(NativeSurface* surface) {
  if (!surface) return;
  surface->paint_callback = nullptr;
  surface->user = nullptr;
}

void surface_destroy(NativeSurface* surface) {
  if (!surface) return;
  surface_disable_paint(surface);
  if (surface->view) {
    surface->view.surface = nullptr;
    [surface->view removeFromSuperview];
    [surface->view release];
    surface->view = nil;
  }
  delete surface;
}

void* surface_get_proc_address(NativeSurface*, const char* name) {
  if (!name) return nullptr;
  static void* opengl_library = dlopen(
      "/System/Library/Frameworks/OpenGL.framework/Versions/A/OpenGL",
      RTLD_LAZY | RTLD_LOCAL
  );
  return opengl_library ? dlsym(opengl_library, name) : nullptr;
}

void surface_make_current(NativeSurface* surface) {
  if (surface && surface->view) {
    [[surface->view openGLContext] makeCurrentContext];
  }
}

void surface_swap_buffers(NativeSurface* surface) {
  if (surface && surface->view) {
    [[surface->view openGLContext] flushBuffer];
  }
}

int surface_width(NativeSurface* surface) {
  if (!surface || !surface->view) return 0;
  return std::max(
      1,
      static_cast<int>(
          std::ceil(
              surface->bounds.width *
              surface->backing_scale_factor.load(std::memory_order_relaxed)
          )
      )
  );
}

int surface_height(NativeSurface* surface) {
  if (!surface || !surface->view) return 0;
  return std::max(
      1,
      static_cast<int>(
          std::ceil(
              surface->bounds.height *
              surface->backing_scale_factor.load(std::memory_order_relaxed)
          )
      )
  );
}

void* surface_native_handle(NativeSurface* surface) {
  return surface ? static_cast<void*>(surface->view) : nullptr;
}

void surface_configure_window(void* parent_handle) {
  if (!parent_handle) return;
  NSView* anchor = static_cast<NSView*>(parent_handle);
  NSWindow* window = anchor.window;
  if (!window) return;

  window.styleMask |= NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                      NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
  window.collectionBehavior |= NSWindowCollectionBehaviorFullScreenPrimary;
  window.titlebarAppearsTransparent = NO;
  window.titleVisibility = NSWindowTitleVisible;
  [window setOpaque:YES];
  [window setBackgroundColor:[NSColor blackColor]];
  [window setHasShadow:YES];

  for (NSWindowButton btnType : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton}) {
    NSButton* btn = [window standardWindowButton:btnType];
    if (btn) {
      [btn setHidden:NO];
      [btn setEnabled:YES];
      NSView* v = btn;
      while (v && v != window.contentView && v != window.contentView.superview) {
        [v setHidden:NO];
        v = v.superview;
      }
    }
  }
}

#endif
