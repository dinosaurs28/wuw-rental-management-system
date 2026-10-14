/**
 * Money of an edit to a completed pickup / drop (client item 1, full edit): the
 * difference between the bill worked out with the edited inputs and what is
 * billed now, and the ADJUSTMENT payment session that settles it.
 *
 * The session carries one ledger line per changed bill line (new − old, same
 * entry type and reference as the line it corrects, metadata.part PICKUP /
 * DROP) and is then settled with the usual counter endpoints —
 * POST /employee/sessions/:id/record-payment (cash / UPI photo / split /
 * credit; cash needs the open shift) or /record-refund (cash / UPI). A ₹0
 * difference completes it at once. Nothing earlier is changed: computeBookingOwed
 * and the invoice read the delta lines next to the original bill.
 *
 * A lower bill takes the part of the booking on counter credit off that credit
 * first (a CUSTOMER_CREDIT_REDUCED line; the credit is lowered when the session
 * completes) — only the rest is refunded. A new edit that changes money replaces
 * an unsettled difference (its session is abandoned and the new one covers
 * everything since the last settled state), unless a payment was started on it.
 * Settling never collects more than the booking owes nor refunds more than it
 * was paid (adjustmentSettleCheck), and the drop waits while a difference is open.
 */
import Decimal from "decimal.js";
import {
  prisma,
  Prisma,
  LedgerEntryClassification,
  LedgerEntryType,
  PaymentSessionStatus,
  PaymentSessionType,
} from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { StatusCode } from "../../types/statusCode.js";
import { ledgerService } from "../payment/ledger.service.js";
import { paymentSessionService, type TxClient } from "../payment/paymentSession.service.js";
import { computeBookingOwed, creditOutstanding, getBookingMoney } from "../payment/booking-owed.service.js";
import { getBookingCreditSummary, reduceBookingCredit } from "../payment/customer-credit.service.js";
import {
  CREDIT_REDUCED_REF,
  adjustmentSettleProblem,
  creditOffset,
  creditReductionLine,
  serializeDeltaLine,
  settlementMethods,
  settlementOf,
  type AdjustmentDeltaLine,
  type AdjustmentPart,
} from "./operation-adjustment.js";
import { dropLineCategory } from "./drop-edit.service.js";

const ZERO = new Decimal(0);

/** Statuses of an adjustment still waiting to be settled. */
const OPEN_STATUSES = [
  PaymentSessionStatus.OPEN,
  PaymentSessionStatus.COMPUTING,
  PaymentSessionStatus.AWAITING_PAYMENT,
  PaymentSessionStatus.PAYMENT_INITIATED,
];

/** 409 while the difference of an earlier edit is still to be settled (the drop waits for it). */
export class AdjustmentPendingError extends Error {
  readonly status = StatusCode.CONFLICT;
  readonly code = "ADJUSTMENT_PENDING";
  constructor(
    public readonly sessionPublicId: string,
    message = "The money difference from the last edit is still to be settled. Collect or refund it first, then edit again.",
  ) {
    super(message);
    this.name = "AdjustmentPendingError";
  }
  toJSON() {
    return { success: false, code: this.code, message: this.message, sessionPublicId: this.sessionPublicId };
  }
}

/** 409: a payment was started on the unsettled difference, so a new edit can't replace it. */
export class AdjustmentPaymentStartedError extends Error {
  readonly status = StatusCode.CONFLICT;
  readonly code = "ADJUSTMENT_PAYMENT_STARTED";
  constructor(public readonly sessionPublicId: string) {
    super("A payment was already started on the last edit's difference. Finish settling it, then edit again.");
    this.name = "AdjustmentPaymentStartedError";
  }
  toJSON() {
    return { success: false, code: this.code, message: this.message, sessionPublicId: this.sessionPublicId };
  }
}

/** 409: an edit that moves money from a client that didn't show the difference first (older app builds). */
export class EditConfirmationRequiredError extends Error {
  readonly status = StatusCode.CONFLICT;
  readonly code = "EDIT_CONFIRMATION_REQUIRED";
  constructor(public readonly delta: string) {
    super("This change moves money on the bill. Update the app to edit charges — it shows the difference before saving.");
    this.name = "EditConfirmationRequiredError";
  }
  toJSON() {
    return { success: false, code: this.code, message: this.message, delta: this.delta };
  }
}

