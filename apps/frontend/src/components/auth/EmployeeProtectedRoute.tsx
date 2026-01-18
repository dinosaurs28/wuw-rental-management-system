
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEmployeeAuthStore } from "@/store/employeeAuth.store";

export function EmployeeProtectedRoute() {
    const { isAuthenticated, isLoading } = useEmployeeAuthStore();
    const location = useLocation();

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    <p className="text-sm text-muted-foreground">Verifying access...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/employee/sign-in" state={{ from: location }} replace />;
    }

    return <Outlet />;
}
