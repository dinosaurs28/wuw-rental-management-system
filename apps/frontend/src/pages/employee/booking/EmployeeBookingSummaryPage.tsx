import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft, Car, ArrowRight, Tag } from "lucide-react";

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
import { bookingService } from "@/services/booking.service";
import { CouponInput } from "@/components/discount/CouponInput";
import { employeeDiscountService } from "@/services/discount.service";
import { HoldCountdownTimer } from "@/components/booking/HoldCountdownTimer";

export const EmployeeBookingSummaryPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const initialized = useRef(false);

  // Two possible states:
  // 1. passed existing bookingData (legacy/direct view)
  // 2. passed bookingPayload (needs to create booking)
  const [bookingData, setBookingData] = useState<any>(
    location.state?.bookingData || null,
  );
  const [loading, setLoading] = useState(!location.state?.bookingData);
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const bookingPayload = location.state?.bookingPayload;

  useEffect(() => {
    const createBooking = async () => {
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

      try {
        const response =
          await bookingService.createEmployeeBooking(bookingPayload);

        // If CASH, we might want to redirect immediately or show success here as per new flow
        // The new flow guidelines say:
        // "If location.state.bookingPayload... Call createEmployeeBooking... On Success: render actual summary."
        // But wait, for CASH, the previous logic was to redirect to Status Page.
        // For ONLINE, stay here with Pay Now button.

        // Let's check response.
        if (!response.data.paymentURL) {
          // Cash Payment - Stay on page and show success/redirect button
        }

        setBookingData(response);
        if (response.data?.expiresAt) {
          setHoldExpiresAt(response.data.expiresAt);
        }
      } catch (error: any) {
        console.error("Booking creation failed", error);
        toast.error(
          error.response?.data?.message || "Failed to create booking",
        );
        navigate(-1);
      } finally {
        setLoading(false);
      }
    };

    createBooking();
  }, [bookingData, bookingPayload, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 pb-20">
        <header className="bg-white border-b px-4 py-4 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <main className="container mx-auto px-4 py-6 space-y-6">
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

  if (!bookingData) return null;

  const holdId = bookingData?.data?.bookingId;

  const handleCancelHold = async () => {
    if (!holdId) {
      navigate("/employee/dashboard");
      return;
    }
    setIsCancelling(true);
    try {
      await bookingService.cancelEmployeeHold(holdId);
      toast.info("Booking hold cancelled.");
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
    navigate("/employee/dashboard");
  };

  const {
    startDate: startDateString,
    endDate: endDateString,
    totals,
    paymentURL,
  } = bookingData?.data || {};

  const items = bookingData?.data?.items || [];
  const vehicle = items.length > 0 ? items[0] : null;

  if (!vehicle) {
    return <div className="p-4">No vehicle data found.</div>;
  }

  const startDate = new Date(startDateString);
  const endDate = new Date(endDateString);

  const formatPrice = (amount: number) => {
    return `₹ ${amount?.toLocaleString("en-IN") || "0"}`;
  };

  return (
    <div className="min-h-screen bg-zinc-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setShowCancelDialog(true)}>
              <ArrowLeft className="size-5" />
            </Button>
            <h1 className="text-lg font-semibold">Booking Summary</h1>
          </div>
          {holdExpiresAt && (
            <HoldCountdownTimer expiresAt={holdExpiresAt} onExpired={handleHoldExpired} />
          )}
        </div>
      </header>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
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

      <main className="container mx-auto px-4 py-6 space-y-6">
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
              <span>{format(startDate, "MMM dd, yyyy")}</span>
              <ArrowRight className="size-3" />
              <span>{format(endDate, "MMM dd, yyyy")} (IST)</span>
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
                <span>Discount</span>
                <span>-{formatPrice(totals.grandDiscountTotal)}</span>
              </div>
            )}

            {/* Tax Breakdown */}
            {totals?.grandTaxTotal > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Tax ({totals.taxRate}%)
                  </span>
                  <span>{formatPrice(totals.grandTaxTotal)}</span>
                </div>
                {totals.grandCGSTTotal !== undefined && (
                  <div className="flex justify-between text-xs text-muted-foreground pl-2">
                    <span>CGST ({(totals.taxRate || 18) / 2}%)</span>
                    <span>{formatPrice(totals.grandCGSTTotal)}</span>
                  </div>
                )}
                {totals.grandSGSTTotal !== undefined && (
                  <div className="flex justify-between text-xs text-muted-foreground pl-2">
                    <span>SGST ({(totals.taxRate || 18) / 2}%)</span>
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

        {/* Coupon Code */}
        {bookingData?.data?.publicId && (
          <div className="bg-white p-4 rounded-xl border shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-orange-500" />
              <h3 className="font-semibold text-sm">Coupon Code (optional)</h3>
            </div>
            <CouponInput
              appliedCode={appliedCoupon}
              onApply={async (code) => {
                try {
                  await employeeDiscountService.applyCoupon(bookingData.data.publicId, code);
                  setAppliedCoupon(code);
                  toast.success(`Coupon ${code} applied to booking.`);
                } catch (err: any) {
                  toast.error(err?.response?.data?.message || "Failed to apply coupon.");
                }
              }}
              onRemove={async () => {
                try {
                  await employeeDiscountService.removeCoupon(bookingData.data.publicId);
                  setAppliedCoupon(null);
                  toast.success("Coupon removed.");
                } catch (err: any) {
                  toast.error(err?.response?.data?.message || "Failed to remove coupon.");
                }
              }}
            />
          </div>
        )}

        {/* Payment Action */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t">
          <div className="container mx-auto max-w-md flex flex-col gap-3">
            {paymentURL ? (
              <Button
                className="w-full h-12 text-lg font-semibold bg-primary hover:bg-primary/90"
                onClick={() => (window.location.href = paymentURL)}
              >
                Pay Now {formatPrice(totals?.grandFinalTotal)}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="text-center text-green-600 font-medium p-3 bg-green-50 rounded-lg">
                  Cash Payment Confirmed
                </div>
                <Button
                  className="w-full h-12 text-lg font-semibold bg-green-600 hover:bg-green-700"
                  onClick={() =>
                    navigate(
                      `/employee/booking/status/${bookingData.data.transactionId}`,
                    )
                  }
                >
                  Complete Booking
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
        </div>
      </main>
    </div>
  );
};