/** The drop's refusal while an edit's difference is open (the deposit it changes isn't settled). */
export function adjustmentPendingBody(session: { publicId: string; netPayable: { toString(): string } }) {
  const net = new Decimal(session.netPayable.toString());
  const what = net.gt(0) ? `₹${net.toFixed(2)} to collect` : `₹${net.abs().toFixed(2)} to refund`;
  return {
    success: false,
    code: "ADJUSTMENT_PENDING",
    message: `The difference from an edit (${what}) is still to be settled. Settle it from the pickup summary first, then record the drop.`,
    sessionPublicId: session.publicId,
  };
}

/** 409 when the difference changed since the screen showed it (preview → save). */
export class AdjustmentChangedError extends Error {
  readonly status = StatusCode.CONFLICT;
  readonly code = "EDIT_DELTA_CHANGED";
  constructor(public readonly delta: string) {
    super("The money difference changed since it was shown. Check the new amount and save again.");
    this.name = "AdjustmentChangedError";
  }
  toJSON() {
    return { success: false, code: this.code, message: this.message, delta: this.delta };
  }
}

/** An adjustment session with its live ledger lines. */
export type AdjustmentSession = Prisma.PaymentSessionGetPayload<{ include: { entries: true } }>;

/** The booking's unsettled adjustment session, if any. */
export async function findPendingAdjustment(bookingId: number, tx?: TxClient): Promise<AdjustmentSession | null> {
  const db = tx ?? prisma;
  return db.paymentSession.findFirst({
    where: { bookingId, sessionType: PaymentSessionType.ADJUSTMENT, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "desc" },
    include: { entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } } },
  });
}

/** An unsettled difference a new edit replaces: what it moved, to be worked out again. */
export interface SupersededAdjustment {
  session: AdjustmentSession;
  /** Drop categories its lines corrected (worked out again by the new edit) */
  dropCategories: string[];
  /** The safety deposit change it carried (booking.safetyDeposit already holds it) */
  depositDelta: Decimal;
}

/**
 * The unsettled difference a new money-moving edit replaces, or null. Refused
 * (409 ADJUSTMENT_PAYMENT_STARTED) once a payment was started on it.
 */
export async function pendingToSupersede(bookingId: number, tx: TxClient): Promise<SupersededAdjustment | null> {
  const pending = await findPendingAdjustment(bookingId, tx);
  if (!pending) return null;
  const paymentStarted =
    pending.status === PaymentSessionStatus.PAYMENT_INITIATED ||
    pending.entries.some(
      (e) =>
        e.entryType === LedgerEntryType.PAYMENT ||
        e.entryType === LedgerEntryType.REFUND ||
        (e.entryType === LedgerEntryType.CREDIT && e.referenceType !== CREDIT_REDUCED_REF),
    );
  if (paymentStarted) throw new AdjustmentPaymentStartedError(pending.publicId);
  const partOf = (e: { metadata: unknown }) => (e.metadata as { part?: string } | null)?.part;
  const dropCategories = [
    ...new Set(
      pending.entries
        .filter((e) => partOf(e) === "DROP" && e.classification !== LedgerEntryClassification.PAYMENT)
        .map((e) => dropLineCategory({ entryType: String(e.entryType), referenceType: e.referenceType, referenceId: e.referenceId })),
    ),
  ];
  const depositDelta = pending.entries
    .filter((e) => e.entryType === LedgerEntryType.DEPOSIT)
    .reduce((sum, e) => sum.plus(e.amount.toString()), ZERO);
  return { session: pending, dropCategories, depositDelta };
}

/** Abandons a replaced difference (nothing was paid on it) inside the edit's transaction. */
export async function abandonSuperseded(tx: TxClient, superseded: SupersededAdjustment): Promise<void> {
  await paymentSessionService.updateStatus(superseded.session.id, PaymentSessionStatus.ABANDONED, {}, tx);
}

/** Records which edit replaced an abandoned difference (shown in its history). */
export async function linkSuperseded(tx: TxClient, superseded: SupersededAdjustment, replacedBy: string | null): Promise<void> {
  const meta = (superseded.session.metadata ?? {}) as Record<string, any>;
  await tx.paymentSession.update({
    where: { id: superseded.session.id },
    data: {
      metadata: {
        ...meta,
        adjustment: { ...(meta.adjustment ?? {}), supersededAt: new Date().toISOString(), supersededBy: replacedBy },
      } as any,
    },
  });
}

/**
 * The credit line of a lower bill: the part of the booking on counter credit
 * (#11) comes off that credit instead of being refunded. Null when nothing does.
 */
