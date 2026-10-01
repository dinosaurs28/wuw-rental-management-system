import { Prisma, RentalPeriodType } from "@repo/database/client";

/**
 * Daily vs Monthly split for the Fleet and Branch Manager booking lists (#17).
 *
 * Monthly = Booking.rentalPeriodType MONTHLY. Everything else is Daily,
 * including rows whose rentalPeriodType is NULL (legacy rows the backfill
 * missed), so no booking ever falls out of both tabs.
 */
export type BookingListType = "DAILY" | "MONTHLY";

export const BOOKING_LIST_TYPES: readonly BookingListType[] = ["DAILY", "MONTHLY"];

export const INVALID_BOOKING_TYPE = {
  success: false,
  code: "INVALID_BOOKING_TYPE",
  message: "type must be DAILY or MONTHLY. Leave it out to list every booking.",
} as const;

export type ParsedBookingListType =
  | { ok: true; type: BookingListType | undefined }
  | { ok: false };

/**
 * Parses the optional `?type=` query param. Case-insensitive; omitted, empty
 * or "ALL" means no split (old app builds never send it). Any other value is
 * rejected so a typo can't silently show the wrong tab.
 */
export const parseBookingListType = (raw: unknown): ParsedBookingListType => {
  if (raw === undefined || raw === null) return { ok: true, type: undefined };
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim().toUpperCase();
  if (value === "" || value === "ALL") return { ok: true, type: undefined };
  if (value === "DAILY" || value === "MONTHLY") return { ok: true, type: value };
  return { ok: false };
};

/** Prisma filter for one tab; an empty filter when no type was asked for. */
export const bookingTypeWhere = (type: BookingListType | undefined): Prisma.BookingWhereInput => {
  if (type === "MONTHLY") return { rentalPeriodType: RentalPeriodType.MONTHLY };
  if (type === "DAILY") {
    // `not: MONTHLY` alone would drop NULL rows (SQL NULL comparison), hence the OR.
    return {
      OR: [
        { rentalPeriodType: null },
        { rentalPeriodType: { not: RentalPeriodType.MONTHLY } },
      ],
    };
  }
  return {};
};

/** Tab a single booking belongs to. */
export const bookingListTypeOf = (
  rentalPeriodType: RentalPeriodType | string | null | undefined,
): BookingListType => (rentalPeriodType === RentalPeriodType.MONTHLY ? "MONTHLY" : "DAILY");
