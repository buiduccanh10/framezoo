import { useEffect } from "react";

import { Icon, Icons } from "@/components/Icon";
import { useToastStore } from "@/stores/interface/toast";

export function ToastProvider() {
  const { toast, hideToast } = useToastStore();

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(hideToast, 2000);
      return () => clearTimeout(timer);
    }
  }, [toast, hideToast]);

  if (!toast) return null;

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] px-4 py-2 bg-green-600 text-white rounded-lg shadow-lg transition-all duration-300 animate-[scaleIn_0.6s_ease-out_forwards]">
      <div className="flex items-center gap-2">
        <Icon
          icon={toast.type === "error" ? Icons.X : Icons.CHECKMARK}
          className="text-white"
        />
        <span className="text-sm font-medium">{toast.message}</span>
      </div>
    </div>
  );
}
