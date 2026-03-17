import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/axios";

type BookingStatus =
  | "HOLD"
  | "CONFIRMED"
  | "PICKED_UP"
  | "RETURNED"
  | "CANCELLED"
  | "HOLD_EXPIRED";

interface InvoiceDownloadButtonProps {
  bookingId: number;
  bookingStatus: BookingStatus;
}

export function InvoiceDownloadButton({
  bookingId,
  bookingStatus,
}: InvoiceDownloadButtonProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  // Only show download button for:
  // - CONFIRMED bookings (active bookings)
  // - RETURNED bookings (past booking history)
  // Don't show for: CANCELLED, HOLD, HOLD_EXPIRED, PICKED_UP
  const shouldShowButton =
    bookingStatus === "CONFIRMED" || bookingStatus === "RETURNED";

  if (!shouldShowButton) {
    return null; // Don't render button for cancelled or other statuses
  }

  const handleDownload = async () => {
    setLoading(true);
    setMessage("Requesting invoice...");

    try {
      // Step 1: Request invoice using apiClient
      const response = await apiClient.post("/invoices/download", {
        bookingId,
      });
      const data = response.data;

      if (!data.success) {
        throw new Error(data.message || "Failed to generate invoice");
      }

      // CASE 1: PDF exists (cached) - Download immediately
      if (data.cached && data.pdfUrl) {
        setMessage("Opening invoice...");
        window.open(data.pdfUrl, "_blank");
        setLoading(false);
        return;
      }

      // CASE 2: PDF generating - Poll for completion
      if (data.generating) {
        setMessage(data.message || "Generating invoice...");
        await pollForInvoice(data.invoiceId);
      }
    } catch (error: any) {
      console.error("Error:", error);
      setMessage("");
      setLoading(false);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to download invoice";
      toast.error(errorMessage);
    }
  };

  const pollForInvoice = async (invoiceId: number) => {
    const maxAttempts = 40; // 40 attempts × 3 seconds = 2 minutes
    const interval = 3000; // 3 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await apiClient.get(`/invoices/status/${invoiceId}`);
        const data = response.data;

        if (!data.success) {
          throw new Error("Failed to check status");
        }

        // Update progress and message
        setProgress(data.progress || Math.round((attempt / maxAttempts) * 100));
        setMessage(
          data.message || `Generating... ${Math.round(data.progress || 0)}%`,
        );

        // Invoice completed!
        if (data.state === "completed" && data.pdfUrl) {
          setMessage("Invoice ready!");
          await new Promise((r) => setTimeout(r, 500)); // Brief pause
          window.open(data.pdfUrl, "_blank");
          setLoading(false);
          setProgress(0);
          return;
        }

        // Invoice failed
        if (data.state === "failed") {
          throw new Error("Invoice generation failed. Please try again.");
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, interval));
      } catch (error: any) {
        console.error(`Polling attempt ${attempt} failed:`, error);
        if (attempt === maxAttempts) {
          setMessage("");
          setProgress(0);
          throw error;
        }
      }
    }

    setLoading(false);
    setProgress(0);
    setMessage("");
    throw new Error(
      "Invoice generation is taking longer than expected. Please refresh and try again.",
    );
  };

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="hidden sm:inline">{message}</span>
          {progress > 0 && (
            <span className="text-xs ml-1">({Math.round(progress)}%)</span>
          )}
        </>
      ) : (
        <>
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Invoice</span>
        </>
      )}
    </button>
  );
}
