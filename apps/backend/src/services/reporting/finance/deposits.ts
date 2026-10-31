/**
 * 2.4 Security Deposits — the refundable safety deposit, per rental.
 *
 * Rentals: bookings in scope with startAt in the range (same anchor as revenue,
 * so the list reconciles with the rentals of the period) that took a deposit.
 *
 *   Taken    = computeBookingOwed().safetyDepositCharged (deposit on a session
 *              bill or a standalone SAFETY_DEPOSIT payment).
 *   Deducted = Unified Payments drop: the latest COMPLETED RETURN session's
 *              metadata.deposit.setOff (deposit used against the drop charges),
 *              reasons = its split over the bill's charge lines (depositSetOffSql,
 *              shared with charge-collection.service). Legacy drop with SET_OFF:
 *              min(held deposit set off, return charges); reasons = the legacy
 *              return-charge types, without amounts per line (not recorded).
 *   Refunded = drop bill: metadata.deposit.refund (deposit going back); legacy:
 *              the `sdr:` deposit refunds recorded through BM Settlements.
 *   Held     = computeBookingOwed().safetyDepositHeld (not yet credited back).
 *   Unreconciled = taken − deducted − refunded − held (should be 0; anything
 *              else is flagged, never hidden).
 *   The refundable category deposit inside Booking.totalDeposit is a different
 *   thing (part of totalFinal) and is shown in its own column.
 *
 * Snapshot "held now" = Σ held over every booking in scope (any date).
 */
import { prisma, Prisma, PaymentPurpose } from "@repo/database/client";
import {
  applyVehicleToBookingWhere,
  bookingScopeFromFilters,
  buildBookingWhere,
  computeDelta,
  paymentWhereFromFilters,
  type Delta,
  type ReportFilters,
} from "../../../utils/reporting/index.js";
import { computeBookingsOwed, type BookingOwed } from "../../payment/booking-owed.service.js";
import { depositSetOffSql } from "../charge-collection.service.js";
import { CLIENT_PAYMENT_TYPE_LABELS, isClientPaymentType, typeForChargeEntry } from "../../financials/payment-type.js";
import { LEGACY_RETURN_CHARGE_TYPES } from "../../charges/legacy-return-charges.service.js";
import { modeLabelOf, modeSplitOf } from "./booking-finance.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

type Range = { start: Date; end: Date };

export interface DepositReason {
  type: string;
  label: string;
  /** null = the amount per reason isn't recorded (legacy drop) */
  amount: number | null;
}

export interface DepositRow {
  bookingPublicId: string;
  startAt: Date;
  returnedAt: Date | null;
  status: string;
  branchName: string;
  customerName: string;
  vehicle: string;
  categoryDeposit: number;
  taken: number;
  deducted: number;
  refunded: number;
  held: number;
  unreconciled: number;
  handling: string | null;
  flow: "DROP_BILL" | "LEGACY" | "NOT_RETURNED";
  reasons: DepositReason[];
  reasonText: string;
}

/** Deposit split of one booking (pure). */
export function depositSplitOf(
  owed: Pick<BookingOwed, "safetyDepositCharged" | "safetyDepositHeld" | "safetyDepositHandling" | "legacyDepositSetOff" | "legacyDepositRefunded" | "returnCharges">,
  dropBill: { setOff: number; refund: number; handling: string | null } | null,
): { taken: number; deducted: number; refunded: number; held: number; unreconciled: number; flow: DepositRow["flow"]; handling: string | null } {
  const taken = r2(num(owed.safetyDepositCharged));
  const held = r2(num(owed.safetyDepositHeld));
  let deducted = 0;
  let refunded = 0;
  let flow: DepositRow["flow"] = "NOT_RETURNED";
  let handling: string | null = null;
  if (dropBill) {
    flow = "DROP_BILL";
    deducted = r2(dropBill.setOff);
    refunded = r2(dropBill.refund);
    handling = dropBill.handling;
  } else if (owed.safetyDepositHandling) {
    flow = "LEGACY";
    handling = owed.safetyDepositHandling;
    const setOff = num(owed.legacyDepositSetOff);
    deducted = r2(Math.min(setOff, Math.max(0, num(owed.returnCharges))));
    refunded = r2(num(owed.legacyDepositRefunded));
  }
  return { taken, deducted, refunded, held, unreconciled: r2(taken - deducted - refunded - held), flow, handling };
}

interface DropBillDeposit {
  setOff: number;
  refund: number;
  handling: string | null;
}

