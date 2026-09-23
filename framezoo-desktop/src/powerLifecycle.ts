export type PowerLifecycleEvent = "desktop:os-suspend" | "desktop:os-resume";

type PowerMonitorLike = {
  on(event: "suspend" | "resume", listener: () => void): unknown;
};

type SuspendableController = {
  pauseAllForSuspend(): void;
  resumeAllForSuspend(): void;
};

export function bindPowerLifecycle(
  monitor: PowerMonitorLike,
  controller: SuspendableController,
  send: (event: PowerLifecycleEvent) => void,
): void {
  monitor.on("suspend", () => {
    try {
      controller.pauseAllForSuspend();
    } catch (error) {
      console.error("[main] suspend handling failed", error);
    }
    send("desktop:os-suspend");
  });

  monitor.on("resume", () => {
    try {
      controller.resumeAllForSuspend();
    } catch (error) {
      console.error("[main] resume handling failed", error);
    }
    send("desktop:os-resume");
  });
}
