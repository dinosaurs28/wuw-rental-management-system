import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import SignInPage from "./pages/auth/SignInPage";
import OtpPage from "./pages/auth/OtpPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { LandingPage } from "@/components/landing/LandingPage";
import { AuthInitializer } from "@/components/auth/AuthInitializer";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PublicRoute } from "@/components/auth/PublicRoute";

// Placeholder for Dashboard
const Dashboard = () => <div className="p-10"><h1>Dashboard</h1></div>;

function App() {
  return (
    <BrowserRouter>
      <AuthInitializer />
      <Toaster richColors position="top-center" />
      <Routes>
        {/* Public Routes - No auth required */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/vehicles" element={<VehiclesPage />} />

        {/* Public Auth Routes */}
        <Route element={<PublicRoute />}>
          <Route path="/auth/sign-in" element={<SignInPage />} />
          <Route path="/auth/sign-up" element={<SignInPage defaultTab="sign-up" />} />
          <Route path="/auth/verify-otp" element={<OtpPage />} />
        </Route>

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/auth/sign-in" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
