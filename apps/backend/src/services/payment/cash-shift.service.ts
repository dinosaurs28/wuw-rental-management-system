import { prisma, Prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { SYSTEM_TIMEZONE } from "../timezone/timezone.service.js";
import { notifyEvents } from "../notification/notification.events.js";
import { StatusCode } from "../../types/statusCode.js";
import type { CashShift, Role } from "@repo/database/client";
import { proofPhotoFields, PROOF_FILE_RELATION_SELECT, PROOF_PHOTOS_RELATION_SELECT } from "./payment-proof.service.js";
import {
  CashShiftError,
  assertCanCloseShift,
  assertNoOpenShift,
  decideClose,
  isOneOpenShiftViolation,
  shiftFigures,
  REFUND_PURPOSES,
  type ShiftTxnRow,
} from "./cash-shift-rules.js";
import { confirmCollectedInTx, afterCashConfirmed } from "./payment-transaction.service.js";
import { countsInShift } from "./cash-shift-rules.js";
import { allocationCteSql, loadPaymentAllocations } from "../financials/financials-query.js";
import {
  CLIENT_PAYMENT_TYPES,
  CLIENT_PAYMENT_TYPE_LABELS,
  COLLECTED_PURPOSES,
  type ClientPaymentType,
  type PaymentAllocation,
} from "../financials/payment-type.js";

/*
 * Cash shift money model (definition + rules: cash-shift-rules.ts)
 * ──────────────────────
 *   expected cash = openingCash + cash collected − cash refunded
 *   difference    = cash received (by the manager at close) − expected cash
 *
 * "Cash collected" is the physical cash the executive took in on transactions
 * linked to the shift: COLLECTED (awaiting BM confirmation) + CONFIRMED. A BM
 * rejection before close takes it out. "Cash refunded" is cash paid out of the
 * drawer (CONFIRMED refund-purpose transactions). UPI / card money (the online
 * part) is linked to the shift as its non-cash figure but never enters the drawer.
 *
 * Since Oct 2026 the executive opens the shift and collects; only the branch
 * manager (or an admin) closes it — "Verify & close" in Financials → Cash
 * Shift. The close locks the shift row FOR UPDATE, recomputes the figures from
 * the linked rows (locked too), confirms every COLLECTED payment in the shift
 * (the old per-payment cash confirmation folds into the close), and snapshots
 * cashCollected / cashRefunded / expectedTotal / actualTotal (cash received) /
 * discrepancy (difference) / discrepancyExplanation (the manager's note) with
 * closedById + reconciledById/At = the manager. Nothing changes them afterwards:
 * a closed shift is read-only (payments can't link to it — see
 * lockShiftForPayment; a row voided after the close still counts in the
 * closed shift's figures and report).
 *
 * While a shift is OPEN these figures are computed live.
 *
 * Shifts closed before Oct 2026 measured variance against BM-confirmed cash
 * only; their stored expectedTotal/discrepancy are kept as-is and flagged with
 * legacyVariance.
 */

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId: number;
  actorPublicId: string;
  branchName: string;
}

export { CashShiftError } from "./cash-shift-rules.js";
export type { CashShiftErrorCode } from "./cash-shift-rules.js";

/** Every money figure on a shift, as 2-dp strings (closingCash/variance are null while OPEN). */
export interface ShiftView {
  publicId: string;
  status: CashShift["status"];
  isOpen: boolean;
  /** IST calendar date the shift opened on — the day it belongs to in filters and daily totals. */
  istDate: string;
  openedAt: Date;
  closedAt: Date | null;
  employeePublicId: string;
  employeeName: string;
  branchName: string | null;
  openingCash: string;
  cashCollected: string;
  cashRefunded: string;
  expectedClosing: string;
  closingCash: string | null;
  variance: string | null;
  pendingCash: string;
  confirmedCash: string;
  rejectedCash: string;
  upiCollected: string;
  transactionCount: number;
  discrepancyExplanation: string | null;
  reconciledByName: string | null;
  reconciledAt: Date | null;
  legacyVariance: boolean;
  // ── Additive (Oct 2026, manager close) ──
  /** Same as expectedClosing: opening + cash collected − cash refunded. */
  expectedCash: string;
  /** Cash the manager received at close (null while OPEN). */
  cashReceived: string | null;
  /** cashReceived − expectedCash (null while OPEN). */
  difference: string | null;
  /** MATCHED / MISMATCH once closed, null while OPEN. */
  result: "MATCHED" | "MISMATCH" | null;
  /** UPI / card money in the shift (information only — never in the drawer). */
  nonCashCollected: string;
  nonCashRefunded: string;
  /** cashCollected + nonCashCollected. */
  totalCollected: string;
  /** Live payments and refunds (COLLECTED / CONFIRMED) in the shift. */
  paymentCount: number;
  /** Who closed it: the manager; for shifts closed before Oct 2026, the executive. */
  closedByName: string | null;
  closedByPublicId: string | null;
  /** Closed by a manager (verify & close) rather than by the executive (old builds). */
  closedByManager: boolean;
}

export interface ShiftDayTotals {
  shiftCount: number;
  openCount: number;
  closedCount: number;
  flaggedCount: number;
  openingCash: string;
  cashCollected: string;
  cashRefunded: string;
  expectedClosing: string;
  closingCash: string;
  /** Sum over closed shifts, leaving out legacy (old-rule) closes. */
  variance: string;
  pendingCash: string;
  upiCollected: string;
  /** Closed shifts flagged legacyVariance — their variance is not in `variance`. */
  legacyCount: number;
}

export interface PaginatedShifts {
  shifts: any[];
  total: number;
  page: number;
  pageSize: number;
  /** Per IST day (newest first) over the whole filter, not just this page. */
  dailyTotals: Array<ShiftDayTotals & { date: string }>;
  /** Grand totals over the whole filter. */
  summary: ShiftDayTotals;
  /** Shifts open right now in this scope, whatever the filters. */
  openNowCount: number;
  filters: {
    status: string | null;
    from: string | null;
    to: string | null;
    openNow: boolean;
    employeePublicId: string | null;
    result?: string | null;
    dateField?: string;
  };
}

export interface ShiftListFilters {
  page?: number;
  pageSize?: number;
  status?: "OPEN" | "CLOSED" | "DISCREPANCY_FLAGGED" | "ENDED";
  date?: string;
  from?: string;
  to?: string;
  openNow?: boolean;
  employeePublicId?: string;
  /** Closed shifts by result: MATCHED (no difference) / MISMATCH (closed with one). */
  result?: "MATCHED" | "MISMATCH";
  /** The date the from/to/date range applies to: OPENED (default) or CLOSED. */
  dateField?: "OPENED" | "CLOSED";
}

