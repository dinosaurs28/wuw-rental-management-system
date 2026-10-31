/**
 * 2.2 Payments & Collections — PaymentTransaction rows by payment date
 * (collectedAt, else createdAt; paymentWhereFromFilters).
 *
 *   Collected (recorded) = money-in rows (every purpose but the two refund
 *     purposes) with status COLLECTED or CONFIRMED — the same "paid" set as the
 *     reporting core and BM Financials. VOIDED / REJECTED / FAILED / INITIATED /
 *     REFUNDED rows count nowhere but are listed for reconciliation.
 *   Confirmed = CONFIRMED only; Awaiting confirmation = COLLECTED (cash / counter
 *     UPI the branch manager hasn't confirmed yet).
 *   Rental collections = collected without SAFETY_DEPOSIT (= getCollections /
 *     Collection report); security deposits are held money, shown apart.
 *   Refunds paid out = OVERPAYMENT_REFUND / CANCELLATION_REFUND rows (COLLECTED /
 *     CONFIRMED) in the range; Net = collected − refunds paid out.
 *   Mode split: modeSplitOf (booking-finance.ts) — Card is not recorded apart from
 *     the Razorpay gateway.
 *   Staff = collectedBy; no collector = paid online by the customer.
 *   Discrepancies: awaiting confirmation; voided (by voidedAt) and rejected (by
 *     rejectedAt) in the range; cash shifts closed in the range whose counted cash
 *     differs from expected (branch filter only — shifts have no category/vehicle).
 */
import { prisma, Prisma, PaymentPurpose } from "@repo/database/client";
import { bookingScopeFromFilters, computeDelta, paymentWhereFromFilters, type Delta, type ReportFilters } from "../../../utils/reporting/index.js";
import { MODE_KEYS, modeLabelOf, modeSplitOf, type ModeSplit } from "./booking-finance.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

export const REFUND_PURPOSES: PaymentPurpose[] = [PaymentPurpose.OVERPAYMENT_REFUND, PaymentPurpose.CANCELLATION_REFUND];
export const PURPOSE_LABELS: Record<string, string> = {
  ADVANCE: "Advance",
  FULL_PAYMENT: "Full payment",
  REMAINING_BALANCE: "Balance / drop bill",
  EXTENSION: "Extension",
  DAMAGE_FEE: "Damage fee",
  SAFETY_DEPOSIT: "Security deposit",
  OVERPAYMENT_REFUND: "Refund (over-payment)",
  CANCELLATION_REFUND: "Refund (cancellation)",
};
const LISTED_STATUSES = ["COLLECTED", "CONFIRMED", "VOIDED", "REJECTED"] as const;

type Range = { start: Date; end: Date };

export interface CollectionRow {
  publicId: string;
  paidAt: Date;
  bookingPublicId: string;
  customerName: string;
  branchName: string;
  purpose: string;
  purposeLabel: string;
  direction: "IN" | "OUT";
  status: string;
  counted: boolean;
  amount: number;
  modes: ModeSplit;
  modeLabel: string;
  onlineGateway: string | null;
  reference: string | null;
  collectedBy: string;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  shift: string | null;
  voidReason: string | null;
  rejectionReason: string | null;
  notes: string | null;
}

const zeroModes = (): ModeSplit => ({ CASH: 0, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 0 });
const addModes = (a: ModeSplit, b: ModeSplit) => {
  for (const k of MODE_KEYS) a[k] = r2(a[k] + b[k]);
};

async function loadRows(f: ReportFilters, range: Range): Promise<CollectionRow[]> {
  const where: Prisma.PaymentTransactionWhereInput = {
    AND: [paymentWhereFromFilters(f, range), { status: { in: [...LISTED_STATUSES] } }],
  };
  const txns = await prisma.paymentTransaction.findMany({
    where,
    orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }],
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
      createdAt: true,
      confirmedAt: true,
      voidReason: true,
      rejectionReason: true,
      notes: true,
      booking: { select: { publicId: true, customer: { select: { user: { select: { name: true } } } } } },
      branch: { select: { name: true } },
      collectedBy: { select: { name: true } },
      confirmedBy: { select: { name: true } },
      cashShift: { select: { publicId: true } },
    },
  });
  return txns.map((t) => {
    const total = num(t.totalAmount);
    const modes = modeSplitOf({
      method: t.method,
      totalAmount: total,
      cashAmount: num(t.cashAmount),
      onlineAmount: num(t.onlineAmount),
      onlineGateway: t.onlineGateway,
    });
    const out = (REFUND_PURPOSES as string[]).includes(t.purpose);
    return {
      publicId: t.publicId,
      paidAt: t.collectedAt ?? t.createdAt,
      bookingPublicId: t.booking.publicId,
      customerName: t.booking.customer.user.name,
      branchName: t.branch.name,
      purpose: t.purpose,
      purposeLabel: PURPOSE_LABELS[t.purpose] ?? t.purpose,
      direction: out ? "OUT" : "IN",
      status: t.status,
      counted: t.status === "COLLECTED" || t.status === "CONFIRMED",
      amount: r2(total),
      modes,
      modeLabel: modeLabelOf(modes),
      onlineGateway: t.onlineGateway,
      reference: t.onlineTransactionRef,
      collectedBy: t.collectedBy?.name ?? (modes.GATEWAY > 0 ? "Online (customer)" : "Not recorded"),
      confirmedBy: t.confirmedBy?.name ?? null,
      confirmedAt: t.confirmedAt,
      shift: t.cashShift?.publicId ?? null,
      voidReason: t.voidReason,
      rejectionReason: t.rejectionReason,
      notes: t.notes,
    };
  });
}

