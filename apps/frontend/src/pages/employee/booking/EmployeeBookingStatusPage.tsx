import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle, Clock, ArrowRight } from "lucide-react";

import { bookingService } from "@/services/booking.service";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";
import { Button } from "@/components/ui/button";

const MAX_RETRY_COUNT = 10;
const RETRY_DELAY_MS = 3000;
const COUNTDOWN_SECONDS = 10;

type ResolvedStatus = "success" | "failed" | "pending";

interface EmployeeBookingStatusLocationState {
  initialStatus?: ResolvedStatus;
  initialMessage?: string;
}

export const EmployeeBookingStatusPage = () => {
  const navigate = useNavigate();
  const { transactionId } = useParams<{ transactionId: string }>();
  // Checkout resolves the outcome in-page and passes it here. Arriving without
  // state (cash flow, a stale link) still falls back to polling the gateway.
  const { initialStatus, initialMessage } =
    (useLocation().state as EmployeeBookingStatusLocationState | null) ?? {};
  const [status, setStatus] = useState<
    "loading" | "success" | "failed" | "pending"
  >(initialStatus ?? "loading");
  const [errorMessage, setErrorMessage] = useState<string>(
    initialMessage ?? "",
  );
  const [retryCount, setRetryCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const { reset } = useEmployeeBookingStore();
  const retryCountRef = useRef(0);

  // Start countdown timer to auto-redirect
  const startCountdown = useCallback(() => {
    setCountdown(COUNTDOWN_SECONDS);
  }, []);

  // Countdown effect
  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      navigate("/employee/dashboard");
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, navigate]);

  const checkPaymentStatus = useCallback(async () => {
    if (!transactionId) return;

    try {
      const response = await bookingService.verifyEmployeePayment(transactionId);

      if (response.status === "Success") {
        setStatus("success");
        reset(); // Clear store
        toast.success("Payment successful! Booking confirmed.");
        startCountdown();
      } else if (response.status === "Pending") {
        retryCountRef.current += 1;
        setRetryCount(retryCountRef.current);

        if (retryCountRef.current >= MAX_RETRY_COUNT) {
          setStatus("pending");
          startCountdown();
        } else {
          setTimeout(checkPaymentStatus, RETRY_DELAY_MS);
        }
      } else {
        setStatus("failed");
        setErrorMessage(
          response.message || "Payment failed. Please try again.",
        );
        toast.error("Payment failed.");
        startCountdown();
      }
    } catch (error: any) {
      console.error("Payment verification error:", error);
      setStatus("failed");
      const message =
        error?.response?.data?.message || "Payment verification failed";
      setErrorMessage(message);
      toast.error(message);
      startCountdown();
    }
  }, [transactionId, reset, startCountdown]);

  useEffect(() => {
    if (!transactionId) {
      toast.error("Invalid transaction. Redirecting...");
      navigate("/employee/dashboard");
      return;
    }

    // Outcome already known from Checkout — render it without re-polling.
    if (initialStatus) {
      if (initialStatus === "success") {
        reset();
        toast.success("Payment successful! Booking confirmed.");
      }
      startCountdown();
      return;
    }

    const timer = setTimeout(() => {
      checkPaymentStatus();
    }, 3000);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId, navigate, checkPaymentStatus, initialStatus]);

  // Countdown UI component
  const CountdownMessage = () => (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-muted-foreground">
        {countdown !== null && countdown > 0 ? (
          <>
            This page will automatically redirect to dashboard in{" "}
            <span className="font-semibold text-foreground">{countdown}s</span>.
            <br />
            If it doesn't, click the button below.
          </>
        ) : (
          "Redirecting..."
        )}
      </p>
      <Button
        asChild
        className="w-full sm:w-auto h-12 px-6 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
      >
        <Link to="/employee/dashboard">
          Go to Dashboard
          <ArrowRight className="ml-2 size-4" />
        </Link>
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center space-y-6 p-8 max-w-md w-full">
        {/* Loading State */}
        {status === "loading" && (
          <>
            <div className="relative">
              <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="size-10 text-primary animate-spin" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Verifying Employee Payment
              </h2>
              <p className="text-sm text-muted-foreground">
                Please wait while we confirm the transaction.
                <br />
                Do not close this page.
              </p>
              {retryCount > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  Checking... ({retryCount}/{MAX_RETRY_COUNT})
                </p>
              )}
            </div>
          </>
        )}

        {/* Success State */}
        {status === "success" && (
          <>
            <div className="w-20 h-20 mx-auto rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="size-10 text-green-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Payment Successful!
              </h2>
              <p className="text-sm text-muted-foreground">
                Booking confirmed and amount collected.
              </p>
            </div>
            <CountdownMessage />
          </>
        )}

        {/* Pending State (after max retries) */}
        {status === "pending" && (
          <>
            <div className="w-20 h-20 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="size-10 text-amber-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Payment Pending
              </h2>
              <p className="text-sm text-muted-foreground">
                Payment is still processing. Check booking status in dashboard
                later.
              </p>
            </div>
            <CountdownMessage />
          </>
        )}

        {/* Failed State */}
        {status === "failed" && (
          <>
            <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <XCircle className="size-10 text-red-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Payment Failed
              </h2>
              <p className="text-sm text-muted-foreground">
                {errorMessage || "Something went wrong with the payment."}
              </p>
            </div>
            <CountdownMessage />
          </>
        )}
      </div>
    </div>
  );
};