const ZERO = new Decimal(0);
const MAX_RANGE_DAYS = 366;
const MAX_DAILY_ROWS = 400;

type Db = Prisma.TransactionClient | typeof prisma;

interface LiveTotals {
  cashIn: Decimal;
  cashOut: Decimal;
  pendingCash: Decimal;
  confirmedCash: Decimal;
  rejectedCash: Decimal;
  upiCollected: Decimal;
  nonCashIn: Decimal;
  nonCashOut: Decimal;
  paymentCount: number;
  transactionCount: number;
}

const EMPTY_TOTALS: LiveTotals = {
  cashIn: ZERO,
  cashOut: ZERO,
  pendingCash: ZERO,
  confirmedCash: ZERO,
  rejectedCash: ZERO,
  upiCollected: ZERO,
  nonCashIn: ZERO,
  nonCashOut: ZERO,
  paymentCount: 0,
  transactionCount: 0,
};

const dec = (v: { toString(): string } | null | undefined): Decimal => new Decimal(v?.toString() ?? "0");
const money = (d: Decimal): string => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const istDateOf = (d: Date): string => DateTime.fromJSDate(d, { zone: SYSTEM_TIMEZONE }).toFormat("yyyy-MM-dd");
/** UTC wall-clock literal for comparing Prisma's `timestamp without time zone` columns in raw SQL. */
const sqlTs = (d: Date): string => d.toISOString().replace("T", " ").replace("Z", "");

const MONEY_IN = Prisma.sql`t."purpose" NOT IN ('OVERPAYMENT_REFUND', 'CANCELLATION_REFUND')`;
const MONEY_OUT = Prisma.sql`t."purpose" IN ('OVERPAYMENT_REFUND', 'CANCELLATION_REFUND')`;
// Voided after its shift closed: it was live at close, and a closed shift's figures never move
const FROZEN_VOID = Prisma.sql`(t."status" = 'VOIDED' AND cs."closedAt" IS NOT NULL AND t."voidedAt" > cs."closedAt")`;

/**
 * Per-shift live totals from linked PaymentTransactions — the definition of
 * "cash collected / refunded / pending / UPI / non-cash" used by the active
 * shift, list rows and the daily totals. Mirrors shiftFigures() in
 * cash-shift-rules.ts, which the close computes from the locked rows.
 */
const liveTotalsSql = (shiftIdPredicate: Prisma.Sql) => Prisma.sql`
  SELECT t."cashShiftId" AS "shiftId",
    COALESCE(SUM(t."cashAmount") FILTER (WHERE ${MONEY_IN} AND t."status" IN ('COLLECTED', 'CONFIRMED')), 0) AS "cashIn",
    COALESCE(SUM(t."cashAmount") FILTER (WHERE ${MONEY_OUT} AND t."status" = 'CONFIRMED'), 0) AS "cashOut",
    COALESCE(SUM(t."cashAmount") FILTER (WHERE ${MONEY_IN} AND t."status" = 'COLLECTED'), 0) AS "pendingCash",
    COALESCE(SUM(t."cashAmount") FILTER (WHERE ${MONEY_IN} AND t."status" = 'CONFIRMED'), 0) AS "confirmedCash",
    COALESCE(SUM(t."cashAmount") FILTER (WHERE ${MONEY_IN} AND t."status" = 'REJECTED'), 0) AS "rejectedCash",
    COALESCE(SUM(t."onlineAmount") FILTER (
      WHERE ${MONEY_IN} AND t."status" IN ('COLLECTED', 'CONFIRMED') AND UPPER(COALESCE(t."onlineGateway", '')) = 'UPI'
    ), 0) AS "upiCollected",
    -- Non-cash and the payment count include a row voided after its shift closed:
    -- it was live at close, and a closed shift's figures never move.
    COALESCE(SUM(t."onlineAmount") FILTER (WHERE ${MONEY_IN} AND (t."status" IN ('COLLECTED', 'CONFIRMED') OR ${FROZEN_VOID})), 0) AS "nonCashIn",
    COALESCE(SUM(t."onlineAmount") FILTER (WHERE ${MONEY_OUT} AND (t."status" = 'CONFIRMED' OR ${FROZEN_VOID})), 0) AS "nonCashOut",
    (COUNT(*) FILTER (WHERE (${MONEY_IN} AND (t."status" IN ('COLLECTED', 'CONFIRMED') OR ${FROZEN_VOID}))
      OR (${MONEY_OUT} AND (t."status" = 'CONFIRMED' OR ${FROZEN_VOID}))))::int AS "paymentCount",
    COUNT(*)::int AS "transactionCount"
  FROM "PaymentTransaction" t
  LEFT JOIN "CashShift" cs ON cs."id" = t."cashShiftId"
  WHERE t."cashShiftId" ${shiftIdPredicate}
  GROUP BY t."cashShiftId"`;

interface ResolvedFilters {
  where: Prisma.CashShiftWhereInput;
  sqlWhere: Prisma.Sql;
  echo: PaginatedShifts["filters"];
}

type ShiftRecord = CashShift & {
  employee: { publicId: string; name: string };
  branch?: { name: string } | null;
  reconciledBy?: { publicId: string; name: string } | null;
  closedBy?: { publicId: string; name: string } | null;
};

const SHIFT_PEOPLE_INCLUDE = {
  employee: { select: { publicId: true, name: true } },
  branch: { select: { name: true } },
  reconciledBy: { select: { publicId: true, name: true } },
  closedBy: { select: { publicId: true, name: true } },
} as const;

/**
 * A closed shift whose stored figures don't follow the current money model:
 * expected ≠ opening + collected − refunded, or variance ≠ counted − expected.
 * Mirrored by LEGACY_CLOSE_SQL for the daily totals.
 */
const isLegacyClose = (s: CashShift, breakdown: Decimal): boolean => {
  const expected = dec(s.expectedTotal);
  return !expected.eq(breakdown) || !dec(s.discrepancy).eq(dec(s.actualTotal).sub(expected));
};

/** isLegacyClose over the aggregate CTE `f` (closed rows only). */
const LEGACY_CLOSE_SQL = Prisma.sql`(f."status" <> 'OPEN' AND (
  f."expectedTotal" <> f."openingCash" + f."cashCollected" - f."cashRefunded"
  OR f."discrepancy" <> f."actualTotal" - f."expectedTotal"))`;

class CashShiftService {
  /** Serialises open/close for one executive (two devices, double taps). Call inside a transaction. */
  private async lockEmployee(employeeId: number, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashshift:" + employeeId}))`;
  }

