/**
 * 2.5 Discounts & Refunds.
 *
 * DISCOUNTS — rentals recognised in the range (Booking.startAt, CONFIRMED /
 * PICKED_UP / RETURNED, as revenue). Every amount is the discount OFF THE RENT
 * WITHOUT GST (the basis of Booking.totalDiscount); the GST it also took off is
 * shown where the system recorded it. One line per source:
 *   Duration slab / Coupon / Manual (booking-time) — DiscountApplication layers;
 *       who: ManualDiscount.issuedBy (+ approvedBy) with its reason; coupon and
 *       slab: the booking's creator (a CUSTOMER creator = applied online).
 *       Bookings with totalDiscount but no DiscountApplication: "Booking discount
 *       (source not recorded)".
 *   Counter coupon — pricingSnapshot.counterCoupon (code, discount, GST); who = the
 *       actor of its pickup-bill ledger line.
 *   Pickup discount — pricingSnapshot.pickupDiscount (reason, appliedById).
 *   Extension discount — CONFIRMED BookingExtension.discountAmount (who: not recorded).
 *   Drop discount — non-voided DISCOUNT ledger line (referenceType DROP_DISCOUNT) on a
 *       RETURN / ADJUSTMENT session not abandoned; reason = metadata.reason, who = actor.
 *   Booking-time = totalDiscount − counter coupon − pickup discount (both are folded
 *   into totalDiscount), so the lines add up to totalDiscount + extension + drop.
 *
 * REFUNDS — money paid back by payment date (collectedAt, else createdAt):
 *   OVERPAYMENT_REFUND / CANCELLATION_REFUND rows, COLLECTED / CONFIRMED (VOIDED
 *   listed, not counted). Kind from the idempotency-key prefix: ctr: refund to
 *   customer (goodwillAmount = the part beyond what was owed back), mcr: manual
 *   cancel, sdr: deposit refund (legacy settlement), ovr: drop over-payment,
 *   pt: session bill; otherwise the purpose. Reason: the row's notes.
 *   Refund requests (RefundRequest) raised in the range are listed with status,
 *   requester and approver. Razorpay refunds are detect-only (status REFUNDED on the
 *   payment row): listed by the payment's date, refund date not recorded.
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
import { DROP_DISCOUNT_REF } from "../../damage/drop-damage.service.js";
import { readPickupDiscount } from "../../discount/pickup-discount-rules.js";
import { modeLabelOf, modeSplitOf, REVENUE_STATUSES } from "./booking-finance.js";
import { REFUND_PURPOSES } from "./collections.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  if (v == null) return 0;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : 0;
};

type Range = { start: Date; end: Date };

export const DISCOUNT_SOURCES = [
  "DURATION",
  "COUPON",
  "MANUAL",
  "BOOKING_UNSPECIFIED",
  "COUNTER_COUPON",
  "PICKUP",
  "EXTENSION",
  "DROP",
] as const;
export type DiscountSource = (typeof DISCOUNT_SOURCES)[number];
export const DISCOUNT_SOURCE_LABELS: Record<DiscountSource, string> = {
  DURATION: "Duration slab",
  COUPON: "Coupon (at booking)",
  MANUAL: "Manual discount (at booking)",
  BOOKING_UNSPECIFIED: "Booking discount (source not recorded)",
  COUNTER_COUPON: "Counter coupon (at pickup)",
  PICKUP: "Pickup discount",
  EXTENSION: "Extension discount",
  DROP: "Drop discount",
};

export interface DiscountLine {
  bookingPublicId: string;
  startAt: Date;
  branchName: string;
  customerName: string;
  source: DiscountSource;
  sourceLabel: string;
  /** off the rent without GST */
  amount: number;
  /** GST it took off too (null = not recorded separately) */
  gst: number | null;
  code: string | null;
  appliedBy: string;
  approvedBy: string | null;
  reason: string | null;
  appliedAt: Date | null;
}