async function latestDropBillDeposits(ids: number[]): Promise<Map<number, DropBillDeposit>> {
  const out = new Map<number, DropBillDeposit>();
  if (!ids.length) return out;
  const rows = await prisma.$queryRaw<Array<{ booking_id: number; deposit: unknown }>>(Prisma.sql`
    SELECT DISTINCT ON (ps."bookingId") ps."bookingId" AS booking_id, ps.metadata->'deposit' AS deposit
    FROM "PaymentSession" ps
    WHERE ps."bookingId" IN (${Prisma.join(ids)})
      AND ps."sessionType"::text = 'RETURN' AND ps.status::text = 'COMPLETED'
    ORDER BY ps."bookingId", ps."completedAt" DESC NULLS LAST, ps.id DESC`);
  for (const r of rows) {
    const d = (r.deposit ?? null) as Record<string, unknown> | null;
    if (!d || typeof d !== "object") continue;
    const n = (v: unknown) => (typeof v === "string" || typeof v === "number") && !isNaN(Number(v)) ? Number(v) : 0;
    out.set(Number(r.booking_id), {
      setOff: n(d.setOff),
      refund: n(d.refund),
      handling: typeof d.handling === "string" ? d.handling : null,
    });
  }
  return out;
}

async function setOffReasons(ids: number[]): Promise<Map<number, DepositReason[]>> {
  const out = new Map<number, DepositReason[]>();
  if (!ids.length) return out;
  const rows = await prisma.$queryRaw<Array<{ booking_id: number; type: string | null; amount: unknown }>>(depositSetOffSql(ids));
  for (const r of rows) {
    const type = r.type ?? "OTHER";
    const list = out.get(Number(r.booking_id)) ?? [];
    list.push({ type, label: isClientPaymentType(type) ? CLIENT_PAYMENT_TYPE_LABELS[type] : type, amount: r2(Number(r.amount)) });
    out.set(Number(r.booking_id), list);
  }
  return out;
}

async function legacyReasons(ids: number[]): Promise<Map<number, DepositReason[]>> {
  const out = new Map<number, DepositReason[]>();
  if (!ids.length) return out;
  const rows = await prisma.chargeEntry.findMany({
    where: { bookingId: { in: ids }, chargeType: { in: LEGACY_RETURN_CHARGE_TYPES } },
    select: { bookingId: true, chargeType: true },
  });
  for (const r of rows) {
    const t = typeForChargeEntry(r.chargeType) ?? r.chargeType;
    const list = out.get(r.bookingId) ?? [];
    if (!list.some((x) => x.type === t)) list.push({ type: t, label: isClientPaymentType(t) ? CLIENT_PAYMENT_TYPE_LABELS[t] : t, amount: null });
    out.set(r.bookingId, list);
  }
  return out;
}

async function loadDepositRows(f: ReportFilters, range: Range): Promise<DepositRow[]> {
  const where = applyVehicleToBookingWhere(
    buildBookingWhere({
      branchPublicId: f.branchPublicId,
      categoryPublicIds: f.categoryPublicIds,
      from: range.start,
      to: range.end,
      statuses: ["CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED"],
    }),
    f.vehiclePublicId,
  );
  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { startAt: "desc" },
    select: {
      id: true,
      publicId: true,
      startAt: true,
      returnedAt: true,
      status: true,
      totalDeposit: true,
      branch: { select: { name: true } },
      customer: { select: { user: { select: { name: true } } } },
      items: { select: { vehicle: { select: { regNo: true, make: true, model: true } } } },
    },
  });
  const ids = bookings.map((b) => b.id);
  const owed = await computeBookingsOwed(ids);
  const withDeposit = ids.filter((id) => num(owed.get(id)?.safetyDepositCharged) > 0);
  const [bills, reasonsBill, reasonsLegacy] = await Promise.all([
    latestDropBillDeposits(withDeposit),
    setOffReasons(withDeposit),
    legacyReasons(withDeposit),
  ]);
  const rows: DepositRow[] = [];
  for (const b of bookings) {
    const o = owed.get(b.id);
    if (!o || num(o.safetyDepositCharged) <= 0) continue;
    const split = depositSplitOf(o, bills.get(b.id) ?? null);
    let reasons: DepositReason[] = [];
    if (split.deducted > 0) {
      reasons = split.flow === "DROP_BILL" ? (reasonsBill.get(b.id) ?? []) : (reasonsLegacy.get(b.id) ?? []);
    }
    const v = b.items[0]?.vehicle;
    rows.push({
      bookingPublicId: b.publicId,
      startAt: b.startAt,
      returnedAt: b.returnedAt,
      status: b.status,
      branchName: b.branch.name,
      customerName: b.customer.user.name,
      vehicle: v ? `${v.regNo} · ${v.make} ${v.model}` : "Not recorded",
      categoryDeposit: r2(num(b.totalDeposit)),
      ...split,
      reasons,
      reasonText:
        split.deducted > 0
          ? reasons.length
            ? reasons.map((r) => (r.amount == null ? r.label : `${r.label} ${r.amount}`)).join("; ")
            : "Not recorded"
          : "",
    });
  }
  return rows;
}

