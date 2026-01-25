import { Navigate, Outlet } from "react-router-dom";
import { useBranchManagerAuthStore } from "@/store/branchManagerAuth.store";

export const BranchManagerProtectedRoute = () => {
    const { isAuthenticated, user } = useBranchManagerAuthStore();

    if (!isAuthenticated || !user) {
        return <Navigate to="/branch-manager/sign-in" replace />;
    }

    // Double check role if necessary, though login should handle this
    if (user.role !== 'MANAGER') {
        // Optional: Redirect to unauthorized page or regular sign-in
        return <Navigate to="/branch-manager/sign-in" replace />;
    }

    return <Outlet />;
};
