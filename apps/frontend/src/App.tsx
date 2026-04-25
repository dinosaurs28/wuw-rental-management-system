import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import SignInPage from "./pages/auth/SignInPage";
import EmployeeSignInPage from "./pages/auth/EmployeeSignInPage";
import BranchManagerSignInPage from "./pages/auth/BranchManagerSignInPage";
import OtpPage from "./pages/auth/OtpPage";
import PortalPage from "./pages/auth/PortalPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { VehicleDetailsPage } from "./pages/VehicleDetailsPage";
import VehicleGroupDetailsPage from "./pages/VehicleGroupDetailsPage";
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
import { BranchManagerProtectedRoute } from "@/components/auth/BranchManagerProtectedRoute";
import EmployeeDashboardPage from "@/pages/employee/EmployeeDashboardPage";
import EmployeeCustomerSelectPage from "@/pages/employee/booking/EmployeeCustomerSelectPage";
import EmployeeCreateCustomerPage from "@/pages/employee/booking/EmployeeCreateCustomerPage";
import EmployeeVehicleListingPage from "@/pages/employee/booking/EmployeeVehicleListingPage";
import { EmployeeVehicleDetailsPage } from "@/pages/employee/booking/EmployeeVehicleDetailsPage";
import { EmployeeBookingSummaryPage } from "@/pages/employee/booking/EmployeeBookingSummaryPage";
import StaffPickupsPage from "@/pages/employee/StaffPickupsPage";
import ReturnProcessPage from "@/pages/employee/ReturnProcessPage";
import RemainingPaymentStatusPage from "@/pages/employee/RemainingPaymentStatusPage";
import ManagerCaptureConfigPage from "@/pages/manager/ManagerCaptureConfigPage";
import { EmployeeBookingStatusPage } from "./pages/employee/booking/EmployeeBookingStatusPage";
import { DashboardPage } from "./pages/manager/DashboardPage";
import { ManagerEmployeesPage } from "./pages/manager/ManagerEmployeesPage";
import { ManagerVehiclesPage } from "./pages/manager/ManagerVehiclesPage";
import { ManagerVehicleFormPage } from "./pages/manager/ManagerVehicleFormPage";
import { ManagerProfilePage } from "./pages/manager/ManagerProfilePage";
import { ManagerDepositRulesPage } from "./pages/manager/ManagerDepositRulesPage";
import { ManagerGSTRulesPage } from "./pages/manager/ManagerGSTRulesPage";
import { ManagerInsuranceExpiryPage } from "./pages/manager/ManagerInsuranceExpiryPage";
import DamageReviewPage from "./pages/manager/DamageReviewPage";
import FinePaymentStatusPage from "./pages/manager/FinePaymentStatusPage";
import { VehicleSwapPage } from "./pages/manager/VehicleSwapPage";
import { FinancialsDashboardPage } from "./pages/manager/payment/FinancialsDashboardPage";
import { ExtensionsPage } from "./pages/manager/payment/ExtensionsPage";
import { DiscountsDashboardPage } from "./pages/manager/payment/DiscountsDashboardPage";
import { ChargeConfigPage } from "./pages/manager/ChargeConfigPage";
import AdminSignInPage from "./pages/auth/AdminSignInPage";
import { AdminProtectedRoute } from "@/components/auth/AdminProtectedRoute";
import { AdminDashboardPage } from "./pages/admin/AdminDashboardPage";
import { AdminBranchesPage } from "./pages/admin/AdminBranchesPage";
import { AdminLayout } from "@/layouts/AdminLayout";
import { GlobalReports } from "./pages/admin/reports/GlobalReports";
import { VehicleHistoryPage } from "./pages/admin/reports/VehicleHistoryPage";
import { VehicleReportsListPage } from "./pages/admin/reports/VehicleReportsListPage";
import { DailySummaryPage } from "./pages/admin/reports/DailySummaryPage";
import { SalesReportPage } from "./pages/admin/reports/SalesReportPage";
import { VehicleAvailabilityPage } from "./pages/admin/reports/VehicleAvailabilityPage";
import { InsurancePermitExpiryPage } from "./pages/admin/reports/InsurancePermitExpiryPage";
import { CollectionReportPage } from "./pages/admin/reports/CollectionReportPage";
import { FleetExecutivePage } from "./pages/admin/reports/FleetExecutivePage";
import { GSTReportPage } from "./pages/admin/reports/GSTReportPage";
import { AdminDiscountRulesPage } from "./pages/admin/AdminDiscountRulesPage";
import { AdminBranchDetailPage } from "./pages/admin/AdminBranchDetailPage";
import { AdminWhatsAppConfigPage } from "./pages/admin/AdminWhatsAppConfigPage";
import { AdminAuditLogPage } from "./pages/admin/AdminAuditLogPage";
import { AdminStaffActivityPage } from "./pages/admin/AdminStaffActivityPage";
import { InvoiceReportPage } from "./pages/admin/reports/InvoiceReportPage";
import { ReceiptReportPage } from "./pages/admin/reports/ReceiptReportPage";
import { CustomerReportPage } from "./pages/admin/reports/CustomerReportPage";
import { ManagerStaffActivityPage } from "./pages/manager/ManagerStaffActivityPage";
import { LedgerPage } from "./pages/manager/LedgerPage";
import { CustomerCreditPage } from "./pages/manager/CustomerCreditPage";
import { ScrollToTop } from "@/components/utils/ScrollToTop";

