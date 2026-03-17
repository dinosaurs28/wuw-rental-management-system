import { z } from "zod";

export const getVehicleDetailsSchema = z.object({
  id: z.string().min(16, "Vehicle ID length is invalid."),
});

export const bookingSummarySchema = z.object({
  vehicles: z.array(z.string().min(1)),
  start: z.string().min(1),
  end: z.string().min(1),
  file_public_id: z.string().min(1),
  payment_type: z.enum(["CASH", "ONLINE"]),
});

export const createVehicleSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  regNo: z.string().min(1, "Registration Number is required"),
  odo: z.coerce.number().min(0),
  insuranceExpiry: z.string(),
  baseDailyPrice: z.coerce.number().positive(),
  categoryId: z.coerce.number().int().positive(),
  policyNumber: z.string().min(1, "Policy Number is required"),
  provider: z.string().min(1, "Provider is required"),
});

export const editVehicleSchema = createVehicleSchema.partial().extend({
  status: z.enum(["AVAILABLE", "MAINTENANCE", "INACTIVE"]).optional(),
  deleteImageIds: z.string().optional(),
});

export const pickUpVehicleSchema = z.object({
  odo: z.coerce.number().min(0),
  fuelLevel: z.coerce.number().min(0),
  pickupImageIds: z.array(z.string().min(1)).optional(),
});

export const createDamageReportSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
  odo: z.coerce.number().min(0, "Odometer reading must be non-negative"),
  fuelLevel: z.coerce
    .number()
    .min(0)
    .max(100, "Fuel level must be between 0 and 100"),
  severity: z.string().min(1, "Severity is required"),
  damageImageIds: z.array(z.string().min(1)),
  returnImageIds: z.array(z.string().min(1)),
  notes: z.record(z.any()).optional(), // Structured JSON notes
});

export const closeDamageReportSchema = z.object({
  disposition: z.enum(["AVAILABLE", "MAINTENANCE", "DAMAGED"]),
  finalCost: z.coerce.number().min(0, "Final cost must be non-negative"),
  paymentMethod: z.enum(["CASH", "ONLINE_RAZORPAY"]).optional(),
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
