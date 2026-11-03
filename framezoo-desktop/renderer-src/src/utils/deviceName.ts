function getBrowserAndOs(): { browser: string; os: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let os = "Desktop";
  if (/iPad/i.test(ua)) os = "iPad";
  else if (/iPhone|iPod/i.test(ua)) os = "iPhone";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Macintosh|Mac OS X|macOS/i.test(ua)) os = "macOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Browser";
  if (/Electron/i.test(ua)) browser = "Framezoo Desktop";
  else if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR|Opera/i.test(ua)) browser = "Opera";
  else if (/CriOS\//i.test(ua)) browser = "Chrome";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/FxiOS\//i.test(ua)) browser = "Firefox";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  return { browser, os };
}

export async function getClientDeviceName(): Promise<string> {
  // 1. Electron Desktop native system device name (e.g., "Cảnh’s MacBook Air")
  if (typeof window !== "undefined" && window.electronAPI?.getDeviceName) {
    try {
      const name = await window.electronAPI.getDeviceName();
      if (name && name.trim() && name.trim() !== "Browser") {
        return name.trim();
      }
    } catch (err) {
      console.warn("Failed to get desktop device name:", err);
    }
  }

  // 2. Browser localStorage check
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem("framezoo_device_name");
      if (stored && stored.trim() && stored.trim() !== "Browser") {
        return stored.trim();
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  // 3. Friendly browser & OS fallback (e.g., "Chrome on macOS")
  const { browser, os } = getBrowserAndOs();
  const generated = `${browser} on ${os}`;

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem("framezoo_device_name", generated);
    } catch {
      // Ignore localStorage write error
    }
  }

  return generated;
}
