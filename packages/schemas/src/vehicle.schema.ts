import { z } from "zod";
import { dlCollectionStatusSchema, dlDepositNoteSchema } from "./dl-status.js";

export const getVehicleDetailsSchema = z.object({
  id: z.string().min(16, "Vehicle ID length is invalid."),
});

export const bookingSummarySchema = z
  .object({
    vehicles: z.array(z.string().min(1)).optional().default([]),
    groupKeys: z.array(z.string().min(1)).optional().default([]),
    start: z.string().min(1),
    end: z.string().min(1),
    // KYC picture (X2): optional — the DL + Aadhaar NUMBERS gate the booking.
    // Blank / null is the same as omitted.
    file_public_id: z
      .string()
      .nullish()
      .transform((v) => v?.trim() || undefined),
    payment_type: z.enum(["CASH", "ONLINE"]),
    payment_flow: z.enum(["FULL", "ADVANCE"]).default("FULL"),
    couponCode: z.string().min(1).max(50).optional(),
  })
  .refine(
    (data) => (data.vehicles.length + (data.groupKeys?.length ?? 0)) > 0,
    { message: "At least one vehicle or group key is required", path: ["vehicles"] },
  );

export const VEHICLE_USE_CASES = ["HIGHWAY", "HILL_STATION", "LONG_DRIVE"] as const;
export type VehicleUseCaseValue = (typeof VEHICLE_USE_CASES)[number];
export const vehicleUseCaseSchema = z.enum(VEHICLE_USE_CASES);

/**
 * Normalises a multipart/query tag value (undefined, '', 'A', 'A,B', ['A','B']) into a
 * de-duplicated array. Unknown values are kept so the enum check can reject them.
 */
function toUseCaseArray(v: unknown): unknown {
  if (v === undefined || v === null) return v === null ? [] : undefined;
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [v];
  const out = parts
    .map((x) => (typeof x === "string" ? x.trim().toUpperCase() : x))
    .filter((x) => x !== "");
  return Array.from(new Set(out));
}

/** Lenient parser for the public listing filter: unknown values are dropped, not rejected. */
export function parseUseCasesFilter(v: unknown): VehicleUseCaseValue[] {
  const arr = toUseCaseArray(v);
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is VehicleUseCaseValue =>
    (VEHICLE_USE_CASES as readonly unknown[]).includes(x),
  );
}

export const useCasesFieldSchema = z.preprocess(
  toUseCaseArray,
  z.array(vehicleUseCaseSchema),
);

export const updateVehicleUseCasesSchema = z.object({
  useCases: useCasesFieldSchema.default([]),
});

/**
 * A per-unit charge rate (extra km / extra hour). Number("") is 0, so a cleared
 * form field used to save silently as ₹0 and make every later drop bill ₹0 — a
 * blank (or null) value is now a validation error. 0 itself is still allowed (a
 * deliberate "never charged"). Omitting the field keeps the default / stored value.
 */
const chargeRateField = (label: string) =>
  z
    .custom<unknown>((v) => !(v === null || (typeof v === "string" && v.trim() === "")), {
      message: `Enter the ${label} — 0 means it is never charged`,
    })
    .pipe(
      z.coerce
        .number({ invalid_type_error: `The ${label} must be a number` })
        .min(0, `The ${label} can't be negative`),
    )
    .optional();

/** Rate fields whose validation message is shown to the manager as-is. */
export const CHARGE_RATE_FIELDS = ["extraKmRate", "extraHourRate"] as const;

