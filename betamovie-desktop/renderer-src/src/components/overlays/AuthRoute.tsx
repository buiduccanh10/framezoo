import { useLocation } from "react-router-dom";

import { AuthDialog } from "@/components/overlays/AuthDialog";
import { LoginPanel } from "@/pages/Login";
import { RegisterPanel } from "@/pages/Register";

export function AuthRoute() {
  const location = useLocation();
  const mode = location.pathname === "/register" ? "register" : "login";

  return (
    <AuthDialog mode={mode}>
      {mode === "register" ? <RegisterPanel /> : <LoginPanel />}
    </AuthDialog>
  );
}