export async function creditOffsetLine(
  bookingId: number,
  delta: Decimal,
  part: AdjustmentPart,
  tx: TxClient,
): Promise<AdjustmentDeltaLine | null> {
  if (delta.gte(0)) return null;
  const [owed, money, credit] = await Promise.all([
    computeBookingOwed(bookingId, tx),
    getBookingMoney(bookingId, tx),
    getBookingCreditSummary(bookingId, tx),
  ]);
  const outstanding = creditOutstanding(owed, money.netConfirmed, credit?.pending ?? ZERO);
  const { reduction } = creditOffset(delta, outstanding);
  return reduction.gt(0) ? creditReductionLine(part, reduction) : null;
}

/**
 * Lowers the booking's credit by the session's CUSTOMER_CREDIT_REDUCED lines once
 * the difference is settled (refunded, or ₹0). Credit already cleared by then
 * stays paid — the booking then shows as overpaid in Settlements.
 */
export async function applyAdjustmentCreditReduction(tx: TxClient, sessionId: number, bookingId: number): Promise<void> {
  const lines = await tx.ledgerEntry.findMany({
    where: { sessionId, isVoided: false, entryType: LedgerEntryType.CREDIT, referenceType: CREDIT_REDUCED_REF },
    select: { amount: true },
  });
  const total = lines.reduce((sum, l) => sum.plus(l.amount.toString()), ZERO);
  if (total.lte(0)) return;
  await reduceBookingCredit(tx as Prisma.TransactionClient, bookingId, total, "No longer owed — the bill was lowered by an edit");
}

/**
 * Why an edit's difference can't be settled now: collecting it would take more
 * than the booking still owes (e.g. collected in Settlements meanwhile), or
 * refunding it would pay back more than was paid. Null when it can.
 */
export async function adjustmentSettleCheck(
  tx: TxClient,
  session: { id: number; bookingId: number },
  net: Decimal,
): Promise<{ success: false; code: string; message: string } | null> {
  const [owed, money, credit, deposits] = await Promise.all([
    computeBookingOwed(session.bookingId, tx),
    getBookingMoney(session.bookingId, tx),
    getBookingCreditSummary(session.bookingId, tx),
    tx.ledgerEntry.findMany({
      where: { sessionId: session.id, isVoided: false, entryType: LedgerEntryType.DEPOSIT },
      select: { amount: true },
    }),
  ]);
  const unpaid = owed.totalOwed
    .sub(money.netConfirmed)
    .sub(money.pending)
    .sub(creditOutstanding(owed, money.netConfirmed, credit?.pending ?? ZERO));
  const sessionDeposit = deposits.reduce((sum, d) => sum.plus(d.amount.toString()), ZERO);
  const problem = adjustmentSettleProblem(net, unpaid, sessionDeposit);
  if (problem === "ALREADY_COLLECTED") {
    return {
      success: false,
      code: "ADJUSTMENT_ALREADY_COLLECTED",
      message: "This difference was already collected another way (e.g. in Settlements) — nothing more is due on this booking.",
    };
  }
  if (problem === "ALREADY_REFUNDED") {
    return {
      success: false,
      code: "ADJUSTMENT_ALREADY_REFUNDED",
      message: "Refunding this would pay back more than the customer paid on this booking. Ask the branch manager to check its payments.",
    };
  }
  return null;
}

export interface AdjustmentPlan {
  /** Every compared line (changed or not) for the breakdown */
  lines: AdjustmentDeltaLine[];
  delta: Decimal;
  /** The drop's difference is collected by the branch manager (legacy drop) */
  settledByBranchManager: boolean;
  /** Part of the difference is a safety deposit raise (never on credit) */
  depositIncrease: boolean;
}

/** JSON of a plan: what the screen shows before Save and after it. */
export function serializeAdjustmentPlan(plan: AdjustmentPlan) {
  const settlement = settlementOf(plan.delta);
  return {
    delta: plan.delta.toFixed(2),
    action: settlement.action,
    amount: settlement.amount.toFixed(2),
    // COUNTER = settled now on the adjustment session; BRANCH_MANAGER = legacy return charges
    settledBy: plan.settledByBranchManager ? "BRANCH_MANAGER" : "COUNTER",
    methods: settlementMethods({
      action: settlement.action,
      depositIncrease: plan.depositIncrease,
      settledByBranchManager: plan.settledByBranchManager,
    }),
    lines: plan.lines.map(serializeDeltaLine),
    changedLines: plan.lines.filter((l) => !l.delta.isZero()).length,
  };
}

/**
 * Writes the ADJUSTMENT session for the changed lines (counter-settled part
 * only) inside the edit's transaction: AWAITING_PAYMENT when money moves, else
 * completed at once. Returns null when no line changed.
 */
