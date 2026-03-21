import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle, Clock, ArrowRight } from "lucide-react";

import apiClient from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";

const MAX_RETRY_COUNT = 10;
const RETRY_DELAY_MS = 3000;
const COUNTDOWN_SECONDS = 10;

function getBookingPath(context: "pickup" | "return" | null, bookingPublicId: string | null): string {
  if (!context || !bookingPublicId) return "/employee/dashboard";
  return context === "pickup"
    ? `/staff/pickups/${bookingPublicId}`
    : `/employee/dashboard/return/${bookingPublicId}`;
}

export default function RemainingPaymentStatusPage() {
  const navigate = useNavigate();
  const { transactionId } = useParams<{ transactionId: string }>();

  const [status, setStatus] = useState<"loading" | "success" | "failed" | "pending">("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [retryCount, setRetryCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [redirectTarget, setRedirectTarget] = useState("/employee/dashboard");
  const retryCountRef = useRef(0);

  const startCountdown = useCallback(() => {
    setCountdown(COUNTDOWN_SECONDS);
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      navigate(redirectTarget);
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, navigate, redirectTarget]);

  const checkPaymentStatus = useCallback(async () => {
    if (!transactionId) return;

    try {
      const response = await apiClient.get(
        `/employee/payment/remaining-status/${transactionId}`,
      );
      const data = response.data;

      // Capture booking context from every response
      const bId: string | null = data.bookingPublicId ?? null;
      const ctx: "pickup" | "return" | null = data.context ?? null;
      const bookingPath = getBookingPath(ctx, bId);

      if (data.status === "SUCCESS") {
        setRedirectTarget(bookingPath);
        setStatus("success");
        toast.success("Remaining payment confirmed!");
        startCountdown();
      } else if (data.status === "PENDING") {
        retryCountRef.current += 1;
        setRetryCount(retryCountRef.current);

        if (retryCountRef.current >= MAX_RETRY_COUNT) {
          // Can't confirm — send to dashboard
          setRedirectTarget("/employee/dashboard");
          setStatus("pending");
          startCountdown();
        } else {
          setTimeout(checkPaymentStatus, RETRY_DELAY_MS);
        }
      } else {
        // FAILED — redirect back to booking page so employee can retry
        setRedirectTarget(bookingPath);
        setStatus("failed");
        setErrorMessage(data.message || "Payment failed. Please try again.");
        toast.error("Payment failed.");
        startCountdown();
      }
    } catch (error: any) {
      console.error("Remaining payment status check error:", error);
      setStatus("failed");
      const message = error?.response?.data?.message || "Payment verification failed";
      setErrorMessage(message);
      toast.error(message);
      startCountdown();
    }
  }, [transactionId, startCountdown]);

  useEffect(() => {
    if (!transactionId) {
      toast.error("Invalid transaction. Redirecting...");
      navigate("/employee/dashboard");
      return;
    }

    const timer = setTimeout(() => {
      checkPaymentStatus();
    }, 2000);

    return () => clearTimeout(timer);
  }, [transactionId, navigate, checkPaymentStatus]);

  const redirectLabel =
    status === "success" ? "Go to Booking" :
    status === "failed"  ? "Back to Booking" :
                           "Go to Dashboard";

  const CountdownMessage = () => (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-muted-foreground">
        {countdown !== null && countdown > 0 ? (
          <>
            Redirecting in{" "}
            <span className="font-semibold text-foreground">{countdown}s</span>.
            <br />
            If it doesn't redirect, click below.
          </>
        ) : (
          "Redirecting..."
        )}
      </p>
      <Button
        asChild
        className="w-full sm:w-auto h-12 px-6 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
      >
        <Link to={redirectTarget}>
          {redirectLabel}
          <ArrowRight className="ml-2 size-4" />
        </Link>
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <DashboardNavbar />
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-6 p-8 max-w-md w-full bg-white rounded-2xl shadow-sm border">

          {status === "loading" && (
            <>
              <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="size-10 text-primary animate-spin" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Verifying Payment
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
                  The remaining balance has been collected and recorded.
                </p>
              </div>
              <CountdownMessage />
            </>
          )}

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
                  The payment is still being processed.
                  <br />
                  Please check the booking status in the dashboard.
                </p>
              </div>
              <CountdownMessage />
            </>
          )}

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
                  {errorMessage || "Something went wrong with the transaction."}
                </p>
              </div>
              <CountdownMessage />
            </>
          )}

        </div>
      </div>
    </div>
  );
}
