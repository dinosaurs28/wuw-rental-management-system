import { z } from "zod";

export const getVehicleDetailsSchema = z.object({
  id: z.string().min(16, "Vehicle ID length is invalid."),
});

export const bookingSummarySchema = z
  .object({
    vehicles: z.array(z.string().min(1)).optional().default([]),
    groupKeys: z.array(z.string().min(1)).optional().default([]),
    start: z.string().min(1),
    end: z.string().min(1),
    file_public_id: z.string().min(1),
    payment_type: z.enum(["CASH", "ONLINE"]),
    payment_flow: z.enum(["FULL", "ADVANCE"]).default("FULL"),
    couponCode: z.string().min(1).max(50).optional(),
  })
  .refine(
    (data) => (data.vehicles.length + (data.groupKeys?.length ?? 0)) > 0,
    { message: "At least one vehicle or group key is required", path: ["vehicles"] },
  );

export const createVehicleSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
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
  extraKmRate: z.coerce.number().min(0).optional(),
  extraHourRate: z.coerce.number().min(0).optional(),
  isCustomPricingEnabled: z
    .boolean()
    .or(z.string().transform((v) => v === "true"))
    .optional(),
  advancePayAmount: z.coerce.number().min(0).optional(),
  fastagNumber: z.string().optional(),
  hasFastag: z
    .boolean()
    .or(z.string().transform((v) => v === "true"))
    .optional()
    .default(false),
});

export const editVehicleSchema = createVehicleSchema.partial().extend({
  status: z.enum(["AVAILABLE", "MAINTENANCE", "INACTIVE"]).optional(),
  deleteImageIds: z.string().optional(),
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