/**
 * Booking-time discount layers (pure): the DiscountApplication split scaled to the
 * booking-time remainder, or one "not recorded" line when there is no split.
 */
export function bookingTimeLayers(
  bookingTime: number,
  app: { duration: number; coupon: number; manual: number } | null,
): Array<{ source: DiscountSource; amount: number }> {
  if (bookingTime <= 0.004) return [];
  if (!app) return [{ source: "BOOKING_UNSPECIFIED", amount: r2(bookingTime) }];
  const layers: Array<{ source: DiscountSource; amount: number }> = [];
  if (app.duration > 0) layers.push({ source: "DURATION", amount: r2(app.duration) });
  if (app.coupon > 0) layers.push({ source: "COUPON", amount: r2(app.coupon) });
  if (app.manual > 0) layers.push({ source: "MANUAL", amount: r2(app.manual) });
  const recorded = r2(app.duration + app.coupon + app.manual);
  const rest = r2(bookingTime - recorded);
  // The application can differ from the booking's own total (repricing) — the
  // difference is shown, never spread over the layers
  if (Math.abs(rest) >= 0.01) layers.push({ source: "BOOKING_UNSPECIFIED", amount: rest });
  return layers;
}

async function loadDiscountLines(f: ReportFilters, range: Range): Promise<DiscountLine[]> {
  const where = applyVehicleToBookingWhere(
    buildBookingWhere({
      branchPublicId: f.branchPublicId,
      categoryPublicIds: f.categoryPublicIds,
      from: range.start,
      to: range.end,
      statuses: REVENUE_STATUSES,
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
      createdAt: true,
      totalDiscount: true,
      couponCode: true,
      pricingSnapshot: true,
      branch: { select: { name: true } },
      customer: { select: { user: { select: { name: true } } } },
      createdBy: { select: { name: true, role: true } },
      discountRule: { select: { name: true, code: true } },
      discountApplication: {
        select: {
          durationDiscountAmount: true,
          couponDiscountAmount: true,
          manualDiscountAmount: true,
          createdAt: true,
          discountRule: { select: { name: true, code: true } },
        },
      },
      manualDiscount: {
        select: {
          reason: true,
          status: true,
          createdAt: true,
          issuedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
        },
      },
      extensions: {
        where: { extensionStatus: "CONFIRMED", discountAmount: { gt: 0 } },
        select: { discountAmount: true, createdAt: true },
      },
    },
  });
  const ids = bookings.map((b) => b.id);
  const [dropLines, couponActors] = await Promise.all([
    ids.length
      ? prisma.ledgerEntry.findMany({
          where: {
            bookingId: { in: ids },
            isVoided: false,
            entryType: "DISCOUNT",
            referenceType: DROP_DISCOUNT_REF,
            session: { status: { not: "ABANDONED" }, sessionType: { in: ["RETURN", "ADJUSTMENT"] } },
          },
          select: { bookingId: true, amount: true, gstAmount: true, metadata: true, createdAt: true, actor: { select: { name: true } } },
        })
      : Promise.resolve([]),
    (async () => {
      const keys = bookings
        .map((b) => (b.pricingSnapshot as { counterCoupon?: { ledgerEntryPublicId?: string } } | null)?.counterCoupon?.ledgerEntryPublicId)
        .filter((k): k is string => typeof k === "string");
      if (!keys.length) return new Map<string, string>();
      const rows = await prisma.ledgerEntry.findMany({
        where: { publicId: { in: keys } },
        select: { publicId: true, actor: { select: { name: true } } },
      });
      return new Map(rows.map((r) => [r.publicId, r.actor.name]));
    })(),
  ]);
  const pickupActorIds = [
    ...new Set(
      bookings
        .map((b) => readPickupDiscount(b.pricingSnapshot)?.appliedById)
        .filter((x): x is number => typeof x === "number"),
    ),
  ];
  const pickupActors = new Map(
    (pickupActorIds.length
      ? await prisma.user.findMany({ where: { id: { in: pickupActorIds } }, select: { id: true, name: true } })
      : []
    ).map((u) => [u.id, u.name]),
  );
  const dropBy = new Map<number, typeof dropLines>();
  for (const l of dropLines) {
    const arr = dropBy.get(l.bookingId) ?? [];
    arr.push(l);
    dropBy.set(l.bookingId, arr);
  }

  const lines: DiscountLine[] = [];
  for (const b of bookings) {
    const base = {
      bookingPublicId: b.publicId,
      startAt: b.startAt,
      branchName: b.branch.name,
      customerName: b.customer.user.name,
    };
    const snap = (b.pricingSnapshot ?? {}) as { counterCoupon?: Record<string, unknown> };
    const cc = snap.counterCoupon;
    const ccDiscount = cc ? num(cc.discount) : 0;
    const pickup = readPickupDiscount(b.pricingSnapshot);
    const pickupDiscount = pickup ? num(pickup.discount) : 0;
    const bookingTime = r2(num(b.totalDiscount) - ccDiscount - pickupDiscount);
    const creatorIsCustomer = b.createdBy.role === "CUSTOMER";
    const creator = creatorIsCustomer ? "Customer (online)" : b.createdBy.name;
    const app = b.discountApplication;
    const layers = bookingTimeLayers(
      bookingTime,
      app ? { duration: num(app.durationDiscountAmount), coupon: num(app.couponDiscountAmount), manual: num(app.manualDiscountAmount) } : null,
    );
    for (const l of layers) {
      const rule = app?.discountRule ?? b.discountRule;
      const md = b.manualDiscount;
      lines.push({
        ...base,
        source: l.source,
        sourceLabel: DISCOUNT_SOURCE_LABELS[l.source],
        amount: l.amount,
        gst: null,
        code: l.source === "COUPON" ? (rule?.code ?? b.couponCode ?? null) : null,
        appliedBy: l.source === "MANUAL" ? (md?.issuedBy.name ?? "Not recorded") : l.source === "BOOKING_UNSPECIFIED" ? "Not recorded" : creator,
        approvedBy: l.source === "MANUAL" ? (md?.approvedBy?.name ?? null) : null,
        reason:
          l.source === "MANUAL"
            ? (md?.reason ?? null)
            : l.source === "COUPON"
              ? (rule?.name ?? null)
              : null,
        appliedAt: l.source === "MANUAL" ? (md?.createdAt ?? null) : (app?.createdAt ?? b.createdAt),
      });
    }
    if (cc && ccDiscount > 0) {
      const key = typeof cc.ledgerEntryPublicId === "string" ? cc.ledgerEntryPublicId : null;
      lines.push({
        ...base,
        source: "COUNTER_COUPON",
        sourceLabel: DISCOUNT_SOURCE_LABELS.COUNTER_COUPON,
        amount: r2(ccDiscount),
        gst: r2(num(cc.gst)),
        code: typeof cc.couponCode === "string" ? cc.couponCode : null,
        appliedBy: (key && couponActors.get(key)) || "Not recorded",
        approvedBy: null,
        reason: null,
        appliedAt: typeof cc.appliedAt === "string" ? new Date(cc.appliedAt) : null,
      });
    }
    if (pickup && pickupDiscount > 0) {
      lines.push({
        ...base,
        source: "PICKUP",
        sourceLabel: DISCOUNT_SOURCE_LABELS.PICKUP,
        amount: r2(pickupDiscount),
        gst: r2(num(pickup.gst)),
        code: null,
        appliedBy: (typeof pickup.appliedById === "number" && pickupActors.get(pickup.appliedById)) || "Not recorded",
        approvedBy: null,
        reason: pickup.reason ?? null,
        appliedAt: pickup.appliedAt ? new Date(pickup.appliedAt) : null,
      });
    }
    for (const e of b.extensions) {
      lines.push({
        ...base,
        source: "EXTENSION",
        sourceLabel: DISCOUNT_SOURCE_LABELS.EXTENSION,
        amount: r2(num(e.discountAmount)),
        gst: null,
        code: null,
        appliedBy: "Not recorded",
        approvedBy: null,
        reason: null,
        appliedAt: e.createdAt,
      });
    }
    for (const d of dropBy.get(b.id) ?? []) {
      const gross = Math.abs(num(d.amount));
      const gst = Math.abs(num(d.gstAmount));
      const meta = (d.metadata ?? {}) as { reason?: unknown };
      lines.push({
        ...base,
        source: "DROP",
        sourceLabel: DISCOUNT_SOURCE_LABELS.DROP,
        // an edit's correction line keeps its sign (amount < 0 = discount lowered)
        amount: r2((num(d.amount) <= 0 ? 1 : -1) * (gross - gst)),
        gst: r2((num(d.amount) <= 0 ? 1 : -1) * gst),
        code: null,
        appliedBy: d.actor.name,
        approvedBy: null,
        reason: typeof meta.reason === "string" ? meta.reason : null,
        appliedAt: d.createdAt,
      });
    }
  }
  return lines;
}

