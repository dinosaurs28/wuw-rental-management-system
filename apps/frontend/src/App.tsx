import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import SignInPage from "./pages/auth/SignInPage";
import EmployeeSignInPage from "./pages/auth/EmployeeSignInPage";
import OtpPage from "./pages/auth/OtpPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { VehicleDetailsPage } from "./pages/VehicleDetailsPage";
import { KycVerificationPage } from "./pages/verification/KycVerificationPage";
import { PersonalInformationPage } from "./pages/profile/PersonalInformationPage";
import { ReviewConfirmPage } from "./pages/booking/ReviewConfirmPage";
import { BookingStatusPage } from "./pages/booking/BookingStatusPage";
import { BookingConfirmationPage } from "./pages/booking/BookingConfirmationPage";
import { MyBookingsPage } from "./pages/MyBookingsPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { LandingPage } from "@/components/landing/LandingPage";
import { AuthInitializer } from "@/components/auth/AuthInitializer";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PublicRoute } from "@/components/auth/PublicRoute";
import { EmployeeProtectedRoute } from "@/components/auth/EmployeeProtectedRoute";
import EmployeeDashboardPage from "@/pages/employee/EmployeeDashboardPage";
import StaffPickupsPage from "@/pages/employee/StaffPickupsPage";
import ReturnProcessPage from "@/pages/employee/ReturnProcessPage";

function App() {
  return (
    <BrowserRouter>
      <AuthInitializer />
      <Toaster richColors position="top-center" />
      <Routes>
        {/* Public Routes - No auth required */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/vehicles" element={<VehiclesPage />} />
        <Route path="/vehicle/:vehicleId" element={<VehicleDetailsPage />} />

        {/* Public Auth Routes */}
        <Route element={<PublicRoute />}>
          <Route path="/auth/sign-in" element={<SignInPage />} />
          <Route path="/auth/sign-up" element={<SignInPage defaultTab="sign-up" />} />
          <Route path="/auth/verify-otp" element={<OtpPage />} />
          <Route path="/employee/sign-in" element={<EmployeeSignInPage />} />
        </Route>

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/my-bookings" element={<MyBookingsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/verification/kyc" element={<KycVerificationPage />} />
          <Route path="/profile/personal-information" element={<PersonalInformationPage />} />
          <Route path="/booking/review-confirm" element={<ReviewConfirmPage />} />
          <Route path="/booking/confirmation" element={<BookingConfirmationPage />} />
          <Route path="/booking/status/:transactionId" element={<BookingStatusPage />} />
        </Route>

        {/* Employee Protected Routes */}
        <Route element={<EmployeeProtectedRoute />}>
          <Route path="/employee/dashboard" element={<EmployeeDashboardPage />} />
          <Route path="/staff/pickups/:bookingId" element={<StaffPickupsPage />} />
          <Route path="/employee/dashboard/return/:bookingId" element={<ReturnProcessPage />} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/auth/sign-in" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
