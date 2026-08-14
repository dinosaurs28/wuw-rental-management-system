import { useNavigate } from "react-router-dom";
import { Lock, Calendar, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";

export interface TypeClassConflict {
  typeClass: "TWO_WHEELER" | "FOUR_WHEELER" | string;
  reason?: "ANY_VEHICLE";
  existingBookingPublicId: string;
  existingVehicleMake: string;
  existingVehicleModel: string;
  existingBookingStart: string;
  existingBookingEnd: string;
  existingBookingStatus: "HOLD" | "CONFIRMED" | "PICKED_UP" | string;
}

interface BookingTypeLimitModalProps {
  open: boolean;
  onClose: () => void;
  conflicts: TypeClassConflict[];
}

const STATUS_LABELS: Record<string, string> = {
  HOLD: "On Hold",
  CONFIRMED: "Confirmed",
  PICKED_UP: "Active",
};

const STATUS_STYLES: Record<string, string> = {
  HOLD: "bg-amber-100 text-amber-700 border-amber-200",
  CONFIRMED: "bg-blue-100 text-blue-700 border-blue-200",
  PICKED_UP: "bg-green-100 text-green-700 border-green-200",
};

const TYPE_LABEL: Record<string, string> = {
  TWO_WHEELER: "two-wheeler",
  FOUR_WHEELER: "four-wheeler",
};

function formatDate(iso: string) {
  try {
    return format(new Date(iso), "d MMM yyyy, h:mm a");
  } catch {
    return iso;
  }
}

export const BookingTypeLimitModal = ({
  open,
  onClose,
  conflicts,
}: BookingTypeLimitModalProps) => {
  const navigate = useNavigate();

  const handleViewBookings = () => {
    onClose();
    navigate("/my-bookings");
  };

  const handleChangeDates = () => {
    onClose();
    navigate("/vehicles");
  };

  const primaryConflict = conflicts[0];
  const isAnyVehicleMode = primaryConflict?.reason === "ANY_VEHICLE";
  const typeLabel = isAnyVehicleMode
    ? "vehicle"
    : (primaryConflict ? (TYPE_LABEL[primaryConflict.typeClass] ?? "vehicle") : "vehicle");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl gap-0">
        {/* Header strip */}
        <div className="bg-amber-950 px-6 pt-6 pb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-full bg-amber-800/60 border border-amber-700/40 flex items-center justify-center shrink-0">
                <Lock className="size-5 text-amber-300" strokeWidth={2.2} />
              </div>
              <DialogHeader className="space-y-0.5 text-left">
                <DialogTitle className="text-white text-[17px] font-bold leading-tight">
                  Booking Limit Reached
                </DialogTitle>
                <DialogDescription className="text-amber-300/80 text-sm leading-snug">
                  {isAnyVehicleMode
                    ? "Only one active booking is allowed at this branch at a time."
                    : `You can only have one active ${typeLabel} booking at a time.`}
                </DialogDescription>
              </DialogHeader>
            </div>
            <button
              onClick={onClose}
              className="text-amber-400/60 hover:text-amber-200 transition-colors mt-0.5 shrink-0"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Conflict cards */}
        <div className="px-6 py-5 space-y-3 bg-white">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">
            Conflicting Booking
          </p>

          {conflicts
            .filter((c) => c.existingBookingPublicId !== "INTRA_REQUEST")
            .map((conflict, i) => (
              <div
                key={i}
                className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 space-y-3"
              >
                {/* Vehicle + status */}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-zinc-900 text-sm">
                    {conflict.existingVehicleMake} {conflict.existingVehicleModel}
                  </span>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                      STATUS_STYLES[conflict.existingBookingStatus] ??
                      "bg-zinc-100 text-zinc-600 border-zinc-200"
                    }`}
                  >
                    {STATUS_LABELS[conflict.existingBookingStatus] ?? conflict.existingBookingStatus}
                  </span>
                </div>

                {/* Date range */}
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Calendar className="size-3.5 shrink-0 text-zinc-400" />
                  <span>{formatDate(conflict.existingBookingStart)}</span>
                  <ArrowRight className="size-3 shrink-0 text-zinc-300" />
                  <span>{formatDate(conflict.existingBookingEnd)}</span>
                </div>

                {/* Type badge — hidden in ANY_VEHICLE mode */}
                {!isAnyVehicleMode && (
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 border-zinc-200"
                  >
                    {TYPE_LABEL[conflict.typeClass] ?? conflict.typeClass}
                  </Badge>
                )}
              </div>
            ))}

          {/* Intra-request duplicate (no existing booking to show) */}
          {conflicts.some((c) => c.existingBookingPublicId === "INTRA_REQUEST") && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Your selection includes multiple vehicles of the same type. Please
              choose only one {typeLabel} per booking.
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 pb-6 pt-1 bg-white flex flex-col sm:flex-row gap-2.5">
          <Button
            onClick={handleViewBookings}
            className="flex-1 h-11 bg-zinc-900 hover:bg-zinc-700 text-white font-semibold rounded-xl text-sm"
          >
            View My Bookings
          </Button>
          <Button
            variant="outline"
            onClick={handleChangeDates}
            className="flex-1 h-11 border-zinc-200 text-zinc-700 hover:bg-zinc-50 font-semibold rounded-xl text-sm"
          >
            Change Dates
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
