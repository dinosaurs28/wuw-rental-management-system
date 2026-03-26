import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle, Clock, ArrowRight } from "lucide-react";

import { bookingService } from "@/services/booking.service";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import { Button } from "@/components/ui/button";
import { WhatsAppSupportButton } from "@/components/ui/WhatsAppSupportButton";

const MAX_RETRY_COUNT = 10;
const RETRY_DELAY_MS = 3000;
const COUNTDOWN_SECONDS = 10;

export const BookingStatusPage = () => {
  const navigate = useNavigate();
  const { transactionId } = useParams<{ transactionId: string }>();
  const [status, setStatus] = useState<
    "loading" | "success" | "failed" | "pending"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [retryCount, setRetryCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const { clearVehicleSelection } = useVehicleRentalStore();
  const retryCountRef = useRef(0);

  // Start countdown timer
  const startCountdown = useCallback(() => {
    setCountdown(COUNTDOWN_SECONDS);
  }, []);

  // Countdown effect
  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      navigate("/booking/history");
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
      const response = await bookingService.verifyOnlinePayment(transactionId);

      if (response.status === "Success") {
        setStatus("success");
        clearVehicleSelection();
        toast.success("Payment successful! Booking confirmed.");
        startCountdown();
      } else if (response.status === "Pending") {
        retryCountRef.current += 1;
        setRetryCount(retryCountRef.current);

        if (retryCountRef.current >= MAX_RETRY_COUNT) {
          // Max retries reached, show pending UI
          setStatus("pending");
          startCountdown();
        } else {
          // Retry after delay
          setTimeout(checkPaymentStatus, RETRY_DELAY_MS);
        }
      } else {
        // Failed
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
  }, [transactionId, clearVehicleSelection, startCountdown]);

  useEffect(() => {
    if (!transactionId) {
      toast.error("Invalid transaction. Redirecting...");
      navigate("/");
      return;
    }

    // Wait 5 seconds before checking payment status
    const timer = setTimeout(() => {
      checkPaymentStatus();
    }, 5000);

    return () => clearTimeout(timer);
  }, [transactionId, navigate, checkPaymentStatus]);

  // Countdown UI component
  const CountdownMessage = () => (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-muted-foreground">
        {countdown !== null && countdown > 0 ? (
          <>
            This page will automatically redirect to your booking history in{" "}
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
        <Link to="/booking/history">
          Go to My Booking History
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
                Verifying Payment
              </h2>
              <p className="text-sm text-muted-foreground">
                Please wait while we verify your payment.
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
                Your booking has been confirmed. Thank you for choosing us!
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
                Your payment is still being processed.
                <br />
                Please wait a few minutes and check your booking history.
              </p>
            </div>
            <CountdownMessage />
            <WhatsAppSupportButton
              variables={{ transactionId: transactionId ?? "" }}
              label="Contact Support"
            />
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
                {errorMessage || "Something went wrong with your payment."}
              </p>
            </div>
            <CountdownMessage />
            <WhatsAppSupportButton
              variables={{ transactionId: transactionId ?? "" }}
              label="Get Help on WhatsApp"
            />
          </>
        )}
      </div>
    </div>
  );
};
