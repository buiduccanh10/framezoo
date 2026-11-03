/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClientDeviceName } from "./deviceName";

describe("getClientDeviceName", () => {
  const originalElectronAPI = (window as any).electronAPI;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (originalElectronAPI) {
      (window as any).electronAPI = originalElectronAPI;
    } else {
      delete (window as any).electronAPI;
    }
    vi.restoreAllMocks();
  });

  it("returns desktop device name from electronAPI when available", async () => {
    (window as any).electronAPI = {
      getDeviceName: vi.fn().mockResolvedValue("Cảnh’s MacBook Air"),
    };

    const name = await getClientDeviceName();
    expect(name).toBe("Cảnh’s MacBook Air");
  });

  it("falls back to localStorage if electronAPI is not present", async () => {
    delete (window as any).electronAPI;
    localStorage.setItem("framezoo_device_name", "My Custom Laptop");

    const name = await getClientDeviceName();
    expect(name).toBe("My Custom Laptop");
  });

  it("generates a friendly browser on OS name and saves to localStorage if none exists", async () => {
    delete (window as any).electronAPI;
    const name = await getClientDeviceName();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toBe("Browser");
    expect(localStorage.getItem("framezoo_device_name")).toBe(name);
  });
});
