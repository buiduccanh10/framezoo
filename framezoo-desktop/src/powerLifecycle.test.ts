import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bindPowerLifecycle } from "./powerLifecycle";

describe("power monitor lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes suspend and resume events in order for an active stream", () => {
    const monitor = new EventEmitter();
    const events: string[] = [];
    const controller = {
      pauseAllForSuspend: vi.fn(() => events.push("pause")),
      resumeAllForSuspend: vi.fn(() => events.push("resume")),
    };

    bindPowerLifecycle(monitor, controller, (event) => events.push(event));

    monitor.emit("suspend");
    monitor.emit("resume");

    expect(events).toEqual([
      "pause",
      "desktop:os-suspend",
      "resume",
      "desktop:os-resume",
    ]);
    expect(controller.pauseAllForSuspend).toHaveBeenCalledOnce();
    expect(controller.resumeAllForSuspend).toHaveBeenCalledOnce();
  });

  it("still notifies the renderer when suspend handling throws", () => {
    const monitor = new EventEmitter();
    const send = vi.fn();
    const controller = {
      pauseAllForSuspend: vi.fn(() => {
        throw new Error("native suspend failed");
      }),
      resumeAllForSuspend: vi.fn(),
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    bindPowerLifecycle(monitor, controller, send);
    monitor.emit("suspend");

    expect(send).toHaveBeenCalledWith("desktop:os-suspend");
  });
});
