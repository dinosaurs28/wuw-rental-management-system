import { useEffect } from "react";
import { useAuthStore } from "@/store/auth.store";

export const AuthInitializer = () => {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    const path = window.location.pathname;
    if (!path.startsWith("/manager") && !path.startsWith("/branch-manager")) {
      checkAuth();
    }
  }, [checkAuth]);

  return null;
};
