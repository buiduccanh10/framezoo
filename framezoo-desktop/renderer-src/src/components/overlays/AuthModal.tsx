import { useEffect, useState } from "react";

import { AuthDialog } from "@/components/overlays/AuthDialog";
import { LoginPanel } from "@/pages/Login";
import { RegisterPanel } from "@/pages/Register";
import { useOverlayStack } from "@/stores/interface/overlayStack";

export function AuthModal() {
  const isVisible = useOverlayStack((s) => s.isModalVisible("auth"));
  const modalData = useOverlayStack((s) => s.getModalData("auth"));
  const hideModal = useOverlayStack((s) => s.hideModal);
  const mode = modalData?.mode === "register" ? "register" : "login";

  // We need local state to handle exit animation just like other modals
  const [show, setShow] = useState(isVisible);

  useEffect(() => {
    setShow(isVisible);
  }, [isVisible]);

  if (!show && !isVisible) return null;

  return (
    <AuthDialog
      mode={mode}
      show={show}
      onClose={() => hideModal("auth")}
      onModeChange={(newMode) =>
        useOverlayStack.getState().showModal("auth", { mode: newMode })
      }
    >
      {mode === "register" ? <RegisterPanel /> : <LoginPanel />}
    </AuthDialog>
  );
}
