import { useAuthStore } from "@/store/auth.store";
import { Navigate, Outlet } from "react-router-dom";
// import { Spinner } from "@/components/ui/spinner"; // Assuming a spinner component or just generic loading text

export const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  return <Outlet />;
};
