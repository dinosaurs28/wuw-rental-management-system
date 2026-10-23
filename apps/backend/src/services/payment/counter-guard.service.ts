/**
 * Counter guards — shared rules for money taken at the branch counter.
 *
 *  - Staff must have an OPEN cash shift before they create a booking or
 *    record any payment or refund (cash, UPI, card, split), so every rupee
 *    lands in a shift (lockShiftForPayment links it, race-safe with a close).
 *  - A UPI payment is recorded by its 12-digit UTR (no screenshot). A UTR can
 *    back only one payment, which stops the same transfer being claimed twice.
 *
 * Controllers catch `CounterGuardError` and reply with its `status` and
 * `{ message, code }` so clients can branch on the code (e.g. show an
 * "Open shift" button for SHIFT_REQUIRED).
 */
import { prisma, Role } from "@repo/database/client";
import type { CashShift, Prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { shiftForPayment } from "./cash-shift-rules.js";

export type CounterGuardCode =
  | "SHIFT_REQUIRED"
  | "INVALID_UTR"
  | "DUPLICATE_UTR"
  // UPI payment-proof photo (#3) — services/payment/payment-proof.service.ts
  | "PAYMENT_PROOF_REQUIRED"
  | "INVALID_PAYMENT_PROOF"
  | "DUPLICATE_PAYMENT_PROOF"
  // CREDIT payment option (#11) — services/payment/customer-credit.service.ts
  | "COLLATERAL_REQUIRED"
  | "CREDIT_NOT_FOR_DEPOSIT"
  | "INVALID_PAYMENT_METHOD"
  | "SPLIT_AMOUNT_MISMATCH"
  // Money on customer credit is collected only by clearing it (Customer Credit page)
  | "AMOUNT_ON_CREDIT";

export class CounterGuardError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: CounterGuardCode,
    message: string,
    /** Extra fields for the client, e.g. `proofPosition` (which payment photo, 1–3). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CounterGuardError";
  }

  toJSON() {
    return { success: false, message: this.message, code: this.code, ...this.details };
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

export const SHIFT_REQUIRED_MESSAGE = "Open your cash shift before taking bookings or collecting payments.";

/**
 * Throws SHIFT_REQUIRED unless the user has an OPEN cash shift. Only STAFF
 * are gated — managers and admins don't run counter shifts.
 */
export async function assertOpenShift(
  user: { id: number; role: Role | string },
  db: Db = prisma,
): Promise<CashShift | null> {
  if (user.role !== Role.STAFF) return null;
  const shift = await db.cashShift.findFirst({
    where: { employeeId: user.id, status: "OPEN" },
  });
  if (!shift) {
    throw new CounterGuardError(
      StatusCode.FORBIDDEN,
      "SHIFT_REQUIRED",
      SHIFT_REQUIRED_MESSAGE,
    );
  }
  return shift;
}

/**
 * The collector's OPEN cash shift for a payment being written — call it INSIDE
 * the payment's transaction, before the insert (ideally first, so the lock
 * order is shift → booking everywhere).
 *
 * The row is locked FOR SHARE: a manager's close (FOR UPDATE on the same row)
 * waits until this payment commits and then counts it; a payment that arrives
 * while a close is running waits, re-reads the row as CLOSED and gets none, so
 * a payment never lands in a closed shift.
 *
 * Fleet Executives (STAFF) must have one for every payment or refund they
 * record (any method) — SHIFT_REQUIRED otherwise. Managers / admins get their
 * own open shift if they have one, else null. `role` is looked up when not given.
 */
export async function lockShiftForPayment(
  tx: Prisma.TransactionClient,
  user: { id: number; role?: Role | string | null },
  /** optional: money already captured by a gateway — link when open, never refuse. */
  opts: { optional?: boolean } = {},
): Promise<{ id: number; publicId: string } | null> {
  let role = user.role ?? null;
  if (!role) {
    const found = await tx.user.findUnique({ where: { id: user.id }, select: { role: true } });
    role = found?.role ?? null;
  }
  const rows = await tx.$queryRaw<{ id: number; publicId: string }[]>`
    SELECT "id", "publicId" FROM "CashShift"
    WHERE "employeeId" = ${user.id} AND "status" = 'OPEN'
    ORDER BY "openedAt" DESC
    LIMIT 1
    FOR SHARE`;
  const { shift, missing } = shiftForPayment(String(role ?? ""), rows[0] ?? null);
  if (missing && !opts.optional) {
    throw new CounterGuardError(StatusCode.FORBIDDEN, "SHIFT_REQUIRED", SHIFT_REQUIRED_MESSAGE);
  }
  return shift ? { id: Number(shift.id), publicId: shift.publicId } : null;
}

const UTR_PATTERN = /^\d{12}$/;

/** Strips spaces/dashes and checks the 12-digit UPI UTR format. */
export function normalizeUtr(raw: string | null | undefined): string {
  const utr = (raw ?? "").replace(/[\s-]/g, "");
  if (!UTR_PATTERN.test(utr)) {
    throw new CounterGuardError(
      StatusCode.BAD_REQUEST,
      "INVALID_UTR",
      "Enter the 12-digit UTR number from the customer's UPI app.",
    );
  }
  return utr;
}

/**
 * Throws DUPLICATE_UTR if the UTR already backs a live payment. Failed,
 * rejected and voided transactions don't count — the customer may legitimately
 * retry, and a wrong entry voided (Oct 2026) can be recorded again correctly.
 */
export async function assertUtrUnused(utr: string, db: Db = prisma): Promise<void> {
  const exact = await db.paymentTransaction.findFirst({
    where: {
      onlineTransactionRef: utr,
      status: { notIn: ["FAILED", "REJECTED", "VOIDED"] },
    },
    select: { publicId: true },
  });
  // References recorded before UTRs were normalised may still carry the
  // spaces or dashes staff typed, so compare those with them stripped too.
  const existing =
    exact ??
    (
      await db.$queryRaw<{ publicId: string }[]>`
        SELECT "publicId" FROM "PaymentTransaction"
        WHERE regexp_replace("onlineTransactionRef", '[[:space:]-]', '', 'g') = ${utr}
          AND status NOT IN ('FAILED', 'REJECTED', 'VOIDED')
        LIMIT 1`
    )[0];
  if (existing) {
    throw new CounterGuardError(
      StatusCode.CONFLICT,
      "DUPLICATE_UTR",
      "This UTR has already been used for another payment.",
    );
  }
}

/** normalizeUtr + assertUtrUnused in one call; returns the clean UTR. */
export async function validateNewUtr(raw: string | null | undefined, db: Db = prisma): Promise<string> {
  const utr = normalizeUtr(raw);
  await assertUtrUnused(utr, db);
  return utr;
}

/**
 * Race-safe UTR claim. Call INSIDE the interactive transaction that creates
 * the PaymentTransaction carrying the UTR: it takes a transaction-scoped
 * advisory lock on the UTR, then re-checks it is unused. Two staff recording
 * the same UTR at the same moment serialise on the lock, and the second one
 * sees the first one's row and gets DUPLICATE_UTR.
 *
 * (A unique index would be stronger, but existing rows may already share a
 * reference, so it can't be added without cleaning production data first.)
 */
export async function claimUtr(utr: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"utr:" + utr}))`;
  await assertUtrUnused(utr, tx);
}
