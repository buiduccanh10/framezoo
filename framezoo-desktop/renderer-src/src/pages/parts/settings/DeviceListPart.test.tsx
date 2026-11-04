/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bytesToBase64, encryptData } from "@/backend/accounts/crypto";
import { useAuthStore } from "@/stores/auth";

import { Device, DeviceListPart } from "./DeviceListPart";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue || key,
  }),
}));

vi.mock("@/hooks/auth/useBackendUrl", () => ({
  useBackendUrl: () => "http://localhost:3000",
}));

vi.mock("@/utils/deviceName", () => ({
  getClientDeviceName: vi.fn().mockResolvedValue("Cảnh’s MacBook Air"),
}));

describe("Device Component", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    const currentRoot = root;
    if (currentRoot && container) {
      act(() => {
        currentRoot.unmount();
      });
      container.remove();
    }
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it("renders custom device name and non-repeating subtitle", async () => {
    await act(async () => {
      root!.render(
        <Device
          name="Cảnh’s MacBook Air"
          ids={["session-1"]}
          browser="Framezoo Desktop"
          operatingSystem="macOS"
          type="desktop"
          isCurrent
        />,
      );
    });

    expect(container?.textContent).toContain("Cảnh’s MacBook Air");
    expect(container?.textContent).toContain("Framezoo Desktop · macOS");
    expect(container?.textContent).toContain(
      "settings.account.devices.thisDevice",
    );
    // Ensure no remove button for current device
    expect(container?.querySelector(".logout-button")).toBeNull();
  });

  it("avoids duplicate browser token in subtitle when name already includes browser", async () => {
    await act(async () => {
      root!.render(
        <Device
          name="Framezoo Desktop · macOS"
          ids={["session-2"]}
          browser="Framezoo Desktop"
          operatingSystem="macOS"
          type="desktop"
          isCurrent={false}
        />,
      );
    });

    expect(container?.textContent).toContain("Framezoo Desktop · macOS");
    // Subtitle should not repeat "Framezoo Desktop"
    // Since both Framezoo Desktop and macOS are in name, subtitle falls back to type
    expect(container?.querySelector(".logout-button")).not.toBeNull();
  });
});

describe("DeviceListPart Grouping", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  const mockSeed = new Uint8Array(32).fill(7);
  const seedBase64 = bytesToBase64(mockSeed);

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useAuthStore.setState({
      account: {
        userId: "user-1",
        token: "token-1",
        sessionId: "sess-current",
        seed: seedBase64,
        deviceName: "dummy",
        nickname: "testuser",
        profile: {
          colorA: "#000",
          colorB: "#fff",
          icon: "default" as any,
        },
      },
    });
  });

  afterEach(() => {
    const currentRoot = root;
    if (currentRoot && container) {
      act(() => {
        currentRoot.unmount();
      });
      container.remove();
    }
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it("groups duplicate sessions from the same device into a single card", async () => {
    const encryptedCurrent = await encryptData("Cảnh’s MacBook Air", mockSeed);
    const encryptedOld = await encryptData("Old Windows Laptop", mockSeed);

    const sessions = [
      {
        id: "sess-current",
        userId: "user-1",
        device: encryptedCurrent,
        userAgent: "Mozilla/5.0 Framezoo/2.1.7 Electron/42.8.1 Mac",
        createdAt: "2026-11-01T10:00:00Z",
        accessedAt: "2026-11-03T10:00:00Z",
      },
      // 2 duplicate sessions from Old Windows Laptop
      {
        id: "sess-old-1",
        userId: "user-1",
        device: encryptedOld,
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
        createdAt: "2026-09-01T10:00:00Z",
        accessedAt: "2026-09-05T10:00:00Z",
      },
      {
        id: "sess-old-2",
        userId: "user-1",
        device: encryptedOld,
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/121.0",
        createdAt: "2026-09-02T10:00:00Z",
        accessedAt: "2026-09-10T10:00:00Z",
      },
    ];

    await act(async () => {
      root!.render(<DeviceListPart sessions={sessions} />);
    });

    // Should only render 2 device cards (1 for current device, 1 grouped for old Windows device)
    // rather than 3 separate cards!
    const cards = container?.querySelectorAll(".logout-button");
    // Old device is grouped into 1 card, so there is only 1 remove button
    expect(cards?.length).toBe(1);
    expect(container?.textContent).toContain("Cảnh’s MacBook Air");
    expect(container?.textContent).toContain("Old Windows Laptop");
    expect(container?.textContent).toContain("2 sessions");
  });

  it("shows sessions when the encrypted device-name seed cannot be restored", async () => {
    useAuthStore.setState((state) => ({
      account: state.account ? { ...state.account, seed: "" } : null,
    }));

    await act(async () => {
      root!.render(
        <DeviceListPart
          sessions={[
            {
              id: "sess-current",
              userId: "user-1",
              device: "encrypted",
              userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0",
              createdAt: "2026-11-01T10:00:00Z",
              accessedAt: "2026-11-03T10:00:00Z",
            },
            {
              id: "sess-other",
              userId: "user-1",
              device: "encrypted",
              userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0",
              createdAt: "2026-11-02T10:00:00Z",
              accessedAt: "2026-11-03T10:00:00Z",
            },
          ]}
        />,
      );
    });

    expect(container?.textContent).toContain("Chrome 120.0 · macOS");
    expect(container?.textContent).toContain(
      "settings.account.devices.thisDevice",
    );
    expect(container?.querySelectorAll(".logout-button")).toHaveLength(1);
  });
});
