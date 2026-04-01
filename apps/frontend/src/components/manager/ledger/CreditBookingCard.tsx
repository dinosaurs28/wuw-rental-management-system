import { format } from "date-fns";
import type { CreditStatus, CustomerCreditEntry, EligibleBooking } from "@/services/ledger.service";

const statusBadgeVariant: Record<CreditStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  PARTIALLY_CLEARED: "bg-blue-100 text-blue-800",
  CLEARED: "bg-green-100 text-green-800",
};

const statusLabel: Record<CreditStatus, string> = {
  PENDING: "Pending",
  PARTIALLY_CLEARED: "Partially Cleared",
  CLEARED: "Cleared",
};

function formatAmount(val: string | number | null | undefined) {
  if (val == null) return "—";
  return `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  booking: EligibleBooking | CustomerCreditEntry;
  onClick: () => void;
  isSelected?: boolean;
  creditPublicId?: string;
}

export function CreditBookingCard({ booking, onClick, isSelected }: Props) {
  // Normalise shape whether it's EligibleBooking or CustomerCreditEntry
  const isEntry = "sections" in booking;

  const bookingData = isEntry
    ? (booking as CustomerCreditEntry).booking
    : (booking as EligibleBooking);

  const vehicle = isEntry
    ? (booking as CustomerCreditEntry).booking.items?.[0]?.vehicle ?? null
    : (booking as EligibleBooking).vehicle;

  const creditStatus: CreditStatus | null = isEntry
    ? (booking as CustomerCreditEntry).status
    : (booking as EligibleBooking).creditStatus;

  const pending = isEntry
    ? (booking as CustomerCreditEntry).pendingAmount
    : (booking as EligibleBooking).pendingAmount;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition-colors hover:bg-zinc-50 ${
        isSelected ? "border-orange-500 ring-2 ring-orange-200" : "border-zinc-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs text-zinc-500 font-mono">{bookingData.publicId}</p>
          {vehicle && (
            <p className="font-medium text-sm">
              {vehicle.make} {vehicle.model}{" "}
              <span className="text-zinc-500">· {vehicle.regNo}</span>
            </p>
          )}
          <p className="text-xs text-zinc-500">
            {format(new Date(bookingData.startAt), "dd MMM yyyy")} —{" "}
            {format(new Date(bookingData.endAt), "dd MMM yyyy")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {creditStatus && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeVariant[creditStatus]}`}
            >
              {statusLabel[creditStatus]}
            </span>
          )}
          {pending != null && (
            <span className="text-sm font-semibold text-orange-600">
              {formatAmount(pending)} pending
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
