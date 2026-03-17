import { Navigate, Outlet } from "react-router-dom";
import { useAdminAuthStore } from "@/store/adminAuth.store";

export const AdminProtectedRoute = () => {
  const { isAuthenticated, user } = useAdminAuthStore();

  if (!isAuthenticated || !user) {
    return <Navigate to="/admin/sign-in" replace />;
  }

  if (user.role !== "ADMIN") {
    return <Navigate to="/admin/sign-in" replace />;
  }

  return <Outlet />;
};
