import { format, parseISO } from "date-fns";
import { EXTENSION_BUFFER_HOURS } from "@repo/schemas";
import { cn } from "@/lib/utils";
import type { ExtensionCarAvailability } from "@/services/extension.service";

interface ExtensionAvailabilityPanelProps {
  /** Staff eligibility / evaluate / commit response (server figures only). */
  availability: ExtensionCarAvailability | null | undefined;
  /** 30, or 180 for a monthly plan: names the cap when it is the limit. */
  maxBookingDays?: number;
  /** After the commit: availableUntil is how much further the car could still go. */
  afterExtension?: boolean;
  className?: string;
}

function fmt(iso: string) {
  return format(parseISO(iso), "dd MMM yyyy, hh:mm a");
}

/** "…AB12CD34": the tail of a booking id, as the Fleet screens show it. */
function shortRef(ref: string) {
  return `…${ref.slice(-8).toUpperCase()}`;
}

/**
 * The car's next booking and how far it can be extended, for the staff
 * Extend Booking steps: "Next booking on <reg>: <date, time> pickup" (or "No
 * upcoming booking") and "Available to extend until: <date, time>", 2 hours
 * before that pickup or the rental-length cap, saying which applies. Renders
 * nothing for an older server that doesn't send these fields.
 */
export function ExtensionAvailabilityPanel({
  availability,
  maxBookingDays,
  afterExtension = false,
  className,
}: ExtensionAvailabilityPanelProps) {
  if (!availability?.availableUntil || !availability.limitReason) return null;
  const reg = availability.vehicleRegNo ?? "This car";
  const buffer = availability.extensionBufferHours ?? EXTENSION_BUFFER_HOURS;
  const byNext = availability.limitReason === "NEXT_BOOKING";
  const limitText = byNext
    ? `${buffer} h before the next pickup`
    : maxBookingDays
      ? `${maxBookingDays}-day rental limit`
      : "rental-length limit";

  return (
    <div className={cn("rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm space-y-1.5", className)}>
      <div className="flex justify-between gap-3">
        <span className="text-neutral-500">Next booking on {availability.vehicleRegNo ?? "this car"}</span>
        <span className="text-right font-medium text-neutral-900">
          {availability.nextBookingStartAt ? `${fmt(availability.nextBookingStartAt)} pickup` : "No upcoming booking"}
        </span>
      </div>
      {availability.nextBookingStartAt && availability.nextBookingRef && (
        <p className="text-xs text-neutral-500 text-right -mt-1">
          {availability.nextBookingKind === "HOLD" ? "Customer checkout in progress" : "Booking"}{" "}
          {shortRef(availability.nextBookingRef)}
        </p>
      )}
      {availability.canExtend === false ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
          {byNext
            ? afterExtension
              ? `${reg} can't go any further: its next booking picks up within ${buffer} h of the new return.`
              : `${reg} can't be extended: its next booking picks up within ${buffer} h of the current return. A swap to another car may still be offered.`
            : afterExtension
              ? `The ${limitText} has been reached.`
              : `This booking is at the ${limitText}.`}
        </p>
      ) : (
        <div className="flex justify-between gap-3">
          <span className="text-neutral-500">{afterExtension ? "Could go further until" : "Available to extend until"}</span>
          <span className="text-right">
            <span className="font-semibold text-neutral-900">{fmt(availability.availableUntil)}</span>
            <span className="block text-xs text-neutral-500">{limitText}</span>
          </span>
        </div>
      )}
    </div>
  );
}
