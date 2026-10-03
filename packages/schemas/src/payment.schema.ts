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
  // Photo of the customer's UPI payment-success screen (POST …/payment/proof);
  // backs the UPI part instead of typing the UTR (#3)
  proof_file_id: z.string().trim().min(1).max(64).optional(),
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
      if (d.method === "ONLINE") return !!d.onlineTransactionRef || !!d.proof_file_id;
      return true;
    },
    { message: "onlineTransactionRef (or a proof_file_id photo for UPI) is required for ONLINE payments", path: ["onlineTransactionRef"] },
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
      if (d.method === "SPLIT") return !!d.onlineTransactionRef || !!d.proof_file_id;
      return true;
    },
    { message: "onlineTransactionRef (or a proof_file_id photo for UPI) is required for SPLIT payments", path: ["onlineTransactionRef"] },
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

/**
 * Opening float counted into the drawer. Optional (and null) so builds that
 * POST no body still open a shift — the server records 0 then.
 */
export const openCashShiftSchema = z.object({
  openingCash: z
    .number({ invalid_type_error: "Opening cash must be a number" })
    .min(0, "Opening cash cannot be negative")
    .max(1_000_000, "Opening cash cannot exceed ₹10,00,000")
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Opening cash can have at most 2 decimal places")
    .nullish(),
});

export const closeCashShiftSchema = z.object({
  actualTotal: z
    .number({ required_error: "Enter the cash counted in the drawer", invalid_type_error: "Counted cash must be a number" })
    .min(0, "Counted cash cannot be negative"),
  discrepancyExplanation: z
    .string()
    .min(10, "Explain the difference in at least 10 characters")
    .max(1000, "Keep the explanation under 1000 characters")
    .optional(),
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

/** An IST calendar date (YYYY-MM-DD). Shifts belong to the IST date they opened on. */
const istDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an IST date in YYYY-MM-DD format");

const queryFlagSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/**
 * status: ENDED = CLOSED + DISCREPANCY_FLAGGED (every shift that is no longer open).
 * date = one IST day; from/to = an inclusive IST range (date wins when both are sent).
 * openNow=true lists only shifts open right now and ignores the date filters.
 */
export const listCashShiftsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["OPEN", "CLOSED", "DISCREPANCY_FLAGGED", "ENDED"]).optional(),
  date: istDateSchema.optional(),
  from: istDateSchema.optional(),
  to: istDateSchema.optional(),
  openNow: queryFlagSchema.optional(),
  employeePublicId: z.string().min(1).max(64).optional(),
});

/** Fleet Executive's own shift history — same filters minus the executive picker. */
export const listMyCashShiftsSchema = listCashShiftsSchema.omit({ employeePublicId: true });