export const createVehicleSchema = z.object({
  make: z.string().min(1, "Make is required").transform((s) => s.trim().replace(/\s+/g, " ")),
  model: z.string().min(1, "Model is required").transform((s) => s.trim().replace(/\s+/g, " ")),
  year: z.coerce.number().int().min(1900).max(new Date().getFullYear() + 1).optional(),
  regNo: z.string().min(1, "Registration Number is required"),
  odo: z.coerce.number().min(0),
  insuranceExpiry: z.string(),
  categoryId: z.coerce.number().int().positive(),
  policyNumber: z.string().min(1, "Policy Number is required"),
  provider: z.string().min(1, "Provider is required"),

  // Custom Pricing Fields
  hourlyRate: z.coerce.number().min(0).optional(),
  price12Hour: z.coerce.number().min(0).optional(),
  freeKm12Hour: z.coerce.number().min(0).optional(),
  price24Hour: z.coerce.number().min(0).optional(),
  freeKm24Hour: z.coerce.number().min(0).optional(),
  priceMonthly: z.coerce.number().min(0).optional(),
  freeKmMonthly: z.coerce.number().min(0).optional(),
  extraKmRate: chargeRateField("extra km rate"),
  extraHourRate: chargeRateField("extra hour rate"),
  isCustomPricingEnabled: z
    .boolean()
    .or(z.string().transform((v) => v === "true"))
    .optional(),
  advancePayAmount: z.coerce.number().min(0).optional(),
  fuelBar: z.coerce.number().min(0).optional(),
  fastagNumber: z.string().optional(),
  hasFastag: z
    .boolean()
    .or(z.string().transform((v) => v === "true"))
    .optional()
    .default(false),
  // Trip-type tags. Multipart: single value => string, repeated => array, '' => [].
  // Absent key => default [] on create, untouched on edit (partial()).
  useCases: useCasesFieldSchema.default([]),
});

export const editVehicleSchema = createVehicleSchema.partial().extend({
  status: z.enum(["AVAILABLE", "MAINTENANCE", "INACTIVE"]).optional(),
  deleteImageIds: z.union([z.string(), z.array(z.string())]).optional(),
  thumbnailImageId: z.string().optional(),
});

export const pickUpVehicleSchema = z.object({
  odo: z.coerce.number().min(0),
  fuelLevel: z.coerce.number().min(0),
  pickupImageIds: z.array(z.string().min(1)).optional(),
  captureImages: z
    .array(z.object({ fileId: z.string().min(1), label: z.string().min(1) }))
    .optional(),
  requireManagerConfirmation: z.boolean().optional(),
  payRemainingAtPickup: z.boolean().optional(),
  // Licence custody (#3) is OPTIONAL (X1): dlStatus (+ dlDepositNote for DEPOSIT)
  // when staff record it; omitted or null ⇒ nothing recorded. Deprecated alias for
  // old builds: licenseCollected true ⇒ COLLECTED, false ⇒ NOT_COLLECTED.
  dlStatus: dlCollectionStatusSchema.nullish(),
  dlDepositNote: dlDepositNoteSchema.nullish(),
  licenseCollected: z.boolean().optional(),
});

export const managerConfirmPickupSchema = z.object({
  safetyDeposit: z.coerce.number().min(0),
  safetyDepositMethod: z.enum(["ONLINE_RAZORPAY", "CASH", "UPI"]).optional(),
});

export const createDamageReportSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
  odo: z.coerce.number().min(0, "Odometer reading must be non-negative"),
  fuelLevel: z.coerce
    .number()
    .min(0)
    .max(100, "Fuel level must be between 0 and 100"),
  severity: z.string().min(1, "Severity is required"),
  chargeType: z.enum(["PENALTY", "COMPENSATION"], {
    required_error: "Damage type is required",
  }),
  damageImageIds: z.array(z.string().min(1)),
  returnImageIds: z.array(z.string().min(1)),
  notes: z.record(z.any()).optional(),
});

export const closeDamageReportSchema = z.object({
  disposition: z.enum(["AVAILABLE", "MAINTENANCE", "DAMAGED"]),
  finalCost: z.coerce.number().min(0, "Final cost must be non-negative"),
  paymentMethod: z.enum(["CASH", "ONLINE_RAZORPAY", "SPLIT"]).optional(),
  chargeType: z.enum(["PENALTY", "COMPENSATION"]).optional(),
  cashAmount: z.coerce.number().min(0).optional(),
  onlineAmount: z.coerce.number().min(0).optional(),
  onlineTransactionRef: z.string().optional(),
}).superRefine((d, ctx) => {
  const needsOnlineRef =
    d.paymentMethod === "ONLINE_RAZORPAY" ||
    (d.paymentMethod === "SPLIT" && (d.onlineAmount ?? 0) > 0);
  if (needsOnlineRef && !d.onlineTransactionRef?.trim()) {
    ctx.addIssue({ code: "custom", message: "Transaction reference required for online portion", path: ["onlineTransactionRef"] });
  }
});

