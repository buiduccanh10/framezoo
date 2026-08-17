import { describe, expect, it, vi } from "vitest";

import { checkMoonshineHardware } from "./hardware";

describe("Moonshine hardware gate", () => {
  it("rejects a single-core device", () => {
    vi.stubGlobal("navigator", {
      hardwareConcurrency: 1,
    });

    expect(checkMoonshineHardware().reason).toBe("single_cpu");
    vi.unstubAllGlobals();
  });

  it("rejects explicit memory below two GB", () => {
    vi.stubGlobal("navigator", {
      hardwareConcurrency: 4,
      deviceMemory: 1,
    });

    expect(checkMoonshineHardware().reason).toBe("low_memory");
    vi.unstubAllGlobals();
  });

  it("does not reject when deviceMemory is unavailable", () => {
    vi.stubGlobal("navigator", {
      hardwareConcurrency: 2,
    });

    expect(checkMoonshineHardware().eligible).toBe(true);
    vi.unstubAllGlobals();
  });
});
