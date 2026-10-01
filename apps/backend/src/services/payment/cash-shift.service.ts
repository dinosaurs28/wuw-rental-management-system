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

/*
 * Cash shift money model
 * ──────────────────────
 *   expected drawer = openingCash + cash collected − cash refunded
 *   variance        = counted closing cash − expected drawer
 *
 * "Cash collected" is the physical cash the executive took in on transactions
 * linked to the shift: COLLECTED (awaiting BM confirmation) + CONFIRMED. A BM
 * rejection before close takes it out. "Cash refunded" is cash paid out of the
 * drawer (CONFIRMED refund-purpose transactions). UPI (UTR) money is linked to
 * the shift for reporting but never enters the drawer.
 *
 * While a shift is OPEN these figures are computed live. Closing snapshots
 * cashCollected / cashRefunded / expectedTotal / actualTotal / discrepancy and
 * nothing changes them afterwards — a later BM confirm or reject shows up only
 * as the transaction's current status in the shift detail.
 *
 * Shifts closed before this model (Oct 2026) measured variance against BM-
 * confirmed cash only; their stored expectedTotal/discrepancy are kept as-is
 * and flagged with legacyVariance.
 */

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId: number;
  actorPublicId: string;
  branchName: string;
}

export type CashShiftErrorCode =
  | "SHIFT_NOT_FOUND"
  | "SHIFT_ALREADY_OPEN"
  | "SHIFT_NOT_OPEN"
  | "SHIFT_NOT_YOURS"
  | "SHIFT_OTHER_BRANCH"
  | "DISCREPANCY_EXPLANATION_REQUIRED"
  | "SHIFT_NOT_FLAGGED"
  | "RECONCILE_FORBIDDEN"
  | "INVALID_DATE_RANGE";

/** Controllers reply with `status` and `toJSON()` (the shared 4xx error contract). */
export class CashShiftError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: CashShiftErrorCode,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CashShiftError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

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
  filters: { status: string | null; from: string | null; to: string | null; openNow: boolean; employeePublicId: string | null };
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
}

const ZERO = new Decimal(0);
const MAX_RANGE_DAYS = 366;
const MAX_DAILY_ROWS = 400;
const REFUND_PURPOSES = ["OVERPAYMENT_REFUND", "CANCELLATION_REFUND"] as const;

type Db = Prisma.TransactionClient | typeof prisma;

interface LiveTotals {
  cashIn: Decimal;
  cashOut: Decimal;
  pendingCash: Decimal;
  confirmedCash: Decimal;
  rejectedCash: Decimal;
  upiCollected: Decimal;
  transactionCount: number;
}

const EMPTY_TOTALS: LiveTotals = {
  cashIn: ZERO,
  cashOut: ZERO,
  pendingCash: ZERO,
  confirmedCash: ZERO,
  rejectedCash: ZERO,
  upiCollected: ZERO,
  transactionCount: 0,
};

const dec = (v: { toString(): string } | null | undefined): Decimal => new Decimal(v?.toString() ?? "0");
const money = (d: Decimal): string => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const istDateOf = (d: Date): string => DateTime.fromJSDate(d, { zone: SYSTEM_TIMEZONE }).toFormat("yyyy-MM-dd");
/** UTC wall-clock literal for comparing Prisma's `timestamp without time zone` columns in raw SQL. */
const sqlTs = (d: Date): string => d.toISOString().replace("T", " ").replace("Z", "");

const MONEY_IN = Prisma.sql`t."purpose" NOT IN ('OVERPAYMENT_REFUND', 'CANCELLATION_REFUND')`;
const MONEY_OUT = Prisma.sql`t."purpose" IN ('OVERPAYMENT_REFUND', 'CANCELLATION_REFUND')`;