  async open(actor: ActorContext, openingCash = 0): Promise<CashShift> {
    const opening = new Decimal(openingCash).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const { shift, strayLinked } = await prisma.$transaction(async (tx) => {
      await this.lockEmployee(actor.actorId, tx);

      // One OPEN shift per executive: this check (under the advisory lock) plus
      // the partial unique index CashShift_one_open_per_employee as the backstop
      const existing = await tx.cashShift.findFirst({
        where: { employeeId: actor.actorId, status: "OPEN" },
        select: { id: true },
      });
      assertNoOpenShift(existing);

      const lastClosed = await tx.cashShift.findFirst({
        where: { employeeId: actor.actorId, closedAt: { not: null } },
        orderBy: { closedAt: "desc" },
        select: { closedAt: true },
      });

      const created = await tx.cashShift.create({
        data: {
          publicId: createID(),
          employeeId: actor.actorId,
          branchId: actor.actorBranchId,
          status: "OPEN",
          openingCash: opening.toFixed(2),
        },
      });

      // Cash this executive took while no shift was open (e.g. a payment that
      // raced the previous close) is still in their hands: it joins this
      // drawer. Only money collected after their last close — or since the
      // start of today (IST) for a first shift — so nothing older is swept in.
      const strayFrom =
        lastClosed?.closedAt ?? DateTime.now().setZone(SYSTEM_TIMEZONE).startOf("day").toJSDate();
      const linked = await tx.paymentTransaction.updateMany({
        where: {
          collectedById: actor.actorId,
          status: "COLLECTED",
          cashShiftId: null,
          collectedAt: { gte: strayFrom },
          purpose: { notIn: [...REFUND_PURPOSES] },
        },
        data: { cashShiftId: created.id },
      });

      return { shift: created, strayLinked: linked.count };
    }).catch((error: unknown) => {
      if (isOneOpenShiftViolation(error)) assertNoOpenShift({ id: 0 });
      throw error;
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "OPEN_CASH_SHIFT",
      category: AuditCategory.PAYMENT,
      description: `Cash shift opened by ${actor.actorName} with opening cash ₹${opening.toFixed(2)}`,
      entity: "CashShift",
      entityId: shift.publicId,
      after: { openingCash: opening.toFixed(2), strayTransactionsLinked: strayLinked },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: actor.actorBranchId,
      branchName: actor.branchName,
      actionType: StaffActionType.INITIATED,
      entityType: StaffEntityType.CASH_SHIFT,
      entityRef: shift.publicId,
      description: `Cash shift opened with ₹${opening.toFixed(2)} in the drawer`,
      metadata: { openingCash: opening.toFixed(2) },
    });

    return shift;
  }

  /**
   * Branch manager's "Verify & close" (admins too). Atomic:
   *   1. the executive's advisory lock + the shift row FOR UPDATE — a payment
   *      being written holds the row FOR SHARE (lockShiftForPayment), so the
   *      close waits for it and counts it; one arriving after waits and is
   *      refused (the row reads CLOSED);
   *   2. still OPEN, else 409 SHIFT_NOT_OPEN (closed shifts are locked);
   *   3. the linked rows locked FOR UPDATE and the figures recomputed from them
   *      (shiftFigures) — never taken from the client; expectedSeen ≠ now → 409;
   *   4. a difference needs a note (400 DISCREPANCY_EXPLANATION_REQUIRED);
   *   5. every COLLECTED payment in the shift becomes CONFIRMED (extensions
   *      paid in cash are finalized) — the old per-payment cash confirmation;
   *   6. the snapshot: actualTotal = cash received, discrepancy = difference,
   *      discrepancyExplanation = note, closedById + reconciledById/At = manager.
   * Afterwards the executive gets a push + inbox notification.
   */
  async close(
    publicId: string,
    input: { cashReceived: number; note?: string | null; expectedSeen?: number | null },
    actor: ActorContext,
  ): Promise<CashShift> {
    // Fleet Executives never close (old builds still call it): 403 before any lookup
    assertCanCloseShift({ role: actor.actorRole, branchId: actor.actorBranchId }, { branchId: actor.actorBranchId });

    const { shift, updated, figures, decision, confirmedRows } = await prisma.$transaction(
      async (tx) => {
        const found = await tx.cashShift.findUnique({ where: { publicId } });
        if (!found) throw new CashShiftError(StatusCode.NOT_FOUND, "SHIFT_NOT_FOUND", "Cash shift not found.");
        assertCanCloseShift({ role: actor.actorRole, branchId: actor.actorBranchId }, found);

        await this.lockEmployee(found.employeeId, tx);
        const [row] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text AS "status" FROM "CashShift" WHERE "id" = ${found.id} FOR UPDATE`;

        // The shift's rows, locked: a confirm / reject / void racing the close waits for it
        const rows = await tx.$queryRaw<Array<ShiftTxnRow & {
          id: number; publicId: string; bookingId: number; branchId: number;
          totalAmount: Prisma.Decimal; collectedById: number | null; notes: string | null;
        }>>`
          SELECT "id", "publicId", "bookingId", "branchId", "purpose"::text AS "purpose", "status"::text AS "status",
                 "cashAmount", "onlineAmount", "totalAmount", "collectedById", "notes"
          FROM "PaymentTransaction" WHERE "cashShiftId" = ${found.id}
          ORDER BY "id"
          FOR UPDATE`;

        const figs = shiftFigures(found.openingCash, rows);
        const dec_ = decideClose({
          status: row?.status ?? found.status,
          figures: figs,
          cashReceived: input.cashReceived,
          note: input.note,
          expectedSeen: input.expectedSeen,
        });

        // Verified at the handover: the shift's COLLECTED money becomes CONFIRMED
        const confirmed: Array<{ row: (typeof rows)[number]; extension: Awaited<ReturnType<typeof confirmCollectedInTx>>["extension"] }> = [];
        for (const r of rows) {
          if (r.status !== "COLLECTED") continue;
          const out = await confirmCollectedInTx(tx, { id: r.id, purpose: r.purpose, notes: r.notes }, actor.actorId, r.notes);
          if (out.confirmed) confirmed.push({ row: r, extension: out.extension });
        }

        const now = new Date();
        const saved = await tx.cashShift.update({
          where: { id: found.id },
          data: {
            status: dec_.status,
            closedAt: now,
            closedById: actor.actorId,
            reconciledById: actor.actorId,
            reconciledAt: now,
            cashCollected: money(figs.cashCollected),
            cashRefunded: money(figs.cashRefunded),
            expectedTotal: money(dec_.expectedCash),
            actualTotal: money(dec_.cashReceived),
            discrepancy: money(dec_.difference),
            discrepancyExplanation: dec_.note,
          },
        });

        return { shift: found, updated: saved, figures: figs, decision: dec_, confirmedRows: confirmed };
      },
      { timeout: 30000 },
    );

    for (const c of confirmedRows) {
      await afterCashConfirmed(
        { ...c.row, totalAmount: c.row.totalAmount },
        c.extension,
        actor,
        { notifyCollector: false, shiftPublicId: shift.publicId },
      ).catch((err) => console.error("[cashShift.close] after-confirm error:", err));
    }

    const diff = decision.difference;
    const hasDiscrepancy = !decision.matched;
    const employee = await prisma.user.findUnique({ where: { id: shift.employeeId }, select: { name: true } });
    const employeeName = employee?.name ?? "the executive";

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: shift.branchId,
      action: "CLOSE_CASH_SHIFT",
      category: AuditCategory.PAYMENT,
      severity: hasDiscrepancy ? "WARNING" : "INFO",
      description: `Cash shift of ${employeeName} closed by ${actor.actorName}. Opening: ₹${money(figures.openingCash)}, Collected: ₹${money(figures.cashCollected)}, Refunded: ₹${money(figures.cashRefunded)}, Expected: ₹${money(decision.expectedCash)}, Received: ₹${money(decision.cashReceived)}, Difference: ₹${money(diff)}`,
      entity: "CashShift",
      entityId: shift.publicId,
      before: { status: "OPEN" },
      after: {
        status: updated.status,
        openingCash: money(figures.openingCash),
        cashCollected: money(figures.cashCollected),
        cashRefunded: money(figures.cashRefunded),
        expectedTotal: money(decision.expectedCash),
        actualTotal: money(decision.cashReceived),
        discrepancy: money(diff),
        nonCashCollected: money(figures.nonCashCollected),
        paymentsConfirmed: confirmedRows.length,
        note: decision.note,
      },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: shift.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.COMPLETED,
      entityType: StaffEntityType.CASH_SHIFT,
      entityRef: shift.publicId,
      description: `Closed ${employeeName}'s cash shift: received ₹${money(decision.cashReceived)} of ₹${money(decision.expectedCash)} expected${hasDiscrepancy ? ` (difference ₹${money(diff)})` : ""}`,
      metadata: {
        expected: money(decision.expectedCash),
        received: money(decision.cashReceived),
        difference: money(diff),
      },
    });

    void notifyEvents.shiftClosed({ shiftId: shift.id, actorUserId: actor.actorId });

    return updated;
  }

