export interface MoonshineHardwareCheck {
  eligible: boolean;
  reason?: string;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  crossOriginIsolated: boolean;
}

export function checkMoonshineHardware(): MoonshineHardwareCheck {
  const hardwareConcurrency =
    typeof navigator !== "undefined" &&
    Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : null;
  const deviceMemory =
    typeof navigator !== "undefined" &&
    "deviceMemory" in navigator &&
    Number.isFinite(
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    )
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
        null)
      : null;
  const crossOriginIsolated =
    typeof window !== "undefined" && window.crossOriginIsolated === true;

  if (hardwareConcurrency === 1) {
    return {
      eligible: false,
      reason: "single_cpu",
      hardwareConcurrency,
      deviceMemory,
      crossOriginIsolated,
    };
  }
  if (deviceMemory !== null && deviceMemory < 2) {
    return {
      eligible: false,
      reason: "low_memory",
      hardwareConcurrency,
      deviceMemory,
      crossOriginIsolated,
    };
  }
  return {
    eligible: true,
    hardwareConcurrency,
    deviceMemory,
    crossOriginIsolated,
  };
}
