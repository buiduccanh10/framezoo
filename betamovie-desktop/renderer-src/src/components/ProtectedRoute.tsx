import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/hooks/auth/useAuth";

export function ProtectedRoute() {
  const { loggedIn } = useAuth();
  const location = useLocation();

  if (!loggedIn) {
    return (
      <Navigate
        to="/login"
        state={{
          from: location,
          backgroundLocation: {
            pathname: "/discover",
            search: "",
            hash: "",
          },
        }}
        replace
      />
    );
  }

  return <Outlet />;
}