export interface DiscountTotals {
  total: number;
  gstRecorded: number;
  lines: number;
  bookings: number;
  bySource: Array<{ source: DiscountSource; label: string; amount: number; lines: number }>;
}

export function sumDiscounts(lines: DiscountLine[]): DiscountTotals {
  const by = new Map<DiscountSource, { amount: number; lines: number }>();
  let total = 0;
  let gst = 0;
  for (const l of lines) {
    total += l.amount;
    gst += l.gst ?? 0;
    const e = by.get(l.source) ?? { amount: 0, lines: 0 };
    e.amount += l.amount;
    e.lines += 1;
    by.set(l.source, e);
  }
  return {
    total: r2(total),
    gstRecorded: r2(gst),
    lines: lines.length,
    bookings: new Set(lines.map((l) => l.bookingPublicId)).size,
    bySource: DISCOUNT_SOURCES.filter((s) => by.has(s)).map((s) => ({
      source: s,
      label: DISCOUNT_SOURCE_LABELS[s],
      amount: r2(by.get(s)!.amount),
      lines: by.get(s)!.lines,
    })),
  };
}

// ── Refunds ───────────────────────────────────────────────────────────────────

export type RefundKind = "CUSTOMER_REFUND" | "MANUAL_CANCEL" | "DEPOSIT_LEGACY" | "DROP_OVERPAYMENT" | "SESSION" | "CANCELLATION" | "OVERPAYMENT";
export const REFUND_KIND_LABELS: Record<RefundKind, string> = {
  CUSTOMER_REFUND: "Refund to customer",
  MANUAL_CANCEL: "Manual cancel refund",
  DEPOSIT_LEGACY: "Deposit refund (settlement)",
  DROP_OVERPAYMENT: "Over-payment refund (drop)",
  SESSION: "Refund on a bill",
  CANCELLATION: "Cancellation refund",
  OVERPAYMENT: "Over-payment refund",
};

