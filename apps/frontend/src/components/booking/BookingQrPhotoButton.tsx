import { useState } from "react";
import { QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CustomerQrPhotoCard } from "@/components/booking/CustomerQrPhotoCard";
import { QR_PHOTO_LABEL } from "@/lib/qrPhoto";
import type { QrPhotoRole } from "@/hooks/useQrPhoto";

interface BookingQrPhotoButtonProps {
  bookingId: string;
  role: QrPhotoRole;
  customerName?: string | null;
  className?: string;
}

/**
 * Icon button for booking lists: opens the booking's customer QR code photo
 * (view, enlarge, and capture/replace while HOLD/CONFIRMED). The photo is only
 * fetched once the dialog is opened.
 */
export function BookingQrPhotoButton({
  bookingId,
  role,
  customerName,
  className,
}: BookingQrPhotoButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={className ?? "h-8 w-8 shrink-0 text-[#6b6860] hover:text-[#1a1917]"}
        aria-label={QR_PHOTO_LABEL}
        title={QR_PHOTO_LABEL}
        onClick={() => setOpen(true)}
      >
        <QrCode className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>{QR_PHOTO_LABEL}</DialogTitle>
            <DialogDescription>
              Booking #{bookingId.slice(-6).toUpperCase()}
              {customerName ? ` · ${customerName}` : ""}
            </DialogDescription>
          </DialogHeader>
          {open && <CustomerQrPhotoCard target={{ kind: "booking", role, bookingId }} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