export const createDepositRuleSchema = z.object({
  categoryId: z.coerce.number().min(1, "Category is required"),
  amount: z.coerce.number().min(0, "Amount must be positive"),
});

export const updateDepositRuleSchema = z.object({
  amount: z.coerce.number().min(0, "Amount must be positive"),
});

export const pricingDiscountSlabSchema = z.object({
  categoryId: z.number().int().positive(),
  days: z.number().int().min(1),
  multiplier: z.number().min(0).max(1), // Assuming 0.1to 1.0 (e.g. 0.9 = 10% off) or 0-100? The prisma model says Decimal. Usually multipliers are like 0.9 for 10% off. Let's assume user inputs Multiplier factor.
  // User said "multiplier Decimal".
});

// Readings taken at a mid-rental swap. Optional in the body: the server requires
// all four when the booking is PICKED_UP (400 READINGS_REQUIRED) and ignores them
// on a swap before pickup. null / "" count as not sent.
const swapOdometerSchema = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.coerce
    .number({ invalid_type_error: "Odometer must be a number" })
    .int("Odometer must be a whole number")
    .min(0, "Odometer can't be negative")
    .optional(),
);
const swapFuelBarsSchema = z.preprocess(
  (v) => (v === null || v === "" ? undefined : typeof v === "number" ? String(v) : v),
  z
    .string()
    .regex(/^([1-9]|10)$/, "Fuel must be between 1 and 10 bars")
    .optional(),
);

export const vehicleSwapSchema = z
  .object({
    newVehicleId: z.coerce
      .number()
      .int()
      .positive("New vehicle ID is required"),
    reason: z.enum(
      [
        "CUSTOMER_REQUEST",
        "MAINTENANCE",
        "UPGRADE",
        "DOWNGRADE",
        "DAMAGE",
        "OTHER",
      ],
      {
        errorMap: () => ({ message: "Valid swap reason is required" }),
      },
    ),
    reasonNotes: z.string().max(500).optional(),
    markOriginalForMaintenance: z.boolean().optional().default(false),
    originalVehicleNotes: z.string().max(1000).optional(),
    originalVehicleEndOdometer: swapOdometerSchema,
    originalVehicleFuelLevel: swapFuelBarsSchema,
    newVehicleStartOdometer: swapOdometerSchema,
    newVehicleFuelLevel: swapFuelBarsSchema,
    // Bill the pro-rated price difference at drop. Omitted (old app builds) =
    // not billed; the difference is still stored on the swap for audit.
    chargeDifference: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // If marking for maintenance, notes should be provided
      if (data.markOriginalForMaintenance && !data.originalVehicleNotes) {
        return false;
      }
      return true;
    },
    {
      message:
        "Original vehicle notes are required when marking for maintenance",
      path: ["originalVehicleNotes"],
    },
  );

export const swapHistoryQuerySchema = z
  .object({
    bookingId: z.coerce.number().int().positive().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    vehicleId: z.coerce.number().int().positive().optional(),
    reason: z
      .enum([
        "CUSTOMER_REQUEST",
        "MAINTENANCE",
        "UPGRADE",
        "DOWNGRADE",
        "DAMAGE",
        "OTHER",
      ])
      .optional(),
  })
  .refine(
    (data) => {
      // If bookingId is not provided, startDate and endDate are required
      if (!data.bookingId && (!data.startDate || !data.endDate)) {
        return false;
      }
      return true;
    },
    {
      message:
        "Start date and end date are required when bookingId is not provided",
    },
  );