export function refundKindOf(idempotencyKey: string, purpose: string): RefundKind {
  if (idempotencyKey.startsWith("ctr:")) return "CUSTOMER_REFUND";
  if (idempotencyKey.startsWith("mcr:")) return "MANUAL_CANCEL";
  if (idempotencyKey.startsWith("sdr:")) return "DEPOSIT_LEGACY";
  if (idempotencyKey.startsWith("ovr:")) return "DROP_OVERPAYMENT";
  if (idempotencyKey.startsWith("pt:")) return "SESSION";
  return purpose === PaymentPurpose.CANCELLATION_REFUND ? "CANCELLATION" : "OVERPAYMENT";
}

export interface RefundRow {
  publicId: string;
  paidAt: Date;
  bookingPublicId: string;
  bookingStatus: string;
  customerName: string;
  branchName: string;
  purpose: string;
  kind: RefundKind;
  kindLabel: string;
  status: string;
  counted: boolean;
  amount: number;
  goodwill: number;
  mode: string;
  reference: string | null;
  proof: boolean;
  paidBy: string;
  reason: string | null;
  voidReason: string | null;
}

async function loadRefundRows(f: ReportFilters, range: Range): Promise<RefundRow[]> {
  const txns = await prisma.paymentTransaction.findMany({
    where: { AND: [paymentWhereFromFilters(f, range), { purpose: { in: REFUND_PURPOSES }, status: { in: ["COLLECTED", "CONFIRMED", "VOIDED"] } }] },
    orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }],
    select: {
      publicId: true,
      idempotencyKey: true,
      purpose: true,
      status: true,
      method: true,
      totalAmount: true,
      cashAmount: true,
      onlineAmount: true,
      onlineGateway: true,
      onlineTransactionRef: true,
      goodwillAmount: true,
      proofFileId: true,
      collectedAt: true,
      createdAt: true,
      notes: true,
      voidReason: true,
      booking: { select: { publicId: true, status: true, customer: { select: { user: { select: { name: true } } } } } },
      branch: { select: { name: true } },
      collectedBy: { select: { name: true } },
    },
  });
  return txns.map((t) => {
    const kind = refundKindOf(t.idempotencyKey, t.purpose);
    const modes = modeSplitOf({
      method: t.method,
      totalAmount: num(t.totalAmount),
      cashAmount: num(t.cashAmount),
      onlineAmount: num(t.onlineAmount),
      onlineGateway: t.onlineGateway,
    });
    return {
      publicId: t.publicId,
      paidAt: t.collectedAt ?? t.createdAt,
      bookingPublicId: t.booking.publicId,
      bookingStatus: t.booking.status,
      customerName: t.booking.customer.user.name,
      branchName: t.branch.name,
      purpose: t.purpose,
      kind,
      kindLabel: REFUND_KIND_LABELS[kind],
      status: t.status,
      counted: t.status !== "VOIDED",
      amount: r2(num(t.totalAmount)),
      goodwill: r2(num(t.goodwillAmount)),
      mode: modeLabelOf(modes),
      reference: t.onlineTransactionRef,
      proof: t.proofFileId != null,
      paidBy: t.collectedBy?.name ?? "Not recorded",
      reason: t.notes,
      voidReason: t.voidReason,
    };
  });
}

