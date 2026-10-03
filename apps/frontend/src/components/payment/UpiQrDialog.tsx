import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpiQrPayment } from "@/hooks/useUpiQrPayment";
import type { UpiQrView } from "@/services/upiQr.service";
import { UpiQrPanel } from "./UpiQrPanel";

interface UpiQrPayButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/** Secondary option under the normal Pay button: pay by scanning a UPI QR from another phone. */
export function UpiQrPayButton({ onClick, disabled, className }: UpiQrPayButtonProps) {
  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        onClick={onClick}
        disabled={disabled}
        className="h-12 w-full rounded-xl border-[#FF5F00]/40 bg-white text-base font-semibold text-[#c74a00] hover:bg-orange-50 hover:text-[#c74a00]"
      >
        <QrCode className="mr-2 size-5" />
        Pay by scanning a UPI QR
      </Button>
      <p className="mt-1.5 text-center text-xs text-muted-foreground">
        No UPI app on this device? Scan the QR with any UPI app on another phone.
      </p>
    </div>
  );
}

interface BookingUpiQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Booking publicId — the hold id returned when the booking was created. */
  bookingId: string;
  holdExpiresAt: string | null;
  /** The QR payment confirmed the booking — run the existing success flow. */
  onConfirmed: (view: UpiQrView) => void;
  /** The booking was already paid by another channel — let the status page confirm it. */
  onAlreadyPaid: () => void;
  /** The hold is over — start the booking again. */
  onRestart: () => void;
}

/**
 * Booking payment by UPI QR (TODO #2), next to Razorpay Checkout. Pays the
 * hold's existing Razorpay order, so it is never a second charge. Closing the
 * dialog closes the QR (a payment that already landed is still applied).
 */
export function BookingUpiQrDialog({
  open,
  onOpenChange,
  bookingId,
  holdExpiresAt,
  onConfirmed,
  onAlreadyPaid,
  onRestart,
}: BookingUpiQrDialogProps) {
  const qr = useUpiQrPayment({ target: { bookingId }, onConfirmed });
  const { start, reset, close } = qr;
  const handledErrorRef = useRef<unknown>(null);

  // A fresh QR each time the dialog opens (the server hands back a still-open one)
  useEffect(() => {
    if (!open) return;
    reset();
    void start();
  }, [open, reset, start]);

  // Paid already (any channel): the status page confirms it — once per answer
  useEffect(() => {
    if (qr.error?.code === "BOOKING_ALREADY_PAID" && handledErrorRef.current !== qr.error) {
      handledErrorRef.current = qr.error;
      onAlreadyPaid();
    }
  }, [qr.error, onAlreadyPaid]);

  async function leave() {
    if (qr.view?.outcome === "PENDING") {
      const result = await close();
      if (!result.ok) {
        toast.error(result.message);
      } else if (
        result.view?.outcome === "CONFIRMED" ||
        result.view?.outcome === "REFUND_REQUIRED"
      ) {
        // The payment had landed: stay to show it (CONFIRMED moves on by itself)
        return;
      }
    }
    onOpenChange(false);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void leave())}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto bg-white sm:max-w-md"
        // A stray tap outside must not close a QR the customer may be paying
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Pay by scanning a UPI QR</DialogTitle>
          <DialogDescription>
            Scan with any UPI app on another phone. This QR pays this booking only.
          </DialogDescription>
        </DialogHeader>
        <UpiQrPanel
          qr={qr}
          kind="booking"
          holdExpiresAt={holdExpiresAt}
          onRestart={() => {
            onOpenChange(false);
            reset();
            onRestart();
          }}
          onPayAnotherWay={() => void leave()}
          onDone={() => void leave()}
          onViewConfirmed={onConfirmed}
        />
      </DialogContent>
    </Dialog>
  );
}