export async function createAdjustmentSession(
  tx: TxClient,
  p: {
    booking: { id: number; branchId: number; publicId: string };
    actor: { id: number; role: string };
    operation: "PICKUP" | "RETURN";
    lines: AdjustmentDeltaLine[];
    metadata: Record<string, unknown>;
  },
): Promise<AdjustmentSession | null> {
  const changed = p.lines.filter((l) => !l.delta.isZero());
  if (changed.length === 0) return null;

  const session = await tx.paymentSession.create({
    data: {
      publicId: createID(),
      bookingId: p.booking.id,
      branchId: p.booking.branchId,
      sessionType: PaymentSessionType.ADJUSTMENT,
      status: PaymentSessionStatus.OPEN,
      actorId: p.actor.id,
      metadata: {
        adjustment: {
          operation: p.operation,
          lines: p.lines.map(serializeDeltaLine),
          ...p.metadata,
        },
      } as any,
    },
  });

  for (const [index, line] of changed.entries()) {
    const ledger = ledgerFieldsOf(line);
    await ledgerService.addEntry(
      session.id,
      p.booking.id,
      line.entryType as LedgerEntryType,
      ledger.classification,
      ledger.amount,
      line.entryType === LedgerEntryType.CREDIT
        ? `${line.label} (₹${line.delta.toFixed(2)})`
        : `${line.label} (edited: ₹${line.oldAmount.toFixed(2)} → ₹${line.newAmount.toFixed(2)})`,
      p.actor.id,
      p.actor.role,
      {
        referenceType: line.referenceType ?? undefined,
        referenceId: line.referenceId ?? undefined,
        ...(ledger.gstAmount && { gstAmount: ledger.gstAmount }),
        ...(ledger.baseAmount && { baseAmount: ledger.baseAmount }),
        idempotencyKey: `adjust:${session.publicId}:${index}`,
        metadata: {
          part: line.part,
          label: line.label,
          oldAmount: line.oldAmount.toFixed(2),
          newAmount: line.newAmount.toFixed(2),
        },
      },
      tx,
    );
  }

  await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.AWAITING_PAYMENT, {}, tx);
  const totals = await paymentSessionService.recomputeTotals(session.id, tx);
  if (totals.netPayable.toDecimalPlaces(2).isZero()) {
    await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx);
    // Nothing to pay back: the lower bill came off the credit in full
    await applyAdjustmentCreditReduction(tx, session.id, p.booking.id);
  }
  return tx.paymentSession.findUniqueOrThrow({
    where: { id: session.id },
    include: { entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } } },
  });
}

/** How a delta line is written on the ledger: a taxed line keeps its taxable value and GST apart. */
function ledgerFieldsOf(line: AdjustmentDeltaLine): {
  classification: LedgerEntryClassification;
  amount: Decimal;
  gstAmount?: Decimal;
  baseAmount?: Decimal;
} {
  if (line.entryType === LedgerEntryType.CREDIT) {
    return { classification: LedgerEntryClassification.PAYMENT, amount: line.delta };
  }
  if (line.entryType === LedgerEntryType.DISCOUNT) {
    // Whole effect on the bill, with the GST it reverses and its taxable share
    return {
      classification: LedgerEntryClassification.DISCOUNT,
      amount: line.delta,
      ...(!line.gstDelta.isZero() && { gstAmount: line.gstDelta }),
      ...(!line.baseDelta.isZero() && { baseAmount: line.baseDelta }),
    };
  }
  if (line.classification === LedgerEntryClassification.TAXABLE && !line.gstDelta.isZero()) {
    const taxable = line.delta.minus(line.gstDelta);
    return { classification: LedgerEntryClassification.TAXABLE, amount: taxable, gstAmount: line.gstDelta, baseAmount: taxable };
  }
  return { classification: LedgerEntryClassification.NON_TAXABLE, amount: line.delta };
}

/**
 * Refuses the save when the difference moved since the client saw it, and a
 * money-moving save from a client that never showed it (older app builds:
 * `expected` omitted) — those can still save edits that move no money.
 */
export function assertExpectedDelta(expected: number | undefined, delta: Decimal, moneyMoves: boolean): void {
  if (expected === undefined) {
    if (moneyMoves) throw new EditConfirmationRequiredError(delta.toFixed(2));
    return;
  }
  if (!new Decimal(expected).toDecimalPlaces(2).eq(delta.toDecimalPlaces(2))) {
    throw new AdjustmentChangedError(delta.toFixed(2));
  }
}
