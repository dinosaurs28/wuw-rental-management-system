import { useState } from "react";
import { Download, RefreshCw, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/axios";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

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

type ActionState = "idle" | "downloading" | "regenerating";

export function InvoiceDownloadButton({
  bookingId,
  bookingStatus,
}: InvoiceDownloadButtonProps) {
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  const shouldShow = bookingStatus === "CONFIRMED" || bookingStatus === "RETURNED";
  if (!shouldShow) return null;

  const isLoading = actionState !== "idle";

  const pollForInvoice = async (invoiceId: number) => {
    const maxAttempts = 40;
    const interval = 3000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, interval));

      try {
        const res = await apiClient.get(`/invoices/status/${invoiceId}`);
        const data = res.data;

        setProgress(data.progress || Math.round((attempt / maxAttempts) * 100));
        setMessage(`Generating... ${Math.round(data.progress || 0)}%`);

        if (data.state === "completed" && data.pdfUrl) {
          setMessage("Ready!");
          await new Promise((r) => setTimeout(r, 400));
          window.open(data.pdfUrl, "_blank");
          return;
        }

        if (data.state === "failed") {
          throw new Error("Invoice generation failed. Please try again.");
        }
      } catch (err: any) {
        if (attempt === maxAttempts) throw err;
      }
    }

    throw new Error("Invoice is taking too long. Please refresh and try again.");
  };

  const handleDownload = async () => {
    if (isLoading) return;
    setActionState("downloading");
    setMessage("Requesting invoice...");
    setProgress(0);

    try {
      const res = await apiClient.post("/invoices/download", { bookingId });
      const data = res.data;

      if (!data.success) throw new Error(data.message || "Failed to fetch invoice");

      if (data.cached && data.pdfUrl) {
        window.open(data.pdfUrl, "_blank");
        return;
      }

      if (data.generating) {
        setMessage(data.message || "Generating invoice...");
        await pollForInvoice(data.invoiceId);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to download invoice");
    } finally {
      setActionState("idle");
      setProgress(0);
      setMessage("");
    }
  };

  const handleRegenerate = async () => {
    if (isLoading) return;
    setActionState("regenerating");
    setMessage("Queueing regeneration...");
    setProgress(0);

    try {
      const res = await apiClient.post("/invoices/regenerate", { bookingId });
      const data = res.data;

      if (!data.success) throw new Error(data.message || "Failed to regenerate invoice");

      setMessage("Regenerating...");
      await pollForInvoice(data.invoiceId);
      toast.success("Invoice regenerated successfully");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to regenerate invoice");
    } finally {
      setActionState("idle");
      setProgress(0);
      setMessage("");
    }
  };

  if (isLoading) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="hidden sm:inline">Invoice</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Invoice</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={handleDownload} className="gap-2 cursor-pointer">
          <Download className="h-4 w-4" />
          Download Invoice
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleRegenerate} className="gap-2 cursor-pointer">
          <RefreshCw className="h-4 w-4" />
          Regenerate Invoice
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
