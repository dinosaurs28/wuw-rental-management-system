import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface BookingQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingId: string;
  bookingStatus?: string;
}

// QR value encodes intent so the employee scanner can pre-determine the route.
// The scanner always does a live API verify before navigating.
function getQrValue(bookingId: string, bookingStatus?: string): string {
  if (bookingStatus === "CONFIRMED") return `pickup:${bookingId}`;
  if (bookingStatus === "PICKED_UP") return `return:${bookingId}`;
  return bookingId; // HOLD / CANCELLED / RETURNED — plain ID, scanner handles gracefully
}

export function BookingQRModal({
  isOpen,
  onClose,
  bookingId,
  bookingStatus,
}: BookingQRModalProps) {
  const [copied, setCopied] = useState(false);
  const qrValue = getQrValue(bookingId, bookingStatus);

  const handleCopyBookingId = async () => {
    try {
      await navigator.clipboard.writeText(bookingId);
      setCopied(true);
      toast.success("Booking ID copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy booking ID");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Booking QR Code</DialogTitle>
          <DialogDescription>
            Show this QR code at the pickup location
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-6">
          {/* QR Code */}
          <div className="rounded-lg bg-white p-4 shadow-sm border">
            <QRCodeSVG
              value={qrValue}
              size={200}
              level="H"
              includeMargin={true}
            />
          </div>

          {/* Booking ID display */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-muted-foreground">Booking ID</span>
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-3 py-1.5 font-mono text-sm">
                {bookingId}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleCopyBookingId}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