export interface CollectionTotals {
  collected: number;
  confirmed: number;
  awaitingConfirmation: number;
  rentalCollections: number;
  securityDeposits: number;
  refundsPaidOut: number;
  net: number;
  transactions: number;
  modes: ModeSplit;
  refundModes: ModeSplit;
}

export function summariseCollections(rows: CollectionRow[]): CollectionTotals {
  const t: CollectionTotals = {
    collected: 0,
    confirmed: 0,
    awaitingConfirmation: 0,
    rentalCollections: 0,
    securityDeposits: 0,
    refundsPaidOut: 0,
    net: 0,
    transactions: 0,
    modes: zeroModes(),
    refundModes: zeroModes(),
  };
  for (const r of rows) {
    if (!r.counted) continue;
    if (r.direction === "OUT") {
      t.refundsPaidOut += r.amount;
      addModes(t.refundModes, r.modes);
      continue;
    }
    t.transactions += 1;
    t.collected += r.amount;
    if (r.status === "CONFIRMED") t.confirmed += r.amount;
    else t.awaitingConfirmation += r.amount;
    if (r.purpose === "SAFETY_DEPOSIT") t.securityDeposits += r.amount;
    else t.rentalCollections += r.amount;
    addModes(t.modes, r.modes);
  }
  t.collected = r2(t.collected);
  t.confirmed = r2(t.confirmed);
  t.awaitingConfirmation = r2(t.awaitingConfirmation);
  t.rentalCollections = r2(t.rentalCollections);
  t.securityDeposits = r2(t.securityDeposits);
  t.refundsPaidOut = r2(t.refundsPaidOut);
  t.net = r2(t.collected - t.refundsPaidOut);
  return t;
}

export interface StaffCollection {
  staff: string;
  transactions: number;
  collected: number;
  cash: number;
  online: number;
  awaitingConfirmation: number;
}

export function collectionsByStaff(rows: CollectionRow[]): StaffCollection[] {
  const m = new Map<string, StaffCollection>();
  for (const r of rows) {
    if (!r.counted || r.direction !== "IN") continue;
    const s = m.get(r.collectedBy) ?? { staff: r.collectedBy, transactions: 0, collected: 0, cash: 0, online: 0, awaitingConfirmation: 0 };
    s.transactions += 1;
    s.collected = r2(s.collected + r.amount);
    s.cash = r2(s.cash + r.modes.CASH);
    s.online = r2(s.online + r.amount - r.modes.CASH);
    if (r.status === "COLLECTED") s.awaitingConfirmation = r2(s.awaitingConfirmation + r.amount);
    m.set(r.collectedBy, s);
  }
  return [...m.values()].sort((a, b) => b.collected - a.collected);
}

export function collectionsByPurpose(rows: CollectionRow[]) {
  const m = new Map<string, { purpose: string; label: string; direction: string; transactions: number; amount: number }>();
  for (const r of rows) {
    if (!r.counted) continue;
    const e = m.get(r.purpose) ?? { purpose: r.purpose, label: r.purposeLabel, direction: r.direction, transactions: 0, amount: 0 };
    e.transactions += 1;
    e.amount = r2(e.amount + r.amount);
    m.set(r.purpose, e);
  }
  return [...m.values()];
}