/**
 * Per-shift live totals from linked PaymentTransactions — the single
 * definition of "cash collected / refunded / pending / UPI" used by the
 * active shift, the close snapshot, list rows and the daily totals.
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
    COUNT(*)::int AS "transactionCount"
  FROM "PaymentTransaction" t
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
};

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

      const existing = await tx.cashShift.findFirst({
        where: { employeeId: actor.actorId, status: "OPEN" },
        select: { id: true },
      });
      if (existing) {
        throw new CashShiftError(
          StatusCode.CONFLICT,
          "SHIFT_ALREADY_OPEN",
          "You already have an open shift. Close it before starting a new one.",
        );
      }

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

  async close(publicId: string, actualTotal: number, discrepancyExplanation: string | undefined, actor: ActorContext): Promise<CashShift> {
    const actual = new Decimal(actualTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const explanation = discrepancyExplanation?.trim() || null;

    const { shift, updated, expected, discrepancy, totals } = await prisma.$transaction(
      async (tx) => {
        const found = await tx.cashShift.findUnique({ where: { publicId } });
        if (!found) throw new CashShiftError(StatusCode.NOT_FOUND, "SHIFT_NOT_FOUND", "Cash shift not found.");

        // The executive closes their own shift; a branch manager may close one in
        // their own branch (e.g. a shift left open); admins any.
        if (found.employeeId !== actor.actorId) {
          if (actor.actorRole === "MANAGER") {
            if (found.branchId !== actor.actorBranchId) {
              throw new CashShiftError(StatusCode.FORBIDDEN, "SHIFT_OTHER_BRANCH", "This shift belongs to another branch.");
            }
          } else if (actor.actorRole !== "ADMIN") {
            throw new CashShiftError(StatusCode.FORBIDDEN, "SHIFT_NOT_YOURS", "You can only close your own shift.");
          }
        }

        await this.lockEmployee(found.employeeId, tx);
        const [row] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text AS "status" FROM "CashShift" WHERE "id" = ${found.id} FOR UPDATE`;
        if (row?.status !== "OPEN") {
          throw new CashShiftError(StatusCode.BAD_REQUEST, "SHIFT_NOT_OPEN", `Shift is already ${row?.status ?? found.status}.`);
        }

        const live = (await this.liveTotals([found.id], tx)).get(found.id) ?? EMPTY_TOTALS;
        const exp = dec(found.openingCash).add(live.cashIn).sub(live.cashOut);
        const diff = actual.sub(exp);
        const flagged = !diff.isZero();

        if (flagged && !explanation) {
          throw new CashShiftError(
            StatusCode.BAD_REQUEST,
            "DISCREPANCY_EXPLANATION_REQUIRED",
            `Counted cash ₹${actual.toFixed(2)} is ${diff.isNegative() ? "short" : "over"} by ₹${diff.abs().toFixed(2)} against the ₹${exp.toFixed(2)} expected in the drawer. Add an explanation (at least 10 characters) to close the shift.`,
            {
              expectedClosing: money(exp),
              expectedTotal: money(exp),
              discrepancy: money(diff),
              openingCash: money(dec(found.openingCash)),
              cashCollected: money(live.cashIn),
              cashRefunded: money(live.cashOut),
            },
          );
        }

        const saved = await tx.cashShift.update({
          where: { id: found.id },
          data: {
            status: flagged ? "DISCREPANCY_FLAGGED" : "CLOSED",
            closedAt: new Date(),
            cashCollected: money(live.cashIn),
            cashRefunded: money(live.cashOut),
            expectedTotal: money(exp),
            actualTotal: actual.toFixed(2),
            discrepancy: money(diff),
            discrepancyExplanation: explanation,
          },
        });

        return { shift: found, updated: saved, expected: exp, discrepancy: diff, totals: live };
      },
      { timeout: 15000 },
    );

    const hasDiscrepancy = !discrepancy.isZero();
    const newStatus = updated.status;

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: shift.branchId,
      action: "CLOSE_CASH_SHIFT",
      category: AuditCategory.PAYMENT,
      severity: hasDiscrepancy ? "WARNING" : "INFO",
      description: `Cash shift closed. Opening: ₹${dec(shift.openingCash).toFixed(2)}, Collected: ₹${totals.cashIn.toFixed(2)}, Refunded: ₹${totals.cashOut.toFixed(2)}, Expected: ₹${expected.toFixed(2)}, Actual: ₹${actual.toFixed(2)}, Discrepancy: ₹${discrepancy.toFixed(2)}`,
      entity: "CashShift",
      entityId: shift.publicId,
      after: {
        status: newStatus,
        openingCash: dec(shift.openingCash).toFixed(2),
        cashCollected: totals.cashIn.toFixed(2),
        cashRefunded: totals.cashOut.toFixed(2),
        expectedTotal: expected.toFixed(2),
        actualTotal: actual.toFixed(2),
        discrepancy: discrepancy.toFixed(2),
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
      description: `Cash shift closed${hasDiscrepancy ? ` with discrepancy ₹${discrepancy.toFixed(2)}` : ""}`,
      metadata: { expected: expected.toFixed(2), actual: actual.toFixed(2), discrepancy: discrepancy.toFixed(2) },
    });

    if (hasDiscrepancy) void notifyEvents.shiftDiscrepancy({ shiftId: shift.id, actorUserId: actor.actorId });

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
        transactions: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            publicId: true,
            purpose: true,
            method: true,
            status: true,
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

    const transactions = rawTxns.map((t) => ({
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
    }));

    return opts.legacy
      ? { ...record, ...this.legacyKeys(view, record), ...view, transactions }
      : { ...view, transactions };
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
    if (start || end) {
      const openedAt: Prisma.DateTimeFilter = {};
      if (start) {
        const gte = start.toJSDate();
        openedAt.gte = gte;
        sql.push(Prisma.sql`s."openedAt" >= ${sqlTs(gte)}::timestamp`);
      }
      if (end) {
        const lt = end.plus({ days: 1 }).toJSDate();
        openedAt.lt = lt;
        sql.push(Prisma.sql`s."openedAt" < ${sqlTs(lt)}::timestamp`);
      }
      where.openedAt = openedAt;
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
        include: {
          employee: { select: { publicId: true, name: true } },
          branch: { select: { name: true } },
          reconciledBy: { select: { publicId: true, name: true } },
        },
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
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
