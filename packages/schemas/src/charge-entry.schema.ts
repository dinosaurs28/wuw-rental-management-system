import { z } from "zod";

const fuelLevelEnum = z.enum(["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]);

// ── Fastag configuration (on Vehicle) ────────────────────────────────────────

export const updateVehicleFastagSchema = z.object({
  fastagNumber: z.string().min(1, "Fastag number is required").nullable(),
  hasFastag: z.boolean(),
});

// ── Pickup baseline data ──────────────────────────────────────────────────────

export const chargePickupDataSchema = z.object({
  // Fuel module input — validated server-side against frozenChargeConfig
  pickupFuelLevel: fuelLevelEnum.optional(),

  // Safety deposit request — optional, only when safetyDepositEnabled
  safetyDepositRequest: z
    .object({
      requestedAmount: z.coerce.number().positive("Amount must be positive"),
      reason: z.string().min(1, "Reason is required"),
    })
    .optional(),
});

// ── Return charge inputs ──────────────────────────────────────────────────────

export const chargeReturnDataSchema = z
  .object({
    // Return fuel level (required when fuelModuleEnabled)
    returnFuelLevel: fuelLevelEnum.optional(),

    // Fuel deficit handling (at most one of these per return when deficit detected)
    fuelDeficitCharge: z.coerce.number().min(0).optional(),
    fuelSkipReason: z.string().min(1).optional(),

    // Fastag (required when fastagModuleEnabled && vehicle.hasFastag)
    fastagAmount: z.coerce.number().min(0).optional(),
    fastagNotes: z.string().optional(),

    // Manual grace trigger (only when graceType = MANUAL)
    applyGrace: z.boolean().optional(),
  });

// ── Employee charge override ──────────────────────────────────────────────────

export const chargeOverrideSchema = z.object({
  overriddenAmount: z.coerce.number().min(0, "Override amount must be non-negative"),
  reason: z.string().min(1, "Reason is required for all overrides"),
});

// ── Override approval / rejection ────────────────────────────────────────────

export const approveOverrideSchema = z.object({});

export const rejectOverrideSchema = z.object({
  rejectionReason: z.string().min(1, "Rejection reason is required"),
});

// ── Safety deposit approval / rejection ──────────────────────────────────────

export const approveSafetyDepositSchema = z.object({
  approvedAmount: z.coerce.number().positive("Approved amount must be positive"),
});

export const rejectSafetyDepositSchema = z.object({
  rejectionReason: z.string().min(1, "Rejection reason is required"),
});

// ── Settlement confirmation ───────────────────────────────────────────────────

export const confirmSettlementSchema = z.object({
  chargeConfigVersion: z.coerce
    .number()
    .int()
    .positive("Charge config version is required"),
  paymentMethod: z.enum(["CASH", "ONLINE", "SPLIT"]).optional(),
  cashAmount: z.coerce.number().min(0).optional(),
  onlineAmount: z.coerce.number().min(0).optional(),
  onlineTransactionRef: z.string().optional(),
});

// ── Exported types ────────────────────────────────────────────────────────────

export type UpdateVehicleFastagInput = z.infer<typeof updateVehicleFastagSchema>;
export type ChargePickupDataInput = z.infer<typeof chargePickupDataSchema>;
export type ChargeReturnDataInput = z.infer<typeof chargeReturnDataSchema>;
export type ChargeOverrideInput = z.infer<typeof chargeOverrideSchema>;
export type ConfirmSettlementInput = z.infer<typeof confirmSettlementSchema>;