export interface RefundTotals {
  paidOut: number;
  count: number;
  goodwill: number;
  cancellation: number;
  voided: number;
  byKind: Array<{ kind: RefundKind; label: string; amount: number; count: number }>;
}

export function sumRefunds(rows: RefundRow[]): RefundTotals {
  const by = new Map<RefundKind, { amount: number; count: number }>();
  let paidOut = 0;
  let goodwill = 0;
  let cancellation = 0;
  let voided = 0;
  let count = 0;
  for (const r of rows) {
    if (!r.counted) {
      voided += r.amount;
      continue;
    }
    count += 1;
    paidOut += r.amount;
    goodwill += r.goodwill;
    if (r.purpose === PaymentPurpose.CANCELLATION_REFUND) cancellation += r.amount;
    const e = by.get(r.kind) ?? { amount: 0, count: 0 };
    e.amount += r.amount;
    e.count += 1;
    by.set(r.kind, e);
  }
  return {
    paidOut: r2(paidOut),
    count,
    goodwill: r2(goodwill),
    cancellation: r2(cancellation),
    voided: r2(voided),
    byKind: [...by.entries()].map(([kind, e]) => ({ kind, label: REFUND_KIND_LABELS[kind], amount: r2(e.amount), count: e.count })),
  };
}

async function loadRefundRequests(f: ReportFilters, range: Range) {
  const where: Prisma.RefundRequestWhereInput = {
    createdAt: { gte: range.start, lte: range.end },
    ...(f.branchPublicId ? { branch: { publicId: f.branchPublicId } } : {}),
    ...(f.categoryPublicIds.length || f.vehiclePublicId ? { booking: bookingScopeFromFilters({ ...f, branchPublicId: null }) } : {}),
  };
  const rows = await prisma.refundRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      publicId: true,
      amount: true,
      reason: true,
      method: true,
      status: true,
      createdAt: true,
      approvedAt: true,
      completedAt: true,
      rejectionReason: true,
      booking: { select: { publicId: true } },
      requestedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      completedBy: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    publicId: r.publicId,
    bookingPublicId: r.booking.publicId,
    amount: r2(num(r.amount)),
    reason: r.reason,
    method: r.method,
    status: r.status,
    requestedAt: r.createdAt,
    requestedBy: r.requestedBy.name,
    approvedBy: r.approvedBy?.name ?? null,
    approvedAt: r.approvedAt,
    completedBy: r.completedBy?.name ?? null,
    completedAt: r.completedAt,
    rejectionReason: r.rejectionReason,
  }));
}

