/**
 * Request rules for PATCH /employee/bookings/:id/pickup-session/handover (the
 * pickup's "Save & back to Payment" after staff go back to an earlier step).
 * No database here, so the rules are unit-tested on their own.
 *
 * Nov 21 2026 (client report: "Validation failed" under the licence choice on
 * step 4): the rules accept everything the app legitimately sends —
 *  - photo labels are the branch manager's capture-slot names, which have no
 *    length limit (initiate stores any) — up to PICKUP_PHOTO_LABEL_MAX now, not 80;
 *    a blank label means no label;
 *  - extra photos have no cap in the app — up to PICKUP_PHOTOS_MAX (initiate takes
 *    200 in photoOrder), not 60;
 *  - null / "" for a reading = not sent (older builds, other screens).
 */
import { z } from "zod";
import { DL_COLLECTION_STATUSES } from "@repo/schemas";
import { fuelBarsField } from "../charges/fuel-bars.js";
import { fastagBalanceField } from "../charges/fastag-usage.js";

export const PICKUP_PHOTOS_MAX = 200;
export const PICKUP_PHOTO_LABEL_MAX = 200;

const notSent = (v: unknown) => (v === null || v === "" ? undefined : v);

/**
 * A capture-slot label, kept exactly (it must equal the slot name, as initiate
 * stores it); blank / null = no label.
 */
export const pickupPhotoLabelField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().max(PICKUP_PHOTO_LABEL_MAX, `Photo names can have at most ${PICKUP_PHOTO_LABEL_MAX} characters`).nullish(),
);

export const pickupPhotoRefField = z.object({
  fileId: z.string({ message: "A photo is missing its file — take it again" }).trim().min(1, "A photo is missing its file — take it again"),
  label: pickupPhotoLabelField,
});

export const updatePickupHandoverSchema = z.object({
  odo: z.preprocess(
    notSent,
    z.coerce
      .number({ message: "Enter the odometer reading in km" })
      .int("Enter the odometer reading in whole km")
      .min(1, "Enter the odometer reading")
      .optional(),
  ),
  // percent 0..100 (vehicle row), as on initiate
  fuelLevel: z.preprocess(
    notSent,
    z.coerce.number({ message: "Select the fuel level" }).min(0, "Select the fuel level").max(100, "Select the fuel level").optional(),
  ),
  pickupFuelLevel: z.preprocess(notSent, fuelBarsField.optional()),
  pickupFastagBalance: fastagBalanceField,
  photos: z
    .array(pickupPhotoRefField)
    .min(1, "Keep at least one pickup photo")
    .max(PICKUP_PHOTOS_MAX, `Keep at most ${PICKUP_PHOTOS_MAX} pickup photos`)
    .optional(),
  dlStatus: z.enum(DL_COLLECTION_STATUSES).nullish(),
});

/** How the handover / initiate fields are named in an error message. */
export const PICKUP_FIELD_LABELS: Record<string, string> = {
  odo: "Odometer",
  fuelLevel: "Fuel level",
  pickupFuelLevel: "Fuel level",
  pickupFastagBalance: "FASTag balance",
  photos: "Photos",
  pickupImageIds: "Photos",
  captureImages: "Photos",
  photoOrder: "Photos",
  dlStatus: "Licence",
  dlDepositNote: "Licence note",
  pickupNote: "Pickup note",
  overrideRemainingBalance: "Balance",
  safetyDepositAmount: "Deposit amount",
  safetyDepositReason: "Deposit reason",
  discountCode: "Coupon code",
  pickupDiscount: "Discount",
  extensionPublicId: "Extension",
  amount: "Amount",
  reason: "Reason",
};