export interface DepositTotals {
  rentals: number;
  taken: number;
  deducted: number;
  refunded: number;
  held: number;
  unreconciled: number;
  unreconciledRentals: number;
}

export function sumDeposits(rows: DepositRow[]): DepositTotals {
  const t = { rentals: rows.length, taken: 0, deducted: 0, refunded: 0, held: 0, unreconciled: 0, unreconciledRentals: 0 };
  for (const r of rows) {
    t.taken += r.taken;
    t.deducted += r.deducted;
    t.refunded += r.refunded;
    t.held += r.held;
    t.unreconciled += r.unreconciled;
    if (Math.abs(r.unreconciled) >= 0.01) t.unreconciledRentals += 1;
  }
  return {
    ...t,
    taken: r2(t.taken),
    deducted: r2(t.deducted),
    refunded: r2(t.refunded),
    held: r2(t.held),
    unreconciled: r2(t.unreconciled),
  };
}

/** Deposit currently held across every booking in scope (any date). */
async function heldNow(f: ReportFilters): Promise<{ amount: number; bookings: number }> {
  const candidates = await prisma.booking.findMany({
    where: {
      AND: [
        bookingScopeFromFilters(f),
        {
          OR: [
            { ledgerEntries: { some: { entryType: "DEPOSIT", isVoided: false } } },
            { paymentTransactions: { some: { purpose: PaymentPurpose.SAFETY_DEPOSIT, status: { in: ["COLLECTED", "CONFIRMED"] } } } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  const owed = await computeBookingsOwed(candidates.map((c) => c.id));
  let amount = 0;
  let bookings = 0;
  for (const o of owed.values()) {
    const h = num(o.safetyDepositHeld);
    if (h > 0) {
      amount += h;
      bookings += 1;
    }
  }
  return { amount: r2(amount), bookings };
}

/** SAFETY_DEPOSIT payments by payment date (transaction-level). */
async function depositTransactions(f: ReportFilters) {
  const txns = await prisma.paymentTransaction.findMany({
    where: {
      AND: [paymentWhereFromFilters(f), { purpose: PaymentPurpose.SAFETY_DEPOSIT, status: { in: ["COLLECTED", "CONFIRMED", "VOIDED"] } }],
    },
    orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }],
    select: {
      publicId: true,
      status: true,
      method: true,
      totalAmount: true,
      cashAmount: true,
      onlineAmount: true,
      onlineGateway: true,
      onlineTransactionRef: true,
      collectedAt: true,
      createdAt: true,
      booking: { select: { publicId: true } },
      collectedBy: { select: { name: true } },
    },
  });
  return txns.map((t) => {
    const modes = modeSplitOf({
      method: t.method,
      totalAmount: num(t.totalAmount),
      cashAmount: num(t.cashAmount),
      onlineAmount: num(t.onlineAmount),
      onlineGateway: t.onlineGateway,
    });
    return {
      publicId: t.publicId,
      bookingPublicId: t.booking.publicId,
      paidAt: t.collectedAt ?? t.createdAt,
      status: t.status,
      amount: r2(num(t.totalAmount)),
      mode: modeLabelOf(modes),
      reference: t.onlineTransactionRef,
      collectedBy: t.collectedBy?.name ?? "Not recorded",
    };
  });
}

export interface DepositsReport {
  summary: DepositTotals;
  previous: DepositTotals | null;
  deltas: Record<string, Delta> | null;
  heldNow: { amount: number; bookings: number };
  rows: DepositRow[];
  transactions: Awaited<ReturnType<typeof depositTransactions>>;
}

export async function buildDepositsReport(f: ReportFilters, opts: { compare: boolean }): Promise<DepositsReport> {
  const [rows, prevRows, held, txns] = await Promise.all([
    loadDepositRows(f, f),
    opts.compare ? loadDepositRows(f, f.previous) : Promise.resolve(null),
    heldNow(f),
    depositTransactions(f),
  ]);
  const summary = sumDeposits(rows);
  const previous = prevRows ? sumDeposits(prevRows) : null;
  return {
    summary,
    previous,
    deltas: previous
      ? {
          taken: computeDelta(summary.taken, previous.taken),
          deducted: computeDelta(summary.deducted, previous.deducted),
          refunded: computeDelta(summary.refunded, previous.refunded),
          rentals: computeDelta(summary.rentals, previous.rentals),
        }
      : null,
    heldNow: held,
    rows,
    transactions: txns,
  };
}