const ExternalRedirect = ({ to }: { to: string }) => {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return null;
};
import { TermsPage } from "./pages/legal/TermsPage";
import { PrivacyPage } from "./pages/legal/PrivacyPage";
import { FaqPage } from "./pages/legal/FaqPage";
import { ContactPage } from "./pages/ContactPage";

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AuthInitializer />
      <Toaster richColors position="top-center" />
      <Routes>
        {/* Public Routes - No auth required */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/vehicles" element={<VehiclesPage />} />
        <Route path="/vehicle/group/:groupKey" element={<VehicleGroupDetailsPage />} />
        <Route path="/vehicle/:vehicleId" element={<VehicleDetailsPage />} />
        <Route path="/terms" element={<ExternalRedirect to="/legal/terms.html" />} />
        <Route path="/privacy" element={<ExternalRedirect to="/legal/privacy.html" />} />
        <Route path="/faq" element={<ExternalRedirect to="/legal/faq.html" />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/portal" element={<PortalPage />} />
        <Route path="/links" element={<Navigate to="/portal" replace />} />

        {/* Public Auth Routes */}
        <Route element={<PublicRoute />}>
          <Route path="/auth/sign-in" element={<SignInPage />} />
          <Route
            path="/auth/sign-up"
            element={<SignInPage defaultTab="sign-up" />}
          />
          <Route path="/auth/verify-otp" element={<OtpPage />} />
          <Route path="/employee/sign-in" element={<EmployeeSignInPage />} />
          <Route
            path="/employee/booking/status/:transactionId"
            element={<EmployeeBookingStatusPage />}
          />
        </Route>

        <Route
          path="/branch-manager/sign-in"
          element={<BranchManagerSignInPage />}
        />
        <Route path="/admin/sign-in" element={<AdminSignInPage />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/my-bookings" element={<MyBookingsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/verification/kyc" element={<KycVerificationPage />} />
          <Route
            path="/profile/personal-information"
            element={<PersonalInformationPage />}
          />
          <Route
            path="/booking/review-confirm"
            element={<ReviewConfirmPage />}
          />
          <Route
            path="/booking/confirmation"
            element={<BookingConfirmationPage />}
          />
          <Route
            path="/booking/status/:transactionId"
            element={<BookingStatusPage />}
          />
        </Route>

        {/* Branch Manager Protected Routes */}
        <Route element={<BranchManagerProtectedRoute />}>
          <Route path="/manager/dashboard" element={<DashboardPage />} />
          <Route path="/manager/employees" element={<ManagerEmployeesPage />} />
          <Route path="/manager/vehicles" element={<ManagerVehiclesPage />} />
          <Route
            path="/manager/vehicles/add"
            element={<ManagerVehicleFormPage />}
          />
          <Route
            path="/manager/vehicles/edit/:vehicleId"
            element={<ManagerVehicleFormPage />}
          />
          <Route
            path="/manager/insurance-expiry"
            element={<ManagerInsuranceExpiryPage />}
          />
          <Route
            path="/manager/deposit-rules"
            element={<ManagerDepositRulesPage />}
          />
          <Route path="/manager/gst-rules" element={<ManagerGSTRulesPage />} />
          <Route path="/manager/profile" element={<ManagerProfilePage />} />
          <Route path="/manager/capture-configs" element={<ManagerCaptureConfigPage />} />
          <Route
            path="/manager/payment/fine-status/:transactionId"
            element={<FinePaymentStatusPage />}
          />
          <Route
            path="/damage/:damageReportId"
            element={<DamageReviewPage />}
          />
          <Route
            path="/manager/bookings/:bookingId/swap-vehicle"
            element={<VehicleSwapPage />}
          />
          <Route
            path="/manager/payment/financials"
            element={<FinancialsDashboardPage />}
          />
          <Route
            path="/manager/payment/cash-confirmations"
            element={<Navigate to="/manager/payment/financials?tab=confirmations" replace />}
          />
          <Route
            path="/manager/payment/settlements"
            element={<Navigate to="/manager/payment/financials?tab=settlements" replace />}
          />
          <Route
            path="/manager/payment/refunds"
            element={<Navigate to="/manager/payment/financials?tab=refunds" replace />}
          />
          <Route
            path="/manager/payment/cash-shifts"
            element={<Navigate to="/manager/payment/financials?tab=shifts" replace />}
          />
          <Route
            path="/manager/payment/extensions"
            element={<ExtensionsPage />}
          />
          <Route
            path="/manager/payment/discounts"
            element={<DiscountsDashboardPage />}
          />
          <Route
            path="/manager/payment/discount-approvals"
            element={<Navigate to="/manager/payment/discounts?tab=approvals" replace />}
          />
          <Route
            path="/manager/payment/coupons"
            element={<Navigate to="/manager/payment/discounts?tab=coupons" replace />}
          />
          <Route
            path="/manager/payment/discount-config"
            element={<Navigate to="/manager/payment/discounts?tab=config" replace />}
          />
          <Route
            path="/manager/charge-config"
            element={<ChargeConfigPage />}
          />
          <Route
            path="/manager/staff-activity"
            element={<ManagerStaffActivityPage />}
          />
          <Route
            path="/manager/ledger"
            element={<LedgerPage />}
          />
          <Route
            path="/manager/ledger/:customerId"
            element={<CustomerCreditPage />}
          />
        </Route>

        {/* Admin Protected Routes */}
        <Route element={<AdminProtectedRoute />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
            {/* Future Admin Routes */}
            <Route path="/admin/branches" element={<AdminBranchesPage />} />
            <Route path="/admin/branches/:branchId" element={<AdminBranchDetailPage />} />
            <Route path="/admin/reports" element={<GlobalReports />} />
            <Route
              path="/admin/vehicle-reports"
              element={<VehicleReportsListPage />}
            />

            {/* Admin Report Routes */}
            <Route
              path="/admin/reports/daily-summary"
              element={<DailySummaryPage />}
            />
            <Route path="/admin/reports/sales" element={<SalesReportPage />} />
            <Route
              path="/admin/reports/vehicle/:vehicleId"
              element={<VehicleHistoryPage />}
            />
            <Route
              path="/admin/reports/vehicle-availability"
              element={<VehicleAvailabilityPage />}
            />
            <Route
              path="/admin/reports/insurance-permit-expiry"
              element={<InsurancePermitExpiryPage />}
            />
            <Route
              path="/admin/reports/collection"
              element={<CollectionReportPage />}
            />
            <Route
              path="/admin/reports/fleet-executive"
              element={<FleetExecutivePage />}
            />
            <Route path="/admin/reports/gst" element={<GSTReportPage />} />
            <Route path="/admin/reports/invoices" element={<InvoiceReportPage />} />
            <Route path="/admin/reports/receipts" element={<ReceiptReportPage />} />
            <Route path="/admin/reports/customers" element={<CustomerReportPage />} />
            <Route
              path="/admin/discount-rules"
              element={<AdminDiscountRulesPage />}
            />
            <Route path="/admin/whatsapp-config" element={<AdminWhatsAppConfigPage />} />
            <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
            <Route path="/admin/staff-activity" element={<AdminStaffActivityPage />} />
          </Route>
        </Route>

        {/* Employee Protected Routes */}
        <Route element={<EmployeeProtectedRoute />}>
          <Route
            path="/employee/dashboard"
            element={<EmployeeDashboardPage />}
          />
          <Route
            path="/employee/new-booking"
            element={<EmployeeCustomerSelectPage />}
          />
          <Route
            path="/employee/customer/create"
            element={<EmployeeCreateCustomerPage />}
          />
          <Route
            path="/employee/vehicles"
            element={<EmployeeVehicleListingPage />}
          />
          <Route
            path="/employee/vehicle/:id"
            element={<EmployeeVehicleDetailsPage />}
          />
          <Route
            path="/employee/booking/summary"
            element={<EmployeeBookingSummaryPage />}
          />
          <Route
            path="/staff/pickups/:bookingId"
            element={<StaffPickupsPage />}
          />
          <Route
            path="/employee/dashboard/return/:bookingId"
            element={<ReturnProcessPage />}
          />
          <Route path="/returns/:bookingId" element={<ReturnProcessPage />} />
          <Route
            path="/employee/payment/remaining-status/:transactionId"
            element={<RemainingPaymentStatusPage />}
          />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/auth/sign-in" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
