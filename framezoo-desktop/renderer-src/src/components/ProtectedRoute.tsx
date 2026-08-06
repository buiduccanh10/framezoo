import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/hooks/auth/useAuth";
import { useOverlayStack } from "@/stores/interface/overlayStack";

export function ProtectedRoute() {
  const { loggedIn } = useAuth();

  useEffect(() => {
    if (!loggedIn) {
      useOverlayStack.getState().showModal("auth", { mode: "login" });
    }
  }, [loggedIn]);

  if (!loggedIn) {
    return <Navigate to="/discover" replace />;
  }

  return <Outlet />;
}
