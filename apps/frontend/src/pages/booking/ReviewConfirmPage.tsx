import { useEffect, useState } from "react";
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
import { useAuthStore } from "@/store/auth.store";

export const ReviewConfirmPage = () => {
  const navigate = useNavigate();
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Get all booking state from store
  const {
    selectedVehicleId,
    selectedGroupKey,
    startDate,
    endDate,
    startTime,
    endTime,
    selectedKycFilePublicId,
    paymentType,
    rentalDays,
    apiBasePrice,
    apiDurationDiscountAmount,
    apiDurationDiscountPercent,
    apiTaxAmount,
    apiFinalTotal,
    paymentFlow,
    advancePayAmount,
    couponCode,
    couponDiscountAmount,
    setCouponCode,
    hasVehicleSelected,
  } = useVehicleRentalStore();

  // Clear any stale booking intent when the user lands here — prevents a
  // subsequent unrelated sign-in from incorrectly redirecting to review.
  useEffect(() => {
    useAuthStore.getState().clearBookingIntent();
  }, []);

  // Check if we have vehicle selected
  const hasVehicle = hasVehicleSelected();

  // Check if form is valid for submission
  const isFormValid = selectedKycFilePublicId && paymentType && termsAccepted;

  // Handle Confirm & Pay click - just validate and navigate
  const handleConfirmAndPay = () => {
    if (
      (!selectedVehicleId && !selectedGroupKey) ||
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
      <main className="flex-1 mt-24 min-h-[80vh]">
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
                      groupKey={selectedGroupKey ?? undefined}
                      startAt={startDate ? `${startDate}T${startTime}:00.000Z` : undefined}
                      endAt={endDate ? `${endDate}T${endTime}:00.000Z` : undefined}
                      appliedCode={couponCode}
                      appliedAmount={couponDiscountAmount}
                      onApply={(code, amount) => setCouponCode(code, amount)}
                      onRemove={() => setCouponCode(null, 0)}
                    />
                  </div>

                  {/* Price Summary */}
                  <div className="mt-4 p-5 bg-white border border-zinc-200 rounded-xl space-y-4 shadow-sm">
                    <h3 className="text-base font-semibold text-zinc-800">Price Summary</h3>

                    <div className="space-y-2.5">
                      {/* Base rental — API total for the period */}
                      <div className="flex justify-between text-sm text-zinc-600">
                        <span>Base Rental ({rentalDays} {rentalDays === 1 ? 'day' : 'days'})</span>
                        <span className="font-medium text-zinc-900">₹{apiBasePrice.toFixed(2)}</span>
                      </div>

                      {/* Duration discount (from pricing rules) */}
                      {apiDurationDiscountAmount > 0 && (
                        <div className="flex justify-between text-sm text-green-600 font-medium">
                          <span>Duration Discount ({apiDurationDiscountPercent}%)</span>
                          <span>-₹{apiDurationDiscountAmount.toFixed(2)}</span>
                        </div>
                      )}

                      {/* Coupon discount */}
                      {couponDiscountAmount > 0 && (
                        <div className="flex justify-between text-sm text-green-600 font-medium">
                          <span>Coupon Discount</span>
                          <span>-₹{couponDiscountAmount.toFixed(2)}</span>
                        </div>
                      )}

                      {/* Tax */}
                      {apiTaxAmount > 0 && (
                        <div className="flex justify-between text-sm text-zinc-500">
                          <span>GST (included)</span>
                          <span>₹{apiTaxAmount.toFixed(2)}</span>
                        </div>
                      )}

                      <div className="pt-3 border-t border-zinc-100 flex justify-between items-center">
                        <span className="text-base font-bold text-zinc-900">Total payable</span>
                        <span className="text-xl font-bold text-primary">
                          ₹{Math.max(0, apiFinalTotal - couponDiscountAmount).toFixed(2)}
                        </span>
                      </div>

                      {paymentFlow === "ADVANCE" && advancePayAmount > 0 && (
                        <div className="mt-3 p-3 rounded-lg bg-orange-50 border border-orange-200 space-y-2">
                          <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Advance Payment Plan</p>
                          <div className="flex justify-between text-sm">
                            <span className="text-orange-600">Pay Now (Advance)</span>
                            <span className="font-bold text-orange-700">₹{advancePayAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Remaining at pickup</span>
                            <span className="font-medium text-zinc-700">
                              ₹{Math.max(0, apiFinalTotal - couponDiscountAmount - advancePayAmount).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
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
