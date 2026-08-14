import { z } from "zod";

// ─── Branch Payment Config ─────────────────────────────────────────────────

// Fields a MANAGER can update for their own branch
export const updateBranchPaymentConfigSchema = z.object({
  requireShiftSettlement: z.boolean().optional(),
  customerPaymentMode: z.enum(["ADVANCE_ONLY", "FULL_ONLY", "BOTH"]).optional(),
});

// Fields only ADMIN can change
export const updateBranchPaymentConfigAdminSchema = z.object({
  cashConfirmationEnabled: z.boolean().optional(),
  blockProgressionUntilConfirmed: z.boolean().optional(),
  maxCashPerEmployee: z.number().min(0).optional().nullable(),
  requireShiftSettlement: z.boolean().optional(),
  splitPaymentEnabled: z.boolean().optional(),
  crossBranchSettlementEnabled: z.boolean().optional(),
  refundApprovalRequired: z.boolean().optional(),
  onlineRefundEnabled: z.boolean().optional(),
  delayedCashAlertHours: z.number().int().min(1).max(72).optional(),
});

// ─── Record Payment ────────────────────────────────────────────────────────

const paymentPurposeEnum = z.enum([
  "ADVANCE",
  "REMAINING_BALANCE",
  "FULL_PAYMENT",
  "EXTENSION",
  "DAMAGE_FEE",
  "SAFETY_DEPOSIT",
  "OVERPAYMENT_REFUND",
  "CANCELLATION_REFUND",
]);

const paymentMethodEnum = z.enum(["CASH", "ONLINE", "SPLIT"]);

const recordPaymentBase = z.object({
  bookingPublicId: z.string().min(1),
  purpose: paymentPurposeEnum,
  method: paymentMethodEnum,
  totalAmount: z.number().positive(),
  cashAmount: z.number().min(0).optional().default(0),
  onlineAmount: z.number().min(0).optional().default(0),
  onlineTransactionRef: z.string().max(128).optional(),
  onlineGateway: z.string().max(64).optional(),
  idempotencyKey: z.string().min(1).max(64),
  notes: z.string().max(500).optional(),
});

export const recordPaymentSchema = recordPaymentBase
  .refine(
    (d) => {
      if (d.method === "CASH") return Math.abs(d.cashAmount - d.totalAmount) < 0.01;
      return true;
    },
    { message: "For CASH method, cashAmount must equal totalAmount", path: ["cashAmount"] },
  )
  .refine(
    (d) => {
      if (d.method === "ONLINE") return Math.abs(d.onlineAmount - d.totalAmount) < 0.01;
      return true;
    },
    { message: "For ONLINE method, onlineAmount must equal totalAmount", path: ["onlineAmount"] },
  )
  .refine(
    (d) => {
      if (d.method === "ONLINE") return !!d.onlineTransactionRef;
      return true;
    },
    { message: "onlineTransactionRef is required for ONLINE payments", path: ["onlineTransactionRef"] },
  )
  .refine(
    (d) => {
      if (d.method === "SPLIT") {
        const sum = (d.cashAmount ?? 0) + (d.onlineAmount ?? 0);
        return Math.abs(sum - d.totalAmount) < 0.01;
      }
      return true;
    },
    { message: "For SPLIT method, cashAmount + onlineAmount must equal totalAmount", path: ["totalAmount"] },
  )
  .refine(
    (d) => {
      if (d.method === "SPLIT") return !!d.onlineTransactionRef;
      return true;
    },
    { message: "onlineTransactionRef is required for SPLIT payments", path: ["onlineTransactionRef"] },
  );

// ─── Cash Confirmation ─────────────────────────────────────────────────────

export const confirmCashPaymentSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const rejectCashPaymentSchema = z.object({
  rejectionReason: z.string().min(5, "Rejection reason must be at least 5 characters").max(500),
});

// ─── Refund ────────────────────────────────────────────────────────────────

export const createRefundRequestSchema = z.object({
  bookingPublicId: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().min(10, "Please provide a detailed reason (at least 10 characters)").max(500),
  method: z.enum(["CASH", "ONLINE"]),
});

export const rejectRefundSchema = z.object({
  rejectionReason: z.string().min(5).max(500),
});

export const completeRefundSchema = z.object({
  onlineTransactionRef: z.string().max(128).optional(),
});

// ─── Cash Shift ────────────────────────────────────────────────────────────

export const closeCashShiftSchema = z.object({
  actualTotal: z.number().min(0),
  discrepancyExplanation: z.string().min(10).max(1000).optional(),
});

export const reconcileCashShiftSchema = z.object({
  discrepancyExplanation: z.string().min(10, "Please provide a detailed explanation").max(1000),
});

// ─── List / Query ──────────────────────────────────────────────────────────

export const listPendingCashSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  employeePublicId: z.string().optional(),
});

export const listPendingSettlementsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  minAmount: z.coerce.number().min(0).optional(),
});

export const listCashShiftsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["OPEN", "CLOSED", "DISCREPANCY_FLAGGED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