async function loadDiscrepancies(f: ReportFilters, range: Range) {
  const scope: Prisma.PaymentTransactionWhereInput[] = [];
  if (f.branchPublicId) scope.push({ branch: { publicId: f.branchPublicId } });
  if (f.categoryPublicIds.length || f.vehiclePublicId) scope.push({ booking: bookingScopeFromFilters({ ...f, branchPublicId: null }) });
  const txnSelect = {
    publicId: true,
    purpose: true,
    totalAmount: true,
    voidedAt: true,
    voidReason: true,
    rejectedAt: true,
    rejectionReason: true,
    collectedAt: true,
    createdAt: true,
    booking: { select: { publicId: true } },
    collectedBy: { select: { name: true } },
    voidedBy: { select: { name: true } },
    rejectedBy: { select: { name: true } },
  } as const;
  const [pending, voided, rejected, shifts] = await Promise.all([
    // All cash / counter UPI still awaiting confirmation (any date — it's a backlog)
    prisma.paymentTransaction.findMany({
      where: { AND: [...scope, { status: "COLLECTED" }] },
      select: txnSelect,
      orderBy: { createdAt: "asc" },
    }),
    prisma.paymentTransaction.findMany({
      where: { AND: [...scope, { status: "VOIDED", voidedAt: { gte: range.start, lte: range.end } }] },
      select: txnSelect,
      orderBy: { voidedAt: "desc" },
    }),
    prisma.paymentTransaction.findMany({
      where: { AND: [...scope, { status: "REJECTED", rejectedAt: { gte: range.start, lte: range.end } }] },
      select: txnSelect,
      orderBy: { rejectedAt: "desc" },
    }),
    prisma.cashShift.findMany({
      where: {
        closedAt: { gte: range.start, lte: range.end },
        status: { in: ["CLOSED", "DISCREPANCY_FLAGGED"] },
        ...(f.branchPublicId ? { branch: { publicId: f.branchPublicId } } : {}),
      },
      orderBy: { closedAt: "desc" },
      select: {
        publicId: true,
        status: true,
        openedAt: true,
        closedAt: true,
        expectedTotal: true,
        actualTotal: true,
        discrepancy: true,
        discrepancyExplanation: true,
        employee: { select: { name: true } },
        closedBy: { select: { name: true } },
        branch: { select: { name: true } },
      },
    }),
  ]);
  const txn = (t: (typeof pending)[number]) => ({
    publicId: t.publicId,
    bookingPublicId: t.booking.publicId,
    purpose: t.purpose,
    amount: r2(num(t.totalAmount)),
    paidAt: t.collectedAt ?? t.createdAt,
    collectedBy: t.collectedBy?.name ?? null,
    voidedAt: t.voidedAt,
    voidedBy: t.voidedBy?.name ?? null,
    voidReason: t.voidReason,
    rejectedAt: t.rejectedAt,
    rejectedBy: t.rejectedBy?.name ?? null,
    rejectionReason: t.rejectionReason,
  });
  const shiftRows = shifts.map((s) => ({
    publicId: s.publicId,
    branchName: s.branch.name,
    employee: s.employee.name,
    closedBy: s.closedBy?.name ?? null,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    expected: r2(num(s.expectedTotal)),
    counted: r2(num(s.actualTotal)),
    difference: r2(num(s.discrepancy)),
    explanation: s.discrepancyExplanation,
    status: s.status,
  }));
  const sum = (xs: Array<{ amount: number }>) => r2(xs.reduce((a, x) => a + x.amount, 0));
  const pend = pending.map(txn);
  const vd = voided.map(txn);
  const rj = rejected.map(txn);
  const off = shiftRows.filter((s) => s.difference !== 0);
  return {
    awaitingConfirmation: { count: pend.length, amount: sum(pend), rows: pend },
    voided: { count: vd.length, amount: sum(vd), rows: vd },
    rejected: { count: rj.length, amount: sum(rj), rows: rj },
    cashShifts: {
      closed: shiftRows.length,
      withDifference: off.length,
      short: r2(off.filter((s) => s.difference < 0).reduce((a, s) => a + s.difference, 0)),
      over: r2(off.filter((s) => s.difference > 0).reduce((a, s) => a + s.difference, 0)),
      rows: shiftRows,
    },
  };
}

export interface CollectionsReport {
  summary: CollectionTotals;
  previous: CollectionTotals | null;
  deltas: Record<string, Delta> | null;
  byStaff: StaffCollection[];
  byPurpose: ReturnType<typeof collectionsByPurpose>;
  discrepancies: Awaited<ReturnType<typeof loadDiscrepancies>>;
  rows: CollectionRow[];
}

export async function buildCollectionsReport(f: ReportFilters, opts: { compare: boolean }): Promise<CollectionsReport> {
  const [rows, prevRows, discrepancies] = await Promise.all([
    loadRows(f, f),
    opts.compare ? loadRows(f, f.previous) : Promise.resolve(null),
    loadDiscrepancies(f, f),
  ]);
  const summary = summariseCollections(rows);
  const previous = prevRows ? summariseCollections(prevRows) : null;
  return {
    summary,
    previous,
    deltas: previous
      ? {
          collected: computeDelta(summary.collected, previous.collected),
          rentalCollections: computeDelta(summary.rentalCollections, previous.rentalCollections),
          refundsPaidOut: computeDelta(summary.refundsPaidOut, previous.refundsPaidOut),
          net: computeDelta(summary.net, previous.net),
          cash: computeDelta(summary.modes.CASH, previous.modes.CASH),
          upi: computeDelta(summary.modes.UPI, previous.modes.UPI),
          bankTransfer: computeDelta(summary.modes.BANK_TRANSFER, previous.modes.BANK_TRANSFER),
          gateway: computeDelta(summary.modes.GATEWAY, previous.modes.GATEWAY),
          transactions: computeDelta(summary.transactions, previous.transactions),
        }
      : null,
    byStaff: collectionsByStaff(rows),
    byPurpose: collectionsByPurpose(rows),
    discrepancies,
    rows,
  };
}
