import { useEffect, useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { userService } from "@/services/user.service";
import { describeMissingProfileFields } from "@/lib/customerProfile";
import { gstLabel, gstSplitText } from "@/lib/gst";
import { CouponInput } from "@/components/discount/CouponInput";
import {
  clampPaymentFlow,
  durationDiscountTitle,
  roundMoney,
  type PaymentFlow,
} from "@/lib/paymentPlan";
import { useCustomerBookingLimits } from "@/hooks/useCustomerBookingLimits";
import { useBranchSchedule } from "@/hooks/useBranchSchedule";
import { useBookingScheduleVerdict } from "@/hooks/useBookingScheduleVerdict";
import { ScheduleWarningBanner } from "@/components/booking/ScheduleWarningBanner";
import { validateBookingWindow } from "@repo/schemas";
import { formatRentalLength } from "@/utils/formatters";
import {
  BookingTypeLimitModal,
  type TypeClassConflict,
} from "@/components/booking/BookingTypeLimitModal";

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
import { useSearchStore } from "@/store/search.store";

export const ReviewConfirmPage = () => {
  const navigate = useNavigate();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitConflicts, setLimitConflicts] = useState<TypeClassConflict[]>([]);

  // Get all booking state from store
  const {
    selectedVehicleId,
    selectedGroupKey,
    startDate,
    endDate,
    startTime,
    endTime,
    paymentType,
    apiBasePrice,
    apiDurationDiscountAmount,
    apiDurationDiscountPercent,
    apiTaxAmount,
    apiFinalTotal,
    apiGst,
    couponPricing,
    apiDurationDiscountLabel,
    apiDurationDiscountType,
    deposit,
    paymentFlow,
    setPaymentFlow,
    advancePayAmount,
    paymentOptions,
    couponCode,
    couponPaymentOptions,
    applyCoupon,
    clearCoupon,
    hasVehicleSelected,
  } = useVehicleRentalStore();
  const [couponChecking, setCouponChecking] = useState(false);

  // Discounts and totals are the server's numbers: with a coupon, its re-priced
  // breakdown (a suppressed slab is hidden — the coupon replaced it); otherwise
  // the vehicle quote. The refundable deposit is part of what the customer pays.
  const shownDurationDiscount = couponPricing
    ? couponPricing.durationSuppressed ? 0 : couponPricing.durationDiscountAmount
    : apiDurationDiscountAmount;
  const shownDurationTitle = durationDiscountTitle(
    couponPricing?.durationDiscountLabel ?? apiDurationDiscountLabel,
    couponPricing ? couponPricing.durationDiscountPercent : apiDurationDiscountPercent,
    apiDurationDiscountType,
  );
  // Without the server breakdown (old session, mid re-check) no coupon line is shown
  const shownCouponDiscount = couponPricing?.couponDiscountAmount ?? 0;
  const shownDeposit = couponPricing ? couponPricing.deposit : deposit;
  const payableTotal = couponPricing
    ? couponPricing.payableTotal
    : paymentOptions?.payableTotal ?? roundMoney(apiFinalTotal + deposit);

  // Payment plan (#6): the server's options, re-computed with the coupon total
  const planOptions = couponPaymentOptions ?? paymentOptions;
  const shownFlow: PaymentFlow = clampPaymentFlow(paymentFlow, planOptions);
  const advanceNow = planOptions?.advanceAmount ?? advancePayAmount;
  const showAdvancePlan = shownFlow === "ADVANCE" && advanceNow > 0 && advanceNow < payableTotal;
  // Book with the plan shown (the server converts a plan it doesn't allow anyway)
  useEffect(() => {
    if (shownFlow !== paymentFlow) setPaymentFlow(shownFlow);
  }, [shownFlow, paymentFlow, setPaymentFlow]);

  // GST lines (display only, server figures). The coupon is pre-GST, so with a
  // coupon the server's post-coupon pricing carries the GST actually charged.
  const gstView = couponPricing
    ? {
        showTaxable: couponPricing.discountAmount > 0,
        taxable: couponPricing.taxableAmount,
        tax: couponPricing.taxAmount,
        taxRate: couponPricing.taxRate,
        cgst: couponPricing.cgstAmount,
        sgst: couponPricing.sgstAmount,
      }
    : {
        showTaxable: apiDurationDiscountAmount > 0,
        taxable: apiFinalTotal - apiTaxAmount,
        tax: apiTaxAmount,
        taxRate: apiGst?.taxRate ?? null,
        cgst: apiGst?.cgstAmount ?? 0,
        sgst: apiGst?.sgstAmount ?? 0,
      };

  // Build ISO strings for the booking limit pre-flight check
  const startISO = useMemo(() => {
    if (!startDate || !startTime) return undefined;
    const [y, m, d] = startDate.split("-").map(Number);
    const [h, mi] = startTime.split(":").map(Number);
    return new Date(y, m - 1, d, h, mi, 0).toISOString();
  }, [startDate, startTime]);

  const endISO = useMemo(() => {
    if (!endDate || !endTime) return undefined;
    const [y, m, d] = endDate.split("-").map(Number);
    const [h, mi] = endTime.split(":").map(Number);
    return new Date(y, m - 1, d, h, mi, 0).toISOString();
  }, [endDate, endTime]);

  const { branchPublicId } = useSearchStore();
  const { restrictedTypeClasses, conflictDetails, blockedAll, anyVehicleConflict } = useCustomerBookingLimits(startISO, endISO, branchPublicId ?? undefined);
  const { schedule } = useBranchSchedule(branchPublicId ?? undefined);
  const { verdict: scheduleVerdict } = useBookingScheduleVerdict(schedule, startISO, endISO);
  // Office hours that block the booking (pickup outside hours, or a return that
  // can't be moved inside the 15-day limit)
  const scheduleBlocks =
    scheduleVerdict?.status === "PICKUP_CLOSED_DAY" ||
    scheduleVerdict?.status === "PICKUP_BEFORE_OPEN" ||
    scheduleVerdict?.status === "PICKUP_AT_OR_AFTER_CLOSE" ||
    scheduleVerdict?.status === "NO_OPEN_DAY_IN_WINDOW" ||
    scheduleVerdict?.status === "RETURN_OUTSIDE_HOURS";

  // 15-day booking window (#15) — same rule and message as the server
  const windowError = useMemo(() => {
    if (!startISO || !endISO) return null;
    const res = validateBookingWindow({ startAt: startISO, endAt: endISO });
    return res.ok ? null : res.message;
  }, [startISO, endISO]);

  // Clear any stale booking intent when the user lands here — prevents a
  // subsequent unrelated sign-in from incorrectly redirecting to review.
  useEffect(() => {
    useAuthStore.getState().clearBookingIntent();
  }, []);

  // Check if we have vehicle selected
  const hasVehicle = hasVehicleSelected();

  // Profile completeness (#1): bookings need the DL + Aadhaar numbers (and the
  // rest of the profile). Pre-checked here so the customer isn't bounced at
  // payment; the server enforces it too (403 PROFILE_INCOMPLETE).
  const { data: profile } = useQuery({
    queryKey: ["user-profile"],
    queryFn: userService.getProfile,
    staleTime: 0,
    // Not kept after leaving: returning from the profile page must not flash
    // the pre-save (incomplete) answer.
    gcTime: 0,
    retry: false,
  });
  const profileIncomplete = !!profile && !profile.isProfileCompleted;
  const missingProfileText = describeMissingProfileFields(profile?.missingFields);

  const goCompleteProfile = () => {
    // The profile page sends the customer back here once the profile is saved.
    useAuthStore.getState().setBookingIntent();
    navigate("/profile/personal-information");
  };

  // Check if form is valid for submission. The KYC document is optional (X2):
  // the DL + Aadhaar numbers on the profile are what the booking needs.
  const isFormValid = paymentType && termsAccepted && !profileIncomplete;

  // Handle Confirm & Pay click - validate, check type-class limits, then navigate
  const handleConfirmAndPay = () => {
    if (profileIncomplete) {
      toast.error(
        missingProfileText
          ? `Add your ${missingProfileText} to your profile before booking.`
          : "Complete your profile before booking.",
      );
      goCompleteProfile();
      return;
    }

    if (
      (!selectedVehicleId && !selectedGroupKey) ||
      !startDate ||
      !endDate ||
      !paymentType
    ) {
      toast.error("Please complete all required fields");
      return;
    }

    // Pre-flight: block if schedule verdict is a hard pickup violation
    if (scheduleBlocks) {
      toast.error("Booking times conflict with branch operating hours. Please adjust your pickup or return time.");
      return;
    }

    // Pre-flight: 15-day booking window
    if (windowError) {
      toast.error(windowError);
      return;
    }

    // Pre-flight: surface any type-class / any-vehicle conflict before the API call
    if (blockedAll && anyVehicleConflict) {
      setLimitConflicts([{
        typeClass: "TWO_WHEELER" as any,
        reason: "ANY_VEHICLE" as any,
        existingBookingPublicId: anyVehicleConflict.bookingPublicId,
        existingVehicleMake: anyVehicleConflict.vehicleMake,
        existingVehicleModel: anyVehicleConflict.vehicleModel,
        existingBookingStart: anyVehicleConflict.startAt,
        existingBookingEnd: anyVehicleConflict.endAt,
        existingBookingStatus: anyVehicleConflict.status,
      }]);
      setShowLimitModal(true);
      return;
    }

    if (restrictedTypeClasses.size > 0) {
      const conflicts: TypeClassConflict[] = Object.entries(conflictDetails).map(
        ([tc, slot]) => ({
          typeClass: tc,
          existingBookingPublicId: slot.bookingPublicId,
          existingVehicleMake: slot.vehicleMake,
          existingVehicleModel: slot.vehicleModel,
          existingBookingStart: slot.startAt,
          existingBookingEnd: slot.endAt,
          existingBookingStatus: slot.status,
        }),
      );
      setLimitConflicts(conflicts);
      setShowLimitModal(true);
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
                {/* Profile incomplete — blocks booking until fixed (#1) */}
                {profileIncomplete && (
                  <div
                    role="alert"
                    className="p-5 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center gap-4"
                  >
                    <div className="flex items-start gap-3 flex-1">
                      <AlertCircle className="size-5 shrink-0 text-amber-600 mt-0.5" />
                      <div>
                        <p className="font-semibold text-amber-900">
                          Complete your profile to continue
                        </p>
                        <p className="text-sm text-amber-800 mt-0.5">
                          {missingProfileText
                            ? `Add your ${missingProfileText} before booking.`
                            : "Your profile is missing details needed for booking."}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={goCompleteProfile}
                      className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                    >
                      Complete Profile
                      <ArrowRight className="ml-2 size-4" />
                    </Button>
                  </div>
                )}

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
                      startAt={startDate && startTime ? (() => { const [y,m,d] = startDate.split("-").map(Number); const [h,mi] = startTime.split(":").map(Number); return new Date(y, m-1, d, h, mi, 0).toISOString(); })() : undefined}
                      endAt={endDate && endTime ? (() => { const [y,m,d] = endDate.split("-").map(Number); const [h,mi] = endTime.split(":").map(Number); return new Date(y, m-1, d, h, mi, 0).toISOString(); })() : undefined}
                      paymentFlow={shownFlow}
                      appliedCode={couponCode}
                      appliedAmount={shownCouponDiscount}
                      needsRecheck={!!couponCode && !couponPricing}
                      onApply={(code, result) => applyCoupon(code, result)}
                      onRemove={clearCoupon}
                      onCheckingChange={setCouponChecking}
                    />
                  </div>

                  {/* Price Summary */}
                  <div className="mt-4 p-5 bg-white border border-zinc-200 rounded-xl space-y-4 shadow-sm">
                    <h3 className="text-base font-semibold text-zinc-800">Price Summary</h3>

                    <div className="space-y-2.5">
                      {/* Base rental — API total for the period */}
                      <div className="flex justify-between text-sm text-zinc-600">
                        <span>Base Rental ({formatRentalLength(startISO, endISO)})</span>
                        <span className="font-medium text-zinc-900">₹{apiBasePrice.toFixed(2)}</span>
                      </div>

                      {/* Duration discount (slab) — hidden when the coupon replaced it */}
                      {shownDurationDiscount > 0 && (
                        <div className="flex justify-between text-sm text-green-600 font-medium">
                          <span>{shownDurationTitle}</span>
                          <span>-₹{shownDurationDiscount.toFixed(2)}</span>
                        </div>
                      )}

                      {/* Coupon discount (pre-GST) */}
                      {shownCouponDiscount > 0 && (
                        <div className="flex justify-between text-sm text-green-600 font-medium">
                          <span>Coupon {couponCode}</span>
                          <span>-₹{shownCouponDiscount.toFixed(2)}</span>
                        </div>
                      )}
                      {couponPricing?.durationSuppressed && (
                        <p className="text-xs text-zinc-400">
                          The coupon replaces the duration discount — they can't be combined here.
                        </p>
                      )}

                      {/* Tax */}
                      {/* Taxable value (GST base) — rental after all discounts */}
                      {gstView.showTaxable && (
                        <div className="flex justify-between text-sm text-zinc-600">
                          <span>Taxable value</span>
                          <span className="font-medium text-zinc-900">
                            ₹{gstView.taxable.toFixed(2)}
                          </span>
                        </div>
                      )}

                      {gstView.tax > 0 && (
                        <div className="space-y-0.5">
                          <div className="flex justify-between text-sm text-zinc-500">
                            <span>{gstLabel("GST", gstView.taxRate || null)}</span>
                            <span>+₹{gstView.tax.toFixed(2)}</span>
                          </div>
                          {(gstView.cgst > 0 || gstView.sgst > 0) && (
                            <p className="text-xs text-zinc-400 text-right">
                              {gstSplitText(gstView.cgst, gstView.sgst, apiGst?.cgstRate, apiGst?.sgstRate)}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Refundable deposit — collected with the booking */}
                      {shownDeposit > 0 && (
                        <div className="flex justify-between text-sm text-zinc-600">
                          <span>Refundable deposit</span>
                          <span className="font-medium text-zinc-900">+₹{shownDeposit.toFixed(2)}</span>
                        </div>
                      )}

                      <div className="pt-3 border-t border-zinc-100 flex justify-between items-center">
                        <span className="text-base font-bold text-zinc-900">Total payable</span>
                        <span className="text-xl font-bold text-primary">
                          ₹{payableTotal.toFixed(2)}
                        </span>
                      </div>

                      {/* Payment plan — a chooser only when the branch offers both */}
                      {planOptions && planOptions.allowedFlows.length === 2 && (
                        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment plan">
                          {(["FULL", "ADVANCE"] as const).map((flow) => (
                            <button
                              key={flow}
                              type="button"
                              role="radio"
                              aria-checked={shownFlow === flow}
                              disabled={couponChecking}
                              onClick={() => setPaymentFlow(flow)}
                              className={`rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                                shownFlow === flow
                                  ? "border-primary bg-primary/5"
                                  : "border-zinc-200 hover:border-zinc-300"
                              }`}
                            >
                              <span className="block text-xs font-semibold text-zinc-700">
                                {flow === "FULL" ? "Pay in full" : "Pay advance"}
                              </span>
                              <span className="block text-sm font-bold text-zinc-900">
                                ₹{(flow === "FULL" ? payableTotal : advanceNow).toFixed(2)}
                                {flow === "ADVANCE" && <span className="font-normal text-zinc-500"> now</span>}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {showAdvancePlan ? (
                        <div className="mt-3 p-3 rounded-lg bg-orange-50 border border-orange-200 space-y-2">
                          <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Advance Payment Plan</p>
                          <div className="flex justify-between text-sm">
                            <span className="text-orange-600">Pay Now (Advance)</span>
                            <span className="font-bold text-orange-700">₹{advanceNow.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Due at pickup</span>
                            <span className="font-medium text-zinc-700">
                              ₹{roundMoney(payableTotal - advanceNow).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex justify-between text-sm">
                          <span className="text-zinc-500">Pay now (full amount)</span>
                          <span className="font-semibold text-zinc-900">₹{payableTotal.toFixed(2)}</span>
                        </div>
                      )}
                      {planOptions?.reasonMessage && (
                        <p className="text-xs text-zinc-500">{planOptions.reasonMessage}</p>
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

                  {/* Schedule warning — show when times conflict with branch hours */}
                  {windowError && (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      <AlertCircle className="size-4 shrink-0 mt-0.5 text-red-500" />
                      <span>{windowError}</span>
                    </div>
                  )}

                  {scheduleVerdict && scheduleVerdict.status !== "OK" && (
                    <div className="mt-4">
                      <ScheduleWarningBanner verdict={scheduleVerdict} />
                    </div>
                  )}

                  {/* Confirm & Pay Button */}
                  <Button
                    onClick={handleConfirmAndPay}
                    disabled={!isFormValid || blockedAll || scheduleBlocks || !!windowError || couponChecking}
                    className="w-full mt-6 h-14 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-lg shadow-primary/20 transition-all duration-200"
                  >
                    <Lock className="mr-2 size-5" />
                    Review & Pay
                  </Button>

                  {/* Disabled state hint */}
                  {!isFormValid && (
                    <p className="text-xs text-muted-foreground text-center mt-3">
                      {profileIncomplete && "Complete your profile • "}
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

      <BookingTypeLimitModal
        open={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        conflicts={limitConflicts}
      />
    </div>
  );
};
