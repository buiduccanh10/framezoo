import { useEffect, useState } from "react";

export interface WindowControlsProps {
  className?: string;
  buttonClassName?: string;
}

export function WindowControls(props: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isWindows, setIsWindows] = useState(false);

  useEffect(() => {
    const electronApi = (window as any).electronAPI;
    const isWin = Boolean(
      electronApi?.isWindows ||
      electronApi?.platform === "win32" ||
      (Boolean((window as any).__FRAMEZOO_DESKTOP__) &&
        /Windows|Win32/i.test(navigator.userAgent)),
    );

    setIsWindows(isWin);

    if (!isWin || !electronApi) return;

    // Check initial maximized state
    if (typeof electronApi.isMaximized === "function") {
      electronApi
        .isMaximized()
        .then((max: boolean) => setIsMaximized(Boolean(max)))
        .catch(() => {});
    }

    // Subscribe to maximize state changes
    if (typeof electronApi.onMaximizeState === "function") {
      const unsubscribe = electronApi.onMaximizeState((max: boolean) => {
        setIsMaximized(Boolean(max));
      });
      return () => {
        unsubscribe?.();
      };
    }
  }, []);

  if (!isWindows) {
    return null;
  }

  const electronApi = (window as any).electronAPI;

  const handleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    electronApi?.minimizeWindow?.();
  };

  const handleMaximize = (e: React.MouseEvent) => {
    e.stopPropagation();
    electronApi?.maximizeWindow?.();
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    electronApi?.closeWindow?.();
  };

  const baseBtnClass =
    "inline-flex items-center justify-center h-8 w-10 text-white/70 hover:text-white transition-colors duration-150 select-none focus:outline-none";

  return (
    <div
      className={`flex items-center z-[100] ${props.className ?? ""}`}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* Minimize */}
      <button
        type="button"
        onClick={handleMinimize}
        title="Thu nhỏ xuống thanh tác vụ (Minimize)"
        aria-label="Minimize"
        className={`${baseBtnClass} hover:bg-white/10 ${props.buttonClassName ?? ""}`}
      >
        <svg
          width="11"
          height="1"
          viewBox="0 0 11 1"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="11" height="1" fill="currentColor" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        onClick={handleMaximize}
        title={
          isMaximized
            ? "Thu nhỏ kích thước (Restore)"
            : "Phóng to cửa sổ (Maximize)"
        }
        aria-label={isMaximized ? "Restore" : "Maximize"}
        className={`${baseBtnClass} hover:bg-white/10 ${props.buttonClassName ?? ""}`}
      >
        {isMaximized ? (
          // Restore Icon (overlapping squares)
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 2V1H10V8H9M1 3H8V10H1V3Z"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        ) : (
          // Maximize Icon (single square)
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={handleClose}
        title="Đóng (Close)"
        aria-label="Close"
        className={`${baseBtnClass} hover:bg-[#e81123] hover:text-white ${props.buttonClassName ?? ""}`}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1 1L10 10M10 1L1 10"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

export default WindowControls;
