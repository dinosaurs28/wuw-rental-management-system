import { z } from "zod";

// ── Employee / Manager: Evaluate Extension ────────────────────────────────────

export const evaluateExtensionSchema = z.object({
  bookingPublicId: z.string().min(1),
  newEndAt: z.string().datetime({ message: "newEndAt must be an ISO 8601 datetime string" }),
  notes: z.string().max(500).optional(),
});

// ── Employee / Manager: Commit Extension ─────────────────────────────────────

export const commitExtensionSchema = z.object({
  extensionPublicId: z.string().min(1),
  resolutionType: z.enum([
    "SAME_VEHICLE",
    "SWAP_CURRENT_TO_OTHER",
    "SWAP_FUTURE_BOOKING",
    "PARTIAL_EXTENSION",
  ]),
  selectedVehiclePublicId: z.string().optional(),
  affectedBookingSwaps: z
    .array(
      z.object({
        bookingPublicId: z.string().min(1),
        newVehiclePublicId: z.string().min(1),
      }),
    )
    .optional(),
  partialNewEndAt: z
    .string()
    .datetime({ message: "partialNewEndAt must be an ISO 8601 datetime string" })
    .optional(),
  idempotencyKey: z.string().min(1).max(64),
  notes: z.string().max(500).optional(),
})
  .refine(
    (d) => {
      if (d.resolutionType === "SWAP_CURRENT_TO_OTHER") return !!d.selectedVehiclePublicId;
      return true;
    },
    { message: "selectedVehiclePublicId is required when resolutionType is SWAP_CURRENT_TO_OTHER", path: ["selectedVehiclePublicId"] },
  )
  .refine(
    (d) => {
      if (d.resolutionType === "SWAP_FUTURE_BOOKING")
        return Array.isArray(d.affectedBookingSwaps) && d.affectedBookingSwaps.length > 0;
      return true;
    },
    { message: "affectedBookingSwaps is required when resolutionType is SWAP_FUTURE_BOOKING", path: ["affectedBookingSwaps"] },
  )
  .refine(
    (d) => {
      if (d.resolutionType === "PARTIAL_EXTENSION") return !!d.partialNewEndAt;
      return true;
    },
    { message: "partialNewEndAt is required when resolutionType is PARTIAL_EXTENSION", path: ["partialNewEndAt"] },
  );

// ── Customer: Evaluate Extension ─────────────────────────────────────────────

export const customerEvaluateExtensionSchema = z.object({
  newEndAt: z.string().datetime({ message: "newEndAt must be an ISO 8601 datetime string" }),
  notes: z.string().max(500).optional(),
});

// ── Customer: Commit Extension (online only) ──────────────────────────────────

export const customerCommitExtensionSchema = z.object({
  extensionPublicId: z.string().min(1),
  onlineTransactionRef: z.string().min(1),
  onlineGateway: z.string().optional(),
  idempotencyKey: z.string().min(1).max(64),
});

// ── Cancel Extension ──────────────────────────────────────────────────────────

export const cancelExtensionSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ── List Extensions ───────────────────────────────────────────────────────────

export const listExtensionsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(["PENDING_PAYMENT", "PAYMENT_COLLECTED", "CONFIRMED", "REJECTED", "CANCELLED"])
    .optional(),
  bookingPublicId: z.string().optional(),
  trigger: z
    .enum([
      "CUSTOMER_BEFORE_PICKUP",
      "CUSTOMER_AFTER_PICKUP",
      "EMPLOYEE_AT_PICKUP",
      "EMPLOYEE_DURING_RENTAL",
    ])
    .optional(),
});
