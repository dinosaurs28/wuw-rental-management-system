import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatRentalLength } from "@/utils/formatters";
import { toast } from "sonner";
import { ArrowLeft, Car, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { bookingService, bookingTotalsInclGst } from "@/services/booking.service";
import { useRazorpayCheckout } from "@/hooks/useRazorpayCheckout";
import { HoldCountdownTimer } from "@/components/booking/HoldCountdownTimer";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { useActiveShift } from "@/components/employee/counter/useActiveShift";
import { usePaymentStore } from "@/store/payment.store";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";
import { qrPhotoKeys } from "@/hooks/useQrPhoto";
import { apiErrorMessage, counterErrorCode } from "@/lib/counterErrors";
import {
  apiCode,
  counterPaymentErrorField,
  counterPaymentProblem,
  formatRupees,
  walkInPaymentFields,
  type CounterPaymentMethod,
  type CounterPaymentValue,
} from "@/lib/counterPayment";
import { CounterPaymentFields } from "@/components/payment/counter/CounterPaymentFields";
import { ProofPhotoThumb } from "@/components/payment/counter/ProofPhotoThumb";
import { CUSTOMER_PROFILE_INCOMPLETE } from "@/lib/customerProfile";
import { dlInUseToastOptions } from "@/lib/dlInUse";
import { gstLabel } from "@/lib/gst";
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
  // Set when the server refused the counter payment — the UPI photo (or an old
  // UTR), the split amounts or the collateral — at create, or at confirmation
  // after the hold was released. Staff fix it here and create again.
  const [paymentRetry, setPaymentRetry] = useState<{
    message: string;
    field: "proof" | "collateral" | "split" | null;
    /** The server's total (SPLIT_AMOUNT_MISMATCH), when it sent one. */
    total: number | null;
    /** Staff changed something since — the server message no longer applies. */
    edited: boolean;
  } | null>(null);
  const [retryPayment, setRetryPayment] = useState<CounterPaymentValue | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const { activeShift } = useActiveShift();
  const { upiProof } = useEmployeeBookingStore();
  const { openCheckout, isOpening } = useRazorpayCheckout();
  // Held in state so a payment retry can re-create with the corrected payload.
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

  const showPaymentRetry = useCallback((error: unknown, payload: { payment_type?: string } | undefined) => {
    const field = counterPaymentErrorField(error);
    const total = Number((error as { response?: { data?: { total?: unknown } } })?.response?.data?.total);
    const store = useEmployeeBookingStore.getState();
    const method = (["CASH", "UPI", "SPLIT", "CREDIT"] as const).find((m) => m === payload?.payment_type) ?? "UPI";
    setPaymentRetry({
      message: apiErrorMessage(error, "Check the payment details and try again."),
      field,
      total: Number.isFinite(total) && total > 0 ? total : null,
      edited: false,
    });
    setRetryPayment({
      method: method as CounterPaymentMethod,
      // A refused photo has to be taken again
      proof: field === "proof" ? null : store.upiProof,
      splitCash: store.splitCash,
      collateral: store.collateral,
    });
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

      // Payment photo / split / collateral refused — no hold was created, so
      // staff fix it here and create again.
      if (counterPaymentErrorField(error)) {
        showPaymentRetry(error, payload);
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
          // DL_IN_USE (X3): name the booking holding this driving licence
          dlInUseToastOptions(error),
        );
      }

      navigate(-1);
    } finally {
      setLoading(false);
    }
  }, [bookingPayload, navigate, showPaymentRetry, queryClient]);

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

  const handleRetryPayment = () => {
    if (!retryPayment) return;
    // Drop the refused payment fields (and an old UTR) and send the corrected ones
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { utr, proof_file_id, cash_amount, upi_amount, collateral, payment_type, ...rest } = bookingPayload ?? {};
    const payload = { ...rest, ...walkInPaymentFields(retryPayment) };
    // Keep the pricing card in sync if staff go back
    const store = useEmployeeBookingStore.getState();
    store.setPaymentType(retryPayment.method);
    store.setUpiProof(retryPayment.proof);
    store.setSplitCash(retryPayment.splitCash);
    store.setCollateral(retryPayment.collateral);
    setBookingPayload(payload);
    setPaymentRetry(null);
    setRetryPayment(null);
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

  if (paymentRetry && retryPayment) {
    const retryProblem = counterPaymentProblem(retryPayment, paymentRetry.total);
    const fieldErrors =
      paymentRetry.field && !paymentRetry.edited ? { [paymentRetry.field]: paymentRetry.message } : {};
    return (
      <div className="min-h-screen bg-zinc-50 pb-20">
        <DashboardNavbar />
        <main className="max-w-7xl mx-auto px-4 md:px-6 py-6">
          <div className="bg-white p-4 rounded-xl border shadow-sm space-y-4 max-w-md">
            <div>
              <h3 className="font-semibold">Fix the payment</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {paymentRetry.field
                  ? "The payment wasn't accepted. Correct it below to create the booking again."
                  : paymentRetry.message}
              </p>
            </div>
            <CounterPaymentFields
              idPrefix="walkin-retry"
              value={retryPayment}
              onChange={setRetryPayment}
              amount={paymentRetry.total}
              proofRole="staff"
              errors={fieldErrors}
              onEdit={() => setPaymentRetry((prev) => (prev ? { ...prev, edited: true } : prev))}
            />
            <Button
              className="w-full h-11 font-semibold"
              disabled={!!retryProblem || (!!paymentRetry.field && !paymentRetry.edited)}
              onClick={handleRetryPayment}
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
  // The rent incl. GST, its discounts and the GST inside it (item 17)
  const rentIncl = totals ? bookingTotalsInclGst(totals) : null;
  // Counter UPI / split / credit settle without a gateway: the server confirms
  // them directly (#3 / #11). Cash goes to the status page as before.
  const counterType =
    (["UPI", "SPLIT", "CREDIT"] as const).find(
      (t) =>
        bookingPayload?.payment_type === t ||
        (typeof transactionId === "string" && transactionId.startsWith(`${t}_`)),
    ) ?? null;

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

  // UPI / split / credit are confirmed here rather than on the status page because
  // the server re-checks the payment photo: if another payment claimed it meanwhile,
  // the hold is released (409 DUPLICATE_PAYMENT_PROOF; DUPLICATE_UTR for an old
  // UTR-backed hold) and staff take a new photo instead.
  const handleConfirmCounter = async () => {
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
      const code = apiCode(error);
      if (code === "DUPLICATE_UTR" || code === "DUPLICATE_PAYMENT_PROOF") {
        setBookingData(null);
        setHoldExpiresAt(null);
        showPaymentRetry(error, bookingPayload);
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
              <span>{vehicle.pricingBreakdown?.billedAs || formatRentalLength(startDate, endDate)}</span>
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
            {/* Rent is GST-inclusive (item 17): discounts come off it, GST is inside it */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rent (incl. GST)</span>
              <span>{formatPrice(rentIncl?.rent ?? 0)}</span>
            </div>
            {rentIncl && rentIncl.discount > 0 && (
              <div className="flex justify-between text-green-600">
                {/* Walk-ins take no coupon: the discount is the duration slab */}
                <span>{totals.durationDiscountLabel ? durationDiscountTitle(totals.durationDiscountLabel) : "Discount"}</span>
                <span>-{formatPrice(rentIncl.discount)}</span>
              </div>
            )}

            {rentIncl && rentIncl.discount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rent after discount</span>
                <span>{formatPrice(rentIncl.rentAfterDiscount)}</span>
              </div>
            )}

            {/* GST inside the rent — rates exactly as the server sent them, no fallback */}
            {totals?.grandTaxTotal > 0 && (
              <>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Rent without GST</span>
                  <span>{formatPrice(rentIncl?.rentWithoutGst ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {gstLabel("GST", totals.taxRate)} (included)
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
                {counterType === "UPI"
                  ? "UPI Payment — Confirm Collection"
                  : counterType === "SPLIT"
                    ? "Split Payment (Cash + UPI) — Confirm Collection"
                    : counterType === "CREDIT"
                      ? "On Credit — Confirm Booking"
                      : "Cash Payment — Confirm Collection"}
                {counterType === "SPLIT" && typeof bookingPayload?.cash_amount === "number" && (
                  <p className="text-xs font-normal text-green-700 mt-1">
                    Cash {formatRupees(bookingPayload.cash_amount)} · UPI the rest
                    {typeof totals?.grandFinalTotal === "number"
                      ? ` (${formatRupees(Math.max(0, totals.grandFinalTotal - bookingPayload.cash_amount))})`
                      : ""}
                  </p>
                )}
                {counterType === "CREDIT" && bookingPayload?.collateral && (
                  <p className="text-xs font-normal text-amber-700 mt-1">
                    Nothing is collected now — the total stays owed. Collateral held: {bookingPayload.collateral}
                  </p>
                )}
                {(counterType === "UPI" || counterType === "SPLIT") &&
                  upiProof &&
                  upiProof.proofFileId === bookingPayload?.proof_file_id && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-xs font-normal text-green-700">
                      <ProofPhotoThumb photo={upiProof} caption="Customer's UPI payment screen" size="md" />
                      Payment photo attached
                    </div>
                  )}
              </div>
              <Button
                className="w-full h-12 text-lg font-semibold bg-green-600 hover:bg-green-700"
                disabled={isConfirming}
                onClick={() =>
                  counterType
                    ? void handleConfirmCounter()
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
