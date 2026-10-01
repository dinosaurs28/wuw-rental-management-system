import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatRentalLength } from "@/utils/formatters";
import { toast } from "sonner";
import { ArrowLeft, Car, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { bookingService } from "@/services/booking.service";
import { useRazorpayCheckout } from "@/hooks/useRazorpayCheckout";
import { HoldCountdownTimer } from "@/components/booking/HoldCountdownTimer";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { useActiveShift } from "@/components/employee/counter/useActiveShift";
import { usePaymentStore } from "@/store/payment.store";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";
import { qrPhotoKeys } from "@/hooks/useQrPhoto";
import {
  apiErrorMessage,
  cleanUtr,
  counterErrorCode,
  isValidUtr,
} from "@/lib/counterErrors";
import { CUSTOMER_PROFILE_INCOMPLETE } from "@/lib/customerProfile";
import { gstLabel } from "@/lib/gst";
import { round2 } from "@repo/schemas";
import { durationDiscountTitle } from "@/lib/paymentPlan";
import { customerSession } from "@/utils/customerSession";

export const EmployeeBookingSummaryPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const initialized = useRef(false);
  const allowNavigationRef = useRef(false);

  // Two possible states:
  // 1. passed existing bookingData (legacy/direct view)
  // 2. passed bookingPayload (needs to create booking)
  const [bookingData, setBookingData] = useState<any>(
    location.state?.bookingData || null,
  );
  const [loading, setLoading] = useState(!location.state?.bookingData);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  // Set when create returned SHIFT_REQUIRED — no hold exists yet, so the same
  // payload is retried as soon as the staff member's shift is open.
  const [shiftBlocked, setShiftBlocked] = useState(false);
  // Set when the server rejected the UPI UTR (at create, or at confirmation
  // after the hold was released) — staff enter a new UTR and create again.
  const [utrRetry, setUtrRetry] = useState<{
    message: string;
    rejectedUtr: string;
  } | null>(null);
  const [retryUtr, setRetryUtr] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const { activeShift } = useActiveShift();
  const { setUtr } = useEmployeeBookingStore();
  const { openCheckout, isOpening } = useRazorpayCheckout();
  // Held in state so a UTR retry can re-create with the corrected payload.
  const [bookingPayload, setBookingPayload] = useState(
    location.state?.bookingPayload,
  );

  // Block browser back button while booking hold is active
  useEffect(() => {
    if (!bookingData || allowNavigationRef.current) return;
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => {
      if (!allowNavigationRef.current) {
        window.history.pushState(null, '', window.location.href);
        setShowCancelDialog(true);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [bookingData]);

  const showUtrRetry = useCallback((error: unknown, rejectedUtr: string) => {
    setUtrRetry({
      message: apiErrorMessage(error, "Check the UTR number and try again."),
      rejectedUtr,
    });
    setRetryUtr(rejectedUtr);
  }, []);

  const createBooking = useCallback(async (payload = bookingPayload) => {
    setLoading(true);
    try {
      const response =
        await bookingService.createEmployeeBooking(payload);

      setBookingData(response);
      if (response.data?.expiresAt) {
        setHoldExpiresAt(response.data.expiresAt);
      }
    } catch (error: any) {
      console.error("Booking creation failed", error);

      if (counterErrorCode(error) === "SHIFT_REQUIRED") {
        // The server just said there's no open shift — drop any stale one so
        // the retry below only fires once a shift is actually opened.
        usePaymentStore.getState().setActiveShift(null);
        setShiftBlocked(true);
        return;
      }

      const code = counterErrorCode(error);
      if (code === "INVALID_UTR" || code === "DUPLICATE_UTR") {
        // No hold was created — stay here so staff can fix the UTR.
        showUtrRetry(error, payload?.utr ?? "");
        return;
      }

      if (
        error?.response?.data?.code === "QR_PHOTO_MISMATCH" ||
        error?.response?.data?.code === "INVALID_QR_PHOTO_ID"
      ) {
        // The QR photo was replaced elsewhere — reload it on the page we go back to.
        queryClient.invalidateQueries({
          queryKey: qrPhotoKeys.customer(payload?.customer_public_id ?? ""),
        });
      }

      // Customer profile incomplete (e.g. DL / Aadhaar number missing): mark
      // the session so the page we go back to offers "Complete Profile".
      if (error?.response?.data?.code === CUSTOMER_PROFILE_INCOMPLETE) {
        const session = customerSession.get();
        if (session && session.publicId === payload?.customer_public_id) {
          customerSession.set({ ...session, profileCompleted: false });
        }
      }

      // The KYC document isn't this customer's — make staff pick one again.
      if (error?.response?.data?.code === "KYC_CUSTOMER_MISMATCH") {
        useEmployeeBookingStore.getState().setCustomerKycId(null);
      }

      // Return outside office hours (#2): put the server's next in-hours return
      // into the walk-in so the vehicle page shows it (re-priced) to confirm.
      const adjustedReturn = error?.response?.data?.verdict?.adjustedReturn;
      if (error?.response?.data?.code === "BRANCH_SCHEDULE_RETURN_ADJUSTED" && adjustedReturn) {
        const adjusted = new Date(adjustedReturn);
        const store = useEmployeeBookingStore.getState();
        if (!isNaN(adjusted.getTime()) && store.startDate) {
          store.setDates(
            new Date(store.startDate),
            new Date(adjusted.getFullYear(), adjusted.getMonth(), adjusted.getDate()),
          );
          store.setEndTime(format(adjusted, "HH:mm"));
        }
      }

      if (error?.response?.data?.code === "VEHICLE_TYPE_LIMIT_EXCEEDED") {
        const conflicts = error.response.data.conflicts ?? [];
        const first = conflicts[0];
        const label =
          first?.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler";
        const vehicleName = first
          ? `${first.existingVehicleMake} ${first.existingVehicleModel}`
          : "";
        toast.error(
          `Customer already has an active ${label} booking${vehicleName ? ` (${vehicleName})` : ""} overlapping these dates. Use the override option if authorised.`,
          { duration: 8000 },
        );
      } else {
        toast.error(
          error.response?.data?.message || "Failed to create booking",
        );
      }

      navigate(-1);
    } finally {
      setLoading(false);
    }
  }, [bookingPayload, navigate, showUtrRetry, queryClient]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    if (bookingData) {
      setLoading(false);
      return;
    }

    if (!bookingPayload) {
      toast.error("No booking data found.");
      navigate("/employee/vehicles");
      return;
    }

    void createBooking();
  }, [bookingData, bookingPayload, navigate, createBooking]);

  // Shift opened (from the notice or the navbar banner) — create the booking.
  useEffect(() => {
    if (!shiftBlocked || !activeShift) return;
    setShiftBlocked(false);
    void createBooking();
  }, [shiftBlocked, activeShift, createBooking]);

  const handleRetryWithUtr = () => {
    const utr = cleanUtr(retryUtr);
    const payload = { ...bookingPayload, utr };
    setUtr(utr); // keep the pricing card in sync if staff go back
    setBookingPayload(payload);
    setUtrRetry(null);
    void createBooking(payload);
  };

  if (shiftBlocked) {
    return (
      <div className="min-h-screen bg-zinc-50 pb-20">
        <DashboardNavbar />
        <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-4">
          <ShiftRequiredNotice />
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4 mr-2" />
            Back
          </Button>
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 pb-20">
        <DashboardNavbar />
        <header className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t">
            <Skeleton className="h-12 w-full mb-3" />
            <Skeleton className="h-10 w-full" />
          </div>
        </main>
      </div>
    );
  }

  if (utrRetry) {
    const unchanged = cleanUtr(retryUtr) === utrRetry.rejectedUtr;
    const retryError = unchanged
      ? utrRetry.message
      : retryUtr && !isValidUtr(retryUtr)
        ? "Enter the 12-digit UTR number."
        : null;
    return (
      <div className="min-h-screen bg-zinc-50 pb-20">
        <DashboardNavbar />
        <main className="max-w-7xl mx-auto px-4 md:px-6 py-6">
          <div className="bg-white p-4 rounded-xl border shadow-sm space-y-4 max-w-md">
            <div>
              <h3 className="font-semibold">UPI (UTR) payment</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Enter the UTR from the customer's UPI app to create the booking again.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="retry-utr">
                UTR number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="retry-utr"
                inputMode="numeric"
                autoComplete="off"
                maxLength={20}
                placeholder="12-digit UTR"
                value={retryUtr}
                onChange={(e) => setRetryUtr(e.target.value)}
                aria-invalid={!!retryError}
                className="h-11 font-mono tracking-wide"
              />
              {retryError && <p className="text-xs text-red-600">{retryError}</p>}
            </div>
            <Button
              className="w-full h-11 font-semibold"
              disabled={unchanged || !isValidUtr(retryUtr)}
              onClick={handleRetryWithUtr}
            >
              Create Booking Again
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/employee/dashboard")}
            >
              Return to Dashboard
            </Button>
          </div>
        </main>
      </div>
    );
  }

  if (!bookingData) return null;

  const holdId = bookingData?.data?.bookingId;

  const handleCancelHold = async () => {
    if (!holdId) {
      allowNavigationRef.current = true;
      navigate("/employee/dashboard");
      return;
    }
    setIsCancelling(true);
    try {
      await bookingService.cancelEmployeeHold(holdId);
      toast.info("Booking hold cancelled.");
      allowNavigationRef.current = true;
      navigate("/employee/dashboard");
    } catch {
      toast.error("Failed to cancel hold. Please try again.");
    } finally {
      setIsCancelling(false);
      setShowCancelDialog(false);
    }
  };

  const handleHoldExpired = () => {
    toast.error("Booking hold has expired. Please start again.", { duration: 6000 });
    allowNavigationRef.current = true;
    navigate("/employee/dashboard");
  };

  const {
    startDate: startDateString,
    endDate: endDateString,
    totals,
    razorpay,
    transactionId,
  } = bookingData?.data || {};

  const items = bookingData?.data?.items || [];
  const vehicle = items.length > 0 ? items[0] : null;
  // UPI (UTR) completes like cash: no gateway, the server confirms it directly.
  const isUpiPayment =
    bookingPayload?.payment_type === "UPI" ||
    (typeof transactionId === "string" && transactionId.startsWith("UPI_"));

  if (!vehicle) {
    return <div className="p-4">No vehicle data found.</div>;
  }

  const startDate = new Date(startDateString);
  const endDate = new Date(endDateString);

  const formatPrice = (amount: number) => {
    return `₹ ${amount?.toLocaleString("en-IN") || "0"}`;
  };

  // Send the employee to the status screen with an outcome Checkout already
  // resolved, so it renders straight away instead of re-polling the gateway.
  const goToStatus = (
    initialStatus?: "success" | "failed",
    initialMessage?: string,
  ) => {
    allowNavigationRef.current = true;
    navigate(`/employee/booking/status/${transactionId}`, {
      state: { initialStatus, initialMessage },
    });
  };

  // UPI is confirmed here rather than on the status page because the server
  // re-checks the UTR: if another payment claimed it meanwhile, the hold is
  // released (409 DUPLICATE_UTR) and staff enter a new UTR instead.
  const handleConfirmUpi = async () => {
    setIsConfirming(true);
    try {
      const response = await bookingService.verifyEmployeePayment(transactionId);
      if (response.status === "Success") {
        goToStatus("success");
      } else if (response.status === "Pending") {
        goToStatus();
      } else {
        // e.g. the hold expired before confirmation
        goToStatus("failed", response.message || "Payment failed. Please try again.");
      }
    } catch (error) {
      if (counterErrorCode(error) === "DUPLICATE_UTR") {
        setBookingData(null);
        setHoldExpiresAt(null);
        showUtrRetry(error, bookingPayload?.utr ?? "");
      } else if ((error as { response?: unknown })?.response) {
        goToStatus("failed", apiErrorMessage(error, "Payment verification failed"));
      } else {
        toast.error("Couldn't reach the server. Please try again.");
      }
    } finally {
      setIsConfirming(false);
    }
  };

  // Opens Razorpay Checkout in-page for this booking.
  const handleOnlinePayment = () => {
    if (!razorpay || !transactionId) {
      toast.error("Payment details are unavailable. Please start again.");
      return;
    }
    setIsPaying(true);
    void openCheckout({
      razorpay,
      transactionId,
      description: "Vehicle booking",
      role: "staff",
      // /payment/status is customer-gated; staff have their own status route.
      pollStatus: (id) => bookingService.verifyEmployeePayment(id),
      onSuccess: () => {
        setIsPaying(false);
        goToStatus("success");
      },
      onPending: () => {
        setIsPaying(false);
        // Deliberately no resolved status: the gateway has not settled yet, so
        // let the status page run its own retry loop as it always has.
        goToStatus();
      },
      onFailure: (message) => {
        setIsPaying(false);
        toast.error(message);
        goToStatus("failed", message);
      },
      onDismiss: () => {
        setIsPaying(false);
        toast.info("Payment cancelled. The booking hold is still active.");
      },
    });
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <DashboardNavbar />

      {/* Sub-header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setShowCancelDialog(true)}>
              <ArrowLeft className="size-5" />
            </Button>
            <h1 className="text-base font-semibold">Booking Summary</h1>
          </div>
          {holdExpiresAt && (
            <HoldCountdownTimer expiresAt={holdExpiresAt} onExpired={handleHoldExpired} />
          )}
        </div>
      </header>

      <AlertDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel booking hold?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the booking hold. The vehicle will become available again for these dates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, stay here</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelHold}
              disabled={isCancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isCancelling ? "Cancelling..." : "Yes, go back"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* Vehicle Card */}
        <div className="bg-white p-4 rounded-xl border shadow-sm flex gap-4">
          {/* Image handling */}
          <div className="w-24 h-24 bg-zinc-100 rounded-lg flex items-center justify-center overflow-hidden">
            {vehicle.image ? (
              <img
                src={vehicle.image}
                alt="Vehicle"
                className="w-full h-full object-cover"
              />
            ) : (
              <Car className="size-8 text-zinc-400" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-lg">
              {vehicle.make} {vehicle.model}
            </h3>
            <div className="text-sm text-muted-foreground mt-1">
              {vehicle.category}
              {/* Only show regno if available, don't crash */}
              {vehicle.regNo && ` • ${vehicle.regNo}`}
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded w-fit">
              <span>{format(startDate, "MMM dd, yyyy h:mm a")}</span>
              <ArrowRight className="size-3" />
              <span>{format(endDate, "MMM dd, yyyy h:mm a")} (IST)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-muted-foreground">
              <span>{formatRentalLength(startDate, endDate)}</span>
              {vehicle.pricingBreakdown?.billedAs && (
                <span>· billed as {vehicle.pricingBreakdown.billedAs}</span>
              )}
              {(bookingData?.data?.rentalPeriodType === "MONTHLY" ||
                bookingData?.data?.plan === "MONTHLY") && (
                <span className="px-2 py-0.5 rounded-full bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-wide">
                  Monthly rental
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Price Breakdown */}
        <div className="bg-white p-4 rounded-xl border shadow-sm space-y-4">
          <h3 className="font-semibold">Price Details</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Base Price</span>
              <span>{formatPrice(totals?.grandBaseTotal)}</span>
            </div>
            {totals?.grandDiscountTotal > 0 && (
              <div className="flex justify-between text-green-600">
                {/* Walk-ins take no coupon: the discount is the duration slab */}
                <span>{totals.durationDiscountLabel ? durationDiscountTitle(totals.durationDiscountLabel) : "Discount"}</span>
                <span>-{formatPrice(totals.grandDiscountTotal)}</span>
              </div>
            )}

            {totals?.grandDiscountTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Taxable value</span>
                <span>
                  {formatPrice(round2(totals.grandBaseTotal - totals.grandDiscountTotal))}
                </span>
              </div>
            )}

            {/* Tax Breakdown — rates exactly as the server sent them, no fallback */}
            {totals?.grandTaxTotal > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {gstLabel("GST", totals.taxRate)}
                  </span>
                  <span>{formatPrice(totals.grandTaxTotal)}</span>
                </div>
                {totals.grandCGSTTotal !== undefined && (
                  <div className="flex justify-between text-xs text-muted-foreground pl-2">
                    <span>{gstLabel("CGST", totals.cgstRate)}</span>
                    <span>{formatPrice(totals.grandCGSTTotal)}</span>
                  </div>
                )}
                {totals.grandSGSTTotal !== undefined && (
                  <div className="flex justify-between text-xs text-muted-foreground pl-2">
                    <span>{gstLabel("SGST", totals.sgstRate)}</span>
                    <span>{formatPrice(totals.grandSGSTTotal)}</span>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-between">
              <span className="text-muted-foreground">Security Deposit</span>
              <span>{formatPrice(totals?.grandDeposit)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold text-base mt-2">
              <span>Total to Pay</span>
              <span>{formatPrice(totals?.grandFinalTotal)}</span>
            </div>
          </div>
        </div>


        {/* Payment Action */}
        <div className="bg-white rounded-xl border shadow-sm p-4 flex flex-col gap-3">
          {razorpay ? (
            <Button
              className="w-full h-12 text-lg font-semibold bg-primary hover:bg-primary/90"
              disabled={isPaying || isOpening}
              onClick={handleOnlinePayment}
            >
              {isPaying || isOpening
                ? "Opening secure payment…"
                : `Pay Now ${formatPrice(totals?.grandFinalTotal)}`}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="text-center text-green-600 font-medium p-3 bg-green-50 rounded-lg">
                {isUpiPayment
                  ? "UPI (UTR) Payment — Confirm Collection"
                  : "Cash Payment — Confirm Collection"}
                {isUpiPayment && bookingPayload?.utr && (
                  <p className="text-xs font-normal text-green-700 mt-1">
                    UTR <span className="font-mono">{bookingPayload.utr}</span>
                  </p>
                )}
              </div>
              <Button
                className="w-full h-12 text-lg font-semibold bg-green-600 hover:bg-green-700"
                disabled={isConfirming}
                onClick={() =>
                  isUpiPayment
                    ? void handleConfirmUpi()
                    : navigate(
                        `/employee/booking/status/${bookingData.data.transactionId}`,
                      )
                }
              >
                {isConfirming ? "Confirming…" : "Complete Booking"}
              </Button>
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowCancelDialog(true)}
          >
            Return to Dashboard
          </Button>
        </div>
      </main>
    </div>
  );
};
