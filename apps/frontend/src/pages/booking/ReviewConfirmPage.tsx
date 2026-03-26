import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { CouponInput } from "@/components/discount/CouponInput";

import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { VehicleSummaryCard } from "@/components/booking/VehicleSummaryCard";
import { KycSelectionCard } from "@/components/booking/KycSelectionCard";
import { PaymentMethodCard } from "@/components/booking/PaymentMethodCard";
import { EmptyBookingState } from "@/components/booking/EmptyBookingState";
import { TermsCheckbox } from "@/components/booking/TermsCheckbox";

import { useVehicleRentalStore } from "@/store/vehicleRental.store";

export const ReviewConfirmPage = () => {
  const navigate = useNavigate();
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Get all booking state from store
  const {
    selectedVehicleId,
    startDate,
    endDate,
    selectedKycFilePublicId,
    paymentType,
    couponCode,
    setCouponCode,
    hasVehicleSelected,
  } = useVehicleRentalStore();

  // Check if we have vehicle selected
  const hasVehicle = hasVehicleSelected();

  // Check if form is valid for submission
  const isFormValid = selectedKycFilePublicId && paymentType && termsAccepted;

  // Handle Confirm & Pay click - just validate and navigate
  const handleConfirmAndPay = () => {
    if (
      !selectedVehicleId ||
      !startDate ||
      !endDate ||
      !selectedKycFilePublicId ||
      !paymentType
    ) {
      toast.error("Please complete all required fields");
      return;
    }

    // Navigate to confirmation page (API call happens there)
    navigate("/booking/confirmation");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <main className="flex-1">
        {/* Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
          {/* Breadcrumb */}
          <Breadcrumb className="mb-6">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/" className="text-primary hover:text-primary/80">
                    Home
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link
                    to="/vehicles"
                    className="text-primary hover:text-primary/80"
                  >
                    Vehicles
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Review & Confirm</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          {!hasVehicle ? (
            <EmptyBookingState />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
              {/* Left Column */}
              <div className="lg:col-span-2 space-y-6">
                {/* Vehicle Summary */}
                <VehicleSummaryCard />

                {/* KYC Selection */}
                <KycSelectionCard />

                {/* Payment Method */}
                <PaymentMethodCard />
              </div>

              {/* Right Column (Sticky on desktop) */}
              <div className="space-y-6">
                <div className="lg:sticky lg:top-24">
                  {/* Coupon Code */}
                  <div className="p-4 bg-white border border-zinc-200 rounded-xl space-y-2">
                    <p className="text-sm font-medium text-zinc-700">Have a coupon code?</p>
                    <CouponInput
                      vehiclePublicId={selectedVehicleId ?? undefined}
                      startAt={startDate ? `${startDate}T10:00:00.000Z` : undefined}
                      endAt={endDate ? `${endDate}T10:00:00.000Z` : undefined}
                      appliedCode={couponCode}
                      onApply={(code) => setCouponCode(code)}
                      onRemove={() => setCouponCode(null)}
                    />
                  </div>

                  {/* Terms & Conditions */}
                  <div className="mt-4 p-4 bg-white border border-zinc-200 rounded-xl">
                    <TermsCheckbox
                      checked={termsAccepted}
                      onCheckedChange={setTermsAccepted}
                    />
                  </div>

                  {/* Confirm & Pay Button */}
                  <Button
                    onClick={handleConfirmAndPay}
                    disabled={!isFormValid}
                    className="w-full mt-6 h-14 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-lg shadow-primary/20 transition-all duration-200"
                  >
                    <Lock className="mr-2 size-5" />
                    Review & Pay
                  </Button>

                  {/* Disabled state hint */}
                  {!isFormValid && (
                    <p className="text-xs text-muted-foreground text-center mt-3">
                      {!selectedKycFilePublicId && "Select a KYC document • "}
                      {!paymentType && "Select payment method • "}
                      {!termsAccepted && "Accept terms & conditions"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};
