import { useEffect } from "react";
import { useAuthStore } from "@/store/auth.store";

export const AuthInitializer = () => {
    const checkAuth = useAuthStore((state) => state.checkAuth);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    return null;
};
