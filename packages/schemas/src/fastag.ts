/**
 * FASTag balance read at pickup and at the drop (Oct 15 2026 client item).
 *
 * For a car with a FASTag, staff read the tag's balance at the handover
 * (Booking.pickupFastagBalance) and again when the car comes back
 * (Booking.returnFastagBalance); the drop bill charges the usage in between
 * as its FASTag line, with no GST. Both fields are optional on the wire so
 * older app builds keep working (the manual FASTag charge stays for them).
 */
import { z } from "zod";

/** Highest FASTag balance staff can enter (₹). */
export const FASTAG_BALANCE_MAX = 100000;

/** A FASTag balance in ₹: 0 … 1,00,000 with at most 2 decimals. '' / null = not sent. */
export const fastagBalanceSchema = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.coerce
    .number({ invalid_type_error: "FASTag balance must be an amount" })
    .min(0, "FASTag balance can't be negative")
    .max(FASTAG_BALANCE_MAX, "FASTag balance looks too large — check the figure")
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "FASTag balance can have at most 2 decimals")
    .optional(),
);