async function loadGatewayRefunds(f: ReportFilters, range: Range) {
  const rows = await prisma.paymentTransaction.findMany({
    where: { AND: [paymentWhereFromFilters(f, range), { status: "REFUNDED" }] },
    select: { publicId: true, totalAmount: true, purpose: true, collectedAt: true, createdAt: true, booking: { select: { publicId: true } } },
  });
  return rows.map((r) => ({
    publicId: r.publicId,
    bookingPublicId: r.booking.publicId,
    purpose: r.purpose,
    amount: r2(num(r.totalAmount)),
    paidAt: r.collectedAt ?? r.createdAt,
  }));
}

export interface DiscountsRefundsReport {
  discounts: DiscountTotals;
  previousDiscounts: DiscountTotals | null;
  refunds: RefundTotals;
  previousRefunds: RefundTotals | null;
  deltas: Record<string, Delta> | null;
  discountLines: DiscountLine[];
  refundRows: RefundRow[];
  refundRequests: Awaited<ReturnType<typeof loadRefundRequests>>;
  gatewayRefunds: Awaited<ReturnType<typeof loadGatewayRefunds>>;
}

export async function buildDiscountsRefundsReport(f: ReportFilters, opts: { compare: boolean }): Promise<DiscountsRefundsReport> {
  const [lines, prevLines, refunds, prevRefunds, requests, gateway] = await Promise.all([
    loadDiscountLines(f, f),
    opts.compare ? loadDiscountLines(f, f.previous) : Promise.resolve(null),
    loadRefundRows(f, f),
    opts.compare ? loadRefundRows(f, f.previous) : Promise.resolve(null),
    loadRefundRequests(f, f),
    loadGatewayRefunds(f, f),
  ]);
  const discounts = sumDiscounts(lines);
  const previousDiscounts = prevLines ? sumDiscounts(prevLines) : null;
  const refundTotals = sumRefunds(refunds);
  const previousRefunds = prevRefunds ? sumRefunds(prevRefunds) : null;
  return {
    discounts,
    previousDiscounts,
    refunds: refundTotals,
    previousRefunds,
    deltas:
      previousDiscounts && previousRefunds
        ? {
            discounts: computeDelta(discounts.total, previousDiscounts.total),
            refunds: computeDelta(refundTotals.paidOut, previousRefunds.paidOut),
            cancellationRefunds: computeDelta(refundTotals.cancellation, previousRefunds.cancellation),
          }
        : null,
    discountLines: lines,
    refundRows: refunds,
    refundRequests: requests,
    gatewayRefunds: gateway,
  };
}
