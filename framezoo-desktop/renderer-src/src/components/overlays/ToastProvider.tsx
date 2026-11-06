import { useEffect } from "react";

import { Icon, Icons } from "@/components/Icon";
import { useToastStore } from "@/stores/interface/toast";

export function ToastProvider() {
  const { toast, hideToast } = useToastStore();

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(
        hideToast,
        toast.type === "error" || toast.type === "warning" ? 5000 : 2000,
      );
      return () => clearTimeout(timer);
    }
  }, [toast, hideToast]);

  if (!toast) return null;

  const toastType = toast.type ?? "success";
  const toastClassName = {
    success: "bg-green-600",
    error: "bg-red-600",
    info: "bg-blue-600",
    warning: "bg-amber-500",
  }[toastType];
  const toastIcon =
    toastType === "error"
      ? Icons.X
      : toastType === "info" || toastType === "warning"
        ? Icons.CIRCLE_EXCLAMATION
        : Icons.CHECKMARK;

  return (
    <div
      className={`fixed top-4 left-1/2 z-[9999] w-max max-w-[min(92vw,42rem)] -translate-x-1/2 transform rounded-lg px-4 py-2 shadow-lg transition-all duration-300 animate-[scaleIn_0.6s_ease-out_forwards] ${toastType === "warning" ? "text-black" : "text-white"} ${toastClassName}`}
      role="status"
      aria-live={toastType === "error" ? "assertive" : "polite"}
    >
      <div className="flex items-center gap-2">
        <Icon
          icon={toastIcon}
          className={toastType === "warning" ? "text-black" : "text-white"}
        />
        <span className="break-words text-sm font-medium">{toast.message}</span>
      </div>
    </div>
  );
}
