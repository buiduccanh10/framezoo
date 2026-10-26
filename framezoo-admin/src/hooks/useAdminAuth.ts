import { useCallback, useEffect, useState } from "react";
import { adminApi, getApiError, setUnauthorizedHandler } from "../lib/api";

export type AuthState = "checking" | "authenticated" | "anonymous";

export function useAdminAuth() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    let active = true;
    setUnauthorizedHandler(() => active && setAuthState("anonymous"));
    adminApi.getBackupStatus()
      .then(() => active && setAuthState("authenticated"))
      .catch(() => active && setAuthState("anonymous"));
    return () => {
      active = false;
      setUnauthorizedHandler(undefined);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setIsLoggingIn(true);
    setLoginError("");
    try {
      await adminApi.login(username, password);
      setAuthState("authenticated");
    } catch (error) {
      setLoginError(getApiError(error, "Thông tin đăng nhập không hợp lệ."));
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApi.logout();
      setAuthState("anonymous");
      return true;
    } catch {
      return false;
    }
  }, []);

  return { authState, loginError, isLoggingIn, login, logout };
}
