import { useAuthStore } from "@/store/auth.store";
import { Navigate, Outlet } from "react-router-dom";

export const PublicRoute = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        Loading...
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/my-bookings" replace />;
  }

  return <Outlet />;
};