  async reconcile(publicId: string, discrepancyExplanation: string, actor: ActorContext): Promise<CashShift> {
    const shift = await prisma.cashShift.findUnique({ where: { publicId } });
    if (!shift) throw new CashShiftError(StatusCode.NOT_FOUND, "SHIFT_NOT_FOUND", "Cash shift not found.");
    if (actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new CashShiftError(StatusCode.FORBIDDEN, "RECONCILE_FORBIDDEN", "Only MANAGER or ADMIN can reconcile shifts.");
    }
    if (actor.actorRole === "MANAGER" && shift.branchId !== actor.actorBranchId) {
      throw new CashShiftError(StatusCode.FORBIDDEN, "SHIFT_OTHER_BRANCH", "This shift belongs to another branch.");
    }
    if (shift.status !== "DISCREPANCY_FLAGGED") {
      throw new CashShiftError(
        StatusCode.BAD_REQUEST,
        "SHIFT_NOT_FLAGGED",
        "Only DISCREPANCY_FLAGGED shifts can be reconciled.",
      );
    }
    // A shift the manager closed carries the manager's note already and is read-only
    if (shift.closedById) {
      throw new CashShiftError(
        StatusCode.CONFLICT,
        "SHIFT_LOCKED",
        "This shift was closed by a manager with a note. Closed shifts can't be changed.",
      );
    }

    const updated = await prisma.cashShift.update({
      where: { publicId },
      data: {
        status: "CLOSED",
        discrepancyExplanation,
        reconciledById: actor.actorId,
        reconciledAt: new Date(),
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: shift.branchId,
      action: "RECONCILE_CASH_SHIFT",
      category: AuditCategory.PAYMENT,
      description: `Cash shift reconciled by manager. Explanation: ${discrepancyExplanation}`,
      entity: "CashShift",
      entityId: shift.publicId,
      // The executive's close-time explanation is replaced on the shift; keep it in the trail
      before: { status: "DISCREPANCY_FLAGGED", discrepancyExplanation: shift.discrepancyExplanation },
      after: { status: "CLOSED", reconciledById: actor.actorId, discrepancyExplanation },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: shift.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.RECONCILED,
      entityType: StaffEntityType.CASH_SHIFT,
      entityRef: shift.publicId,
      description: `Cash shift discrepancy reconciled`,
    });

    return updated;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * The six-type split (Financials' allocation SQL) of given rows whatever their
   * status — for rows voided after their shift closed, which loadPaymentAllocations
   * leaves out but a closed shift's report still counts.
   */
  private async allocationsOf(ids: number[]): Promise<Map<number, PaymentAllocation[]>> {
    const out = new Map<number, PaymentAllocation[]>();
    if (ids.length === 0) return out;
    const where = Prisma.sql`t.id IN (${Prisma.join(ids)}) AND t.purpose::text IN (${Prisma.join(COLLECTED_PURPOSES)})`;
    const rows = await prisma.$queryRaw<{ id: number; type: ClientPaymentType; cash: unknown; online: unknown }[]>(
      Prisma.sql`${allocationCteSql(where)} SELECT id, type, cash, online FROM alloc ORDER BY id, type_ord`,
    );
    for (const r of rows) {
      const cash = Number(String(r.cash ?? 0));
      const online = Number(String(r.online ?? 0));
      const list = out.get(Number(r.id)) ?? [];
      list.push({ type: r.type, amount: Math.round((cash + online) * 100) / 100, cash, online });
      out.set(Number(r.id), list);
    }
    return out;
  }

  /** Live totals per shift from its linked transactions (shifts with none are absent). */
  private async liveTotals(shiftIds: number[], db: Db = prisma): Promise<Map<number, LiveTotals>> {
    const out = new Map<number, LiveTotals>();
    if (shiftIds.length === 0) return out;
    const rows = await db.$queryRaw<Array<Record<string, any>>>(
      liveTotalsSql(Prisma.sql`IN (${Prisma.join(shiftIds)})`),
    );
    for (const r of rows) {
      out.set(Number(r.shiftId), {
        cashIn: dec(r.cashIn),
        cashOut: dec(r.cashOut),
        pendingCash: dec(r.pendingCash),
        confirmedCash: dec(r.confirmedCash),
        rejectedCash: dec(r.rejectedCash),
        upiCollected: dec(r.upiCollected),
        nonCashIn: dec(r.nonCashIn),
        nonCashOut: dec(r.nonCashOut),
        paymentCount: Number(r.paymentCount ?? 0),
        transactionCount: Number(r.transactionCount ?? 0),
      });
    }
    return out;
  }

  /** OPEN shifts use live totals; closed ones their close-time snapshots. */
  private toView(s: ShiftRecord, live: LiveTotals): ShiftView {
    const isOpen = s.status === "OPEN";
    const opening = dec(s.openingCash);
    const collected = isOpen ? live.cashIn : dec(s.cashCollected);
    const refunded = isOpen ? live.cashOut : dec(s.cashRefunded);
    const breakdown = opening.add(collected).sub(refunded);
    const expected = isOpen ? breakdown : dec(s.expectedTotal);
    return {
      publicId: s.publicId,
      status: s.status,
      isOpen,
      istDate: istDateOf(s.openedAt),
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      employeePublicId: s.employee.publicId,
      employeeName: s.employee.name,
      branchName: s.branch?.name ?? null,
      openingCash: money(opening),
      cashCollected: money(collected),
      cashRefunded: money(refunded),
      expectedClosing: money(expected),
      closingCash: isOpen ? null : money(dec(s.actualTotal)),
      variance: isOpen ? null : money(dec(s.discrepancy)),
      pendingCash: money(live.pendingCash),
      confirmedCash: money(live.confirmedCash),
      rejectedCash: money(live.rejectedCash),
      upiCollected: money(live.upiCollected),
      transactionCount: live.transactionCount,
      discrepancyExplanation: s.discrepancyExplanation ?? null,
      reconciledByName: s.reconciledBy?.name ?? null,
      reconciledAt: s.reconciledAt ?? null,
      // Closed under the old confirmed-cash-only rule: the stored expected
      // doesn't follow from opening + collected − refunded, or the stored
      // variance doesn't follow from counted − expected (the old confirmCash
      // bumped expectedTotal after close without recomputing the variance).
      legacyVariance: !isOpen && isLegacyClose(s, breakdown),
      expectedCash: money(expected),
      cashReceived: isOpen ? null : money(dec(s.actualTotal)),
      difference: isOpen ? null : money(dec(s.discrepancy)),
      result: isOpen ? null : dec(s.discrepancy).isZero() ? "MATCHED" : "MISMATCH",
      nonCashCollected: money(live.nonCashIn),
      nonCashRefunded: money(live.nonCashOut),
      totalCollected: money(collected.add(live.nonCashIn)),
      paymentCount: live.paymentCount,
      closedByName: isOpen ? null : (s.closedBy?.name ?? s.employee.name),
      closedByPublicId: isOpen ? null : (s.closedBy?.publicId ?? s.employee.publicId),
      closedByManager: !!s.closedById,
    };
  }

  /** Keys the pre-Oct-2026 responses carried, kept for clients already in the field. */
  private legacyKeys(view: ShiftView, s: ShiftRecord) {
    return {
      employeeName: view.employeeName,
      // For an OPEN shift this is the live expected drawer, so old close
      // screens compare the counted cash against the right number.
      expectedTotal: view.expectedClosing,
      actualTotal: dec(s.actualTotal).toString(),
      discrepancy: dec(s.discrepancy).toString(),
    };
  }

  async getActiveShift(employeeId: number): Promise<any | null> {
    const shift = await prisma.cashShift.findFirst({
      where: { employeeId, status: "OPEN" },
      include: {
        employee: { select: { publicId: true, name: true } },
        branch: { select: { name: true } },
      },
    });
    if (!shift) return null;

    const live = (await this.liveTotals([shift.id])).get(shift.id) ?? EMPTY_TOTALS;
    const view = this.toView(shift, live);

    return {
      ...shift,
      ...this.legacyKeys(view, shift),
      // Cash collected but not yet confirmed by the manager
      pendingTotal: view.pendingCash,
      ...view,
    };
  }

  /**
   * One shift with its transactions and their CURRENT statuses. `scope`
   * limits it to a branch (BM) or an executive (own history); out of scope
   * reads as not found. `legacy` adds the old response keys (BM endpoint).
   */
  async getDetail(
    publicId: string,
    scope: { branchId?: number; employeeId?: number },
    opts: { legacy?: boolean } = {},
  ): Promise<any | null> {
    const shift = await prisma.cashShift.findUnique({
      where: { publicId },
      include: {
        employee: { select: { publicId: true, name: true } },
        branch: { select: { name: true } },
        reconciledBy: { select: { publicId: true, name: true } },
        closedBy: { select: { publicId: true, name: true } },
        transactions: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            publicId: true,
            purpose: true,
            method: true,
            status: true,
            voidedAt: true,
            voidShiftClosed: true,
            totalAmount: true,
            cashAmount: true,
            onlineAmount: true,
            onlineGateway: true,
            onlineTransactionRef: true,
            collectedAt: true,
            confirmedAt: true,
            rejectedAt: true,
            rejectionReason: true,
            notes: true,
            createdAt: true,
            booking: { select: { publicId: true, customer: { select: { user: { select: { name: true } } } } } },
            collectedBy: { select: { name: true } },
            confirmedBy: { select: { name: true } },
            rejectedBy: { select: { name: true } },
            // UPI payment-screen photo (#3) — the BM verifies UPI money with it
            proofFile: PROOF_FILE_RELATION_SELECT,
            proofPhotos: PROOF_PHOTOS_RELATION_SELECT,
          },
        },
      },
    });
    if (!shift) return null;
    if (scope.branchId !== undefined && shift.branchId !== scope.branchId) return null;
    if (scope.employeeId !== undefined && shift.employeeId !== scope.employeeId) return null;

    const live = (await this.liveTotals([shift.id])).get(shift.id) ?? EMPTY_TOTALS;
    const { transactions: rawTxns, ...record } = shift;
    const view = this.toView(record, live);

    // The six payment types (shared with Financials → payments): per row, and
    // the shift's cash / non-cash per type. Refunds are paid out, not collected.
    // Rows voided after the close keep their split (a closed report never moves)
    const voidedAfterClose = (t: { status: string; voidedAt: Date | null }) =>
      t.status === "VOIDED" && !!shift.closedAt && !!t.voidedAt && t.voidedAt > shift.closedAt;
    const allocations = await loadPaymentAllocations(prisma, rawTxns.filter((t) => t.status !== "VOIDED").map((t) => t.id));
    const frozen = await this.allocationsOf(rawTxns.filter(voidedAfterClose).map((t) => t.id));
    for (const [id, list] of frozen) allocations.set(id, list);
    const byType = new Map<ClientPaymentType, { cash: Decimal; online: Decimal }>();
    let refundCash = ZERO;
    let refundOnline = ZERO;
    for (const t of rawTxns) {
      if (!countsInShift({ ...t, voidedAfterClose: voidedAfterClose(t) })) continue;
      if ((REFUND_PURPOSES as readonly string[]).includes(t.purpose)) {
        refundCash = refundCash.add(dec(t.cashAmount));
        refundOnline = refundOnline.add(dec(t.onlineAmount));
        continue;
      }
      for (const a of allocations.get(t.id) ?? []) {
        const cur = byType.get(a.type) ?? { cash: ZERO, online: ZERO };
        byType.set(a.type, { cash: cur.cash.add(a.cash), online: cur.online.add(a.online) });
      }
    }
    const typeBreakdown = CLIENT_PAYMENT_TYPES.map((type) => {
      const v = byType.get(type) ?? { cash: ZERO, online: ZERO };
      return { type, label: CLIENT_PAYMENT_TYPE_LABELS[type], cash: money(v.cash), nonCash: money(v.online), total: money(v.cash.add(v.online)) };
    });

    const transactions = await Promise.all(rawTxns.map(async (t) => ({
      publicId: t.publicId,
      bookingPublicId: t.booking.publicId,
      customerName: t.booking.customer?.user?.name ?? null,
      purpose: t.purpose,
      method: t.method,
      status: t.status,
      // OUT = refund paid from the drawer; IN = money taken
      direction: (REFUND_PURPOSES as readonly string[]).includes(t.purpose) ? "OUT" : "IN",
      totalAmount: money(dec(t.totalAmount)),
      cashAmount: money(dec(t.cashAmount)),
      onlineAmount: money(dec(t.onlineAmount)),
      onlineGateway: t.onlineGateway,
      onlineTransactionRef: t.onlineTransactionRef,
      collectedAt: t.collectedAt,
      collectedByName: t.collectedBy?.name ?? null,
      confirmedAt: t.confirmedAt,
      confirmedByName: t.confirmedBy?.name ?? null,
      rejectedAt: t.rejectedAt,
      rejectedByName: t.rejectedBy?.name ?? null,
      rejectionReason: t.rejectionReason,
      notes: t.notes,
      createdAt: t.createdAt,
      // Recorded after the close snapshot was taken, so not in its figures
      linkedAfterClose: !!shift.closedAt && t.createdAt > shift.closedAt,
      // Additive (Oct 2026): the six payment types this row paid (none for refunds / voided)
      allocations: allocations.get(t.id) ?? [],
      paymentTypes: (allocations.get(t.id) ?? []).map((a) => CLIENT_PAYMENT_TYPE_LABELS[a.type]),
      voidedAt: t.voidedAt,
      voidShiftClosed: t.voidShiftClosed,
      // Additive: presigned photo of the customer's UPI payment screen (#3)
      ...(await proofPhotoFields(t.proofFile, t.proofPhotos)),
    })));

    const extra = {
      typeBreakdown,
      refundsPaidOut: { cash: money(refundCash), nonCash: money(refundOnline) },
      // How expected cash is made up (shown under the big figure in the close panel)
      expectedCashComponents: {
        openingCash: view.openingCash,
        cashCollected: view.cashCollected,
        cashRefunded: view.cashRefunded,
        expectedCash: view.expectedCash,
      },
    };
    return opts.legacy
      ? { ...record, ...this.legacyKeys(view, record), ...view, ...extra, transactions }
      : { ...view, ...extra, transactions };
  }

  /**
   * Summary cards of Financials → Cash Shift for a branch:
   *   openShifts     — executives with an open shift now
   *   cashWithFleet  — expected cash held across those open shifts (opening + collected − refunded)
   *   closedToday    — shifts closed today (IST) and the cash received on them
   *   mismatches     — shifts closed with a difference in the range (by close date; default today)
   */
  async cardsForBranch(branchId: number, range: { from?: string; to?: string } = {}) {
    const todayStart = DateTime.now().setZone(SYSTEM_TIMEZONE).startOf("day");
    const fromDay = range.from ? this.parseIstDay(range.from) : todayStart;
    const toDay = range.to ? this.parseIstDay(range.to) : todayStart;
    if (fromDay > toDay) {
      throw new CashShiftError(StatusCode.BAD_REQUEST, "INVALID_DATE_RANGE", "The from date must be on or before the to date.");
    }
    if (Math.round(toDay.diff(fromDay, "days").days) + 1 > MAX_RANGE_DAYS) {
      throw new CashShiftError(StatusCode.BAD_REQUEST, "INVALID_DATE_RANGE", `Pick a range of at most ${MAX_RANGE_DAYS} days.`);
    }

    const open = await prisma.cashShift.findMany({
      where: { branchId, status: "OPEN" },
      select: { id: true, openingCash: true },
    });
    const live = await this.liveTotals(open.map((o) => o.id));
    let cashWithFleet = ZERO;
    let nonCashWithFleet = ZERO;
    for (const o of open) {
      const t = live.get(o.id) ?? EMPTY_TOTALS;
      cashWithFleet = cashWithFleet.add(dec(o.openingCash)).add(t.cashIn).sub(t.cashOut);
      nonCashWithFleet = nonCashWithFleet.add(t.nonCashIn);
    }

    const [closedToday, mismatches] = await Promise.all([
      prisma.cashShift.aggregate({
        where: {
          branchId,
          status: { not: "OPEN" },
          closedAt: { gte: todayStart.toJSDate(), lt: todayStart.plus({ days: 1 }).toJSDate() },
        },
        _count: { _all: true },
        _sum: { actualTotal: true },
      }),
      prisma.cashShift.count({
        where: {
          branchId,
          status: { not: "OPEN" },
          discrepancy: { not: 0 },
          closedAt: { gte: fromDay.toJSDate(), lt: toDay.plus({ days: 1 }).toJSDate() },
        },
      }),
    ]);

    return {
      openShifts: open.length,
      cashWithFleet: money(cashWithFleet),
      nonCashWithFleet: money(nonCashWithFleet),
      closedToday: { count: closedToday._count._all, cashReceived: money(dec(closedToday._sum.actualTotal)) },
      mismatches,
      range: { from: fromDay.toFormat("yyyy-MM-dd"), to: toDay.toFormat("yyyy-MM-dd") },
    };
  }

  /**
   * COLLECTED payments of the branch that no open shift will confirm at close:
   * recorded outside any shift (e.g. a manager's counter cash, old builds) or
   * left COLLECTED in a shift closed before Oct 2026. The manager confirms or
   * rejects these one by one (the old Cash Confirmations, now in Cash Shift).
   */
  async listUnconfirmedOutsideOpenShifts(branchId: number, page = 1, pageSize = 20) {
    const where: Prisma.PaymentTransactionWhereInput = {
      branchId,
      status: "COLLECTED",
      OR: [{ cashShiftId: null }, { cashShift: { status: { not: "OPEN" } } }],
    };
    const [rows, total] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where,
        orderBy: [{ collectedAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          publicId: true,
          purpose: true,
          method: true,
          totalAmount: true,
          cashAmount: true,
          onlineAmount: true,
          onlineGateway: true,
          onlineTransactionRef: true,
          collectedAt: true,
          createdAt: true,
          notes: true,
          booking: { select: { publicId: true, customer: { select: { user: { select: { name: true } } } } } },
          collectedBy: { select: { publicId: true, name: true } },
          cashShift: { select: { publicId: true, status: true } },
          proofFile: PROOF_FILE_RELATION_SELECT,
          proofPhotos: PROOF_PHOTOS_RELATION_SELECT,
        },
      }),
      prisma.paymentTransaction.count({ where }),
    ]);
    const transactions = await Promise.all(rows.map(async (t) => ({
      transactionPublicId: t.publicId,
      bookingPublicId: t.booking.publicId,
      customerName: t.booking.customer?.user?.name ?? null,
      purpose: t.purpose,
      method: t.method,
      amount: money(dec(t.totalAmount)),
      cashAmount: money(dec(t.cashAmount)),
      onlineAmount: money(dec(t.onlineAmount)),
      onlineGateway: t.onlineGateway,
      onlineTransactionRef: t.onlineTransactionRef,
      isUpi: String(t.onlineGateway ?? "").toUpperCase() === "UPI",
      collectedAt: (t.collectedAt ?? t.createdAt).toISOString(),
      employeeName: t.collectedBy?.name ?? null,
      shiftPublicId: t.cashShift?.publicId ?? null,
      shiftStatus: t.cashShift?.status ?? null,
      notes: t.notes,
      ...(await proofPhotoFields(t.proofFile, t.proofPhotos)),
    })));
    return { transactions, total, page, pageSize };
  }

  async listForBranch(branchId: number, filters: ShiftListFilters): Promise<PaginatedShifts> {
    let employeeId: number | undefined;
    if (filters.employeePublicId) {
      const employee = await prisma.user.findUnique({
        where: { publicId: filters.employeePublicId },
        select: { id: true },
      });
      // Unknown executive: an empty list rather than an error
      employeeId = employee?.id ?? -1;
    }
    return this.list({ branchId }, filters, employeeId, true);
  }

  /** A Fleet Executive's own shifts across every branch they have worked in. */
  async listForEmployee(employeeId: number, filters: ShiftListFilters): Promise<PaginatedShifts> {
    return this.list({ employeeId }, { ...filters, employeePublicId: undefined }, undefined, false);
  }

  private parseIstDay(day: string): DateTime {
    const dt = DateTime.fromISO(day, { zone: SYSTEM_TIMEZONE });
    if (!dt.isValid) {
      throw new CashShiftError(StatusCode.BAD_REQUEST, "INVALID_DATE_RANGE", `${day} is not a valid date.`);
    }
    return dt.startOf("day");
  }

  /** One filter definition, rendered for Prisma (rows/count) and raw SQL (daily totals). */
  private resolveFilters(
    scope: { branchId?: number; employeeId?: number },
    filters: ShiftListFilters,
    employeeFilterId?: number,
  ): ResolvedFilters {
    const where: Prisma.CashShiftWhereInput = {};
    const sql: Prisma.Sql[] = [];

    if (scope.branchId !== undefined) {
      where.branchId = scope.branchId;
      sql.push(Prisma.sql`s."branchId" = ${scope.branchId}`);
    }
    const employeeId = scope.employeeId ?? employeeFilterId;
    if (employeeId !== undefined) {
      where.employeeId = employeeId;
      sql.push(Prisma.sql`s."employeeId" = ${employeeId}`);
    }

    const openNow = filters.openNow === true;
    let statuses: Array<CashShift["status"]> | null = null;
    if (openNow || filters.status === "OPEN") statuses = ["OPEN"];
    else if (filters.status === "ENDED") statuses = ["CLOSED", "DISCREPANCY_FLAGGED"];
    else if (filters.status) statuses = [filters.status];
    if (statuses) {
      where.status = { in: statuses };
      sql.push(Prisma.sql`s."status"::text IN (${Prisma.join(statuses)})`);
    }
    // Matched / Mismatch: closed shifts by their stored difference
    if (!openNow && filters.result) {
      const mismatch = filters.result === "MISMATCH";
      where.AND = [
        { status: { not: "OPEN" } },
        mismatch ? { discrepancy: { not: 0 } } : { discrepancy: 0 },
      ];
      sql.push(mismatch
        ? Prisma.sql`s."status" <> 'OPEN' AND s."discrepancy" <> 0`
        : Prisma.sql`s."status" <> 'OPEN' AND s."discrepancy" = 0`);
    }

    // A shift belongs to the IST calendar date it opened on. "Open now"
    // ignores dates so a shift left open since an earlier day still shows.
    const fromDay = openNow ? null : (filters.date ?? filters.from ?? null);
    const toDay = openNow ? null : (filters.date ?? filters.to ?? null);
    const start = fromDay ? this.parseIstDay(fromDay) : null;
    const end = toDay ? this.parseIstDay(toDay) : null;
    if (start && end) {
      if (start > end) {
        throw new CashShiftError(StatusCode.BAD_REQUEST, "INVALID_DATE_RANGE", "The from date must be on or before the to date.");
      }
      if (Math.round(end.diff(start, "days").days) + 1 > MAX_RANGE_DAYS) {
        throw new CashShiftError(StatusCode.BAD_REQUEST, "INVALID_DATE_RANGE", `Pick a range of at most ${MAX_RANGE_DAYS} days.`);
      }
    }
    // dateField CLOSED (the Closed list): the IST day the shift was closed
    const byClosed = filters.dateField === "CLOSED";
    const col = byClosed ? Prisma.sql`s."closedAt"` : Prisma.sql`s."openedAt"`;
    if (start || end) {
      const range: Prisma.DateTimeFilter = {};
      if (start) {
        const gte = start.toJSDate();
        range.gte = gte;
        sql.push(Prisma.sql`${col} >= ${sqlTs(gte)}::timestamp`);
      }
      if (end) {
        const lt = end.plus({ days: 1 }).toJSDate();
        range.lt = lt;
        sql.push(Prisma.sql`${col} < ${sqlTs(lt)}::timestamp`);
      }
      if (byClosed) where.closedAt = range;
      else where.openedAt = range;
    }

    return {
      where,
      sqlWhere: sql.length > 0 ? Prisma.join(sql, " AND ") : Prisma.sql`TRUE`,
      echo: {
        status: openNow ? "OPEN" : (filters.status ?? null),
        from: fromDay,
        to: toDay,
        openNow,
        employeePublicId: filters.employeePublicId ?? null,
        result: filters.result ?? null,
        dateField: filters.dateField ?? "OPENED",
      },
    };
  }

  /** Daily (IST) and grand totals over every shift matching the filter. */
  private async aggregateByDay(sqlWhere: Prisma.Sql): Promise<{
    daily: PaginatedShifts["dailyTotals"];
    summary: ShiftDayTotals;
  }> {
    const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
      WITH f AS (
        SELECT s."id", s."status"::text AS "status", s."openingCash", s."cashCollected", s."cashRefunded",
               s."expectedTotal", s."actualTotal", s."discrepancy",
               to_char(timezone(${SYSTEM_TIMEZONE}, timezone('UTC', s."openedAt")), 'YYYY-MM-DD') AS "day"
        FROM "CashShift" s
        WHERE ${sqlWhere}
      ),
      l AS (${liveTotalsSql(Prisma.sql`IN (SELECT "id" FROM f)`)})
      SELECT f."day" AS "date",
        GROUPING(f."day")::int AS "isTotal",
        COUNT(f."id")::int AS "shiftCount",
        (COUNT(f."id") FILTER (WHERE f."status" = 'OPEN'))::int AS "openCount",
        (COUNT(f."id") FILTER (WHERE f."status" = 'CLOSED'))::int AS "closedCount",
        (COUNT(f."id") FILTER (WHERE f."status" = 'DISCREPANCY_FLAGGED'))::int AS "flaggedCount",
        COALESCE(SUM(f."openingCash"), 0) AS "openingCash",
        COALESCE(SUM(CASE WHEN f."status" = 'OPEN' THEN COALESCE(l."cashIn", 0) ELSE f."cashCollected" END), 0) AS "cashCollected",
        COALESCE(SUM(CASE WHEN f."status" = 'OPEN' THEN COALESCE(l."cashOut", 0) ELSE f."cashRefunded" END), 0) AS "cashRefunded",
        COALESCE(SUM(CASE WHEN f."status" = 'OPEN'
          THEN f."openingCash" + COALESCE(l."cashIn", 0) - COALESCE(l."cashOut", 0)
          ELSE f."expectedTotal" END), 0) AS "expectedClosing",
        COALESCE(SUM(f."actualTotal") FILTER (WHERE f."status" <> 'OPEN'), 0) AS "closingCash",
        -- Old-rule variances (stale after a post-close confirm) aren't summed;
        -- legacyCount says how many closed shifts were left out.
        COALESCE(SUM(f."discrepancy") FILTER (WHERE f."status" <> 'OPEN' AND NOT ${LEGACY_CLOSE_SQL}), 0) AS "variance",
        (COUNT(f."id") FILTER (WHERE ${LEGACY_CLOSE_SQL}))::int AS "legacyCount",
        COALESCE(SUM(l."pendingCash"), 0) AS "pendingCash",
        COALESCE(SUM(l."upiCollected"), 0) AS "upiCollected"
      FROM f LEFT JOIN l ON l."shiftId" = f."id"
      GROUP BY GROUPING SETS ((f."day"), ())
      ORDER BY "isTotal" DESC, f."day" DESC`);

    const toTotals = (r: Record<string, any> | undefined): ShiftDayTotals => ({
      shiftCount: Number(r?.shiftCount ?? 0),
      openCount: Number(r?.openCount ?? 0),
      closedCount: Number(r?.closedCount ?? 0),
      flaggedCount: Number(r?.flaggedCount ?? 0),
      openingCash: money(dec(r?.openingCash)),
      cashCollected: money(dec(r?.cashCollected)),
      cashRefunded: money(dec(r?.cashRefunded)),
      expectedClosing: money(dec(r?.expectedClosing)),
      closingCash: money(dec(r?.closingCash)),
      variance: money(dec(r?.variance)),
      pendingCash: money(dec(r?.pendingCash)),
      upiCollected: money(dec(r?.upiCollected)),
      legacyCount: Number(r?.legacyCount ?? 0),
    });

    const daily = rows
      .filter((r) => Number(r.isTotal) === 0 && r.date)
      .slice(0, MAX_DAILY_ROWS)
      .map((r) => ({ date: String(r.date), ...toTotals(r) }));
    const summary = toTotals(rows.find((r) => Number(r.isTotal) === 1));
    return { daily, summary };
  }

  private async list(
    scope: { branchId?: number; employeeId?: number },
    filters: ShiftListFilters,
    employeeFilterId: number | undefined,
    legacy: boolean,
  ): Promise<PaginatedShifts> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const { where, sqlWhere, echo } = this.resolveFilters(scope, filters, employeeFilterId);
    const scopeWhere: Prisma.CashShiftWhereInput =
      scope.branchId !== undefined ? { branchId: scope.branchId } : { employeeId: scope.employeeId };

    const [rows, total, openNowCount, aggregates] = await Promise.all([
      prisma.cashShift.findMany({
        where,
        include: SHIFT_PEOPLE_INCLUDE,
        orderBy: filters.dateField === "CLOSED"
          ? [{ closedAt: "desc" }, { id: "desc" }]
          : filters.status === "OPEN" || filters.openNow
            ? [{ openedAt: "asc" }, { id: "asc" }]
            : [{ openedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.cashShift.count({ where }),
      prisma.cashShift.count({ where: { ...scopeWhere, status: "OPEN" } }),
      this.aggregateByDay(sqlWhere),
    ]);

    const live = await this.liveTotals(rows.map((r) => r.id));
    const shifts = rows.map((s) => {
      const view = this.toView(s, live.get(s.id) ?? EMPTY_TOTALS);
      return legacy ? { ...s, ...this.legacyKeys(view, s), ...view } : view;
    });

    return {
      shifts,
      total,
      page,
      pageSize,
      dailyTotals: aggregates.daily,
      summary: aggregates.summary,
      openNowCount,
      filters: echo,
    };
  }
}

export const cashShiftService = new CashShiftService();
