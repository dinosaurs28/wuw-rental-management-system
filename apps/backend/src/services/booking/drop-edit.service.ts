/**
 * Full edit of a completed drop (client item 1: "Full Pickup and Drop Flow
 * should be editable") — what the drop recorded, and its bill worked out again
 * with edited inputs.
 *
 * Two flows, as at the drop itself:
 *  - DROP_BILL (Unified Payments): the completed RETURN session's lines, plus the
 *    delta lines of earlier edits (ADJUSTMENT sessions). The difference is
 *    settled at the counter on a new ADJUSTMENT session.
 *  - LEGACY: the return-charge ChargeEntry rows the branch manager collects in
 *    Settlements; an edit rewrites them with the same helpers the drop used, and
 *    the manager settles the difference.
 *
 * Only categories whose inputs changed are worked out again (km, late return,
 * fuel, FASTag, other charges, each drop damage, discount); every other line
 * keeps the amount it was billed, so rate or pricing changes since the drop
 * never move money. Km uses the free km and rate the drop billed with, a late
 * return the late policy it billed with, and a line worked out again keeps the
 * GST treatment its billed line had (bills from before item 8 taxed drop
 * charges). The drop discount is never left above the charges.
 */
import Decimal from "decimal.js";
import {
  prisma,
  Prisma,
  ChargeType,
  LedgerEntryClassification,
  LedgerEntryType,
  PaymentSessionStatus,
  PaymentSessionType,
} from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import type { TxClient } from "../payment/paymentSession.service.js";
import {
  getOdometerSegments,
  resolveKmAllowance,
  type OdometerSegments,
} from "../charges/km-allowance.service.js";
import {
  calculateLateReturnCharge,
  lateReturnLabel,
  resolveLateReturnPolicy,
  serializeLateReturn,
} from "../charges/late-return.service.js";
import { calculateFastagUsage, serializeFastagUsage } from "../charges/fastag-usage.js";
import { getFastagLegs } from "../charges/fastag-usage.service.js";
import {
  buildDropBill,
  serializeDropBill,
  LATE_RETURN_REF,
  OTHER_CHARGE_REF,
  type DropChargeLine,
} from "../charges/drop-bill.service.js";
import {
  DROP_DAMAGE_REF,
  DROP_DISCOUNT_REF,
  dropDamageAmount,
  isDropDamage,
} from "../damage/drop-damage.service.js";
import {
  LEGACY_EXTRA_KM_KEY,
  LEGACY_EXTRA_TIME_KEY,
  LEGACY_FASTAG_KEY,
  LEGACY_RETURN_CHARGE_TYPES,
  chargeEntryGst,
  removeLegacyReturnCharge,
  upsertLegacyReturnCharge,
} from "../charges/legacy-return-charges.service.js";
import { readDepositHandling, type SafetyDepositHandling } from "../payment/safety-deposit.service.js";
import type { LineGst } from "../tax/gst.service.js";
import {
  billedKmAllowance,
  billedKmCharge,
  endOdometerProblem,
  withPickupOdometer,
  type BilledKmAllowance,
} from "./operation-edit-guard.js";
import {
  billedLatePolicy,
  capDropDiscount,
  diffAdjustmentLines,
  keepUnchangedLines,
  withStoredTax,
  type AdjustmentLine,
} from "./operation-adjustment.js";

const ZERO = new Decimal(0);

export type DropFlow = "DROP_BILL" | "LEGACY";

/** Everything the drop workflow captured that bears on its bill. */
export interface DropEditInputs {
  endOdometer: number | null;
  /** Extra km typed after a swap recorded without readings */
  manualExtraKm: number | null;
  returnFuelLevel: string | null;
  returnFastagBalance: Decimal | null;
  /** Fuel line on the drop bill (typed / prefilled from the bars short); 0 = none */
  fuelCharge: Decimal;
  /** Typed FASTag charge (when the readings can't measure the usage); 0 = none */
  fastagAmount: Decimal;
  fastagNotes: string | null;
  otherCharges: Array<{ label: string; amount: Decimal }>;
  discount: { amount: Decimal; reason: string } | null;
  /** "Apply grace" (MANUAL grace branches) */
  applyGrace: boolean;
  /** Late charge waived with this reason; null = not waived */
  waiveReason: string | null;
  depositHandling: SafetyDepositHandling;
  /** Drop damage (charged at drop) publicId → amount */
  damageAmounts: Record<string, Decimal>;
}

/** A refusal while working the bill out (sent to the client as-is). */
export class DropEditError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
    this.name = "DropEditError";
  }
}

export interface DropEditState {
  flow: DropFlow;
  inputs: DropEditInputs;
  /** The drop bill as charged now: the original plus earlier edits */
  billedLines: AdjustmentLine[];
  /** The completed RETURN session's metadata (DROP_BILL), else null */
  billMeta: Record<string, any> | null;
  returnedAt: Date | null;
  endAt: Date;
  /** The late-return policy the drop billed with (rate, grace) — null when it recorded none */
  billedLate: Parameters<typeof billedLatePolicy>[1];
  /** Drop damages charged on this drop: publicId → { label, editable } */
  damages: Array<{ publicId: string; label: string; amount: Decimal; editable: boolean }>;
}

const dec = (v: { toString(): string } | number | string | null | undefined) =>
  v == null ? null : new Decimal(v.toString());

/** Ledger entry types that are drop-bill charges (not money, rent or deposit). */
const MONEY_TYPES = new Set(["PAYMENT", "REFUND", "CREDIT", "DEPOSIT", "BOOKING_BASE", "EXTENSION"]);

/** Legacy ChargeEntry type → the ledger type its line compares as. */
const LEGACY_LINE_TYPE: Record<string, string> = {
  [ChargeType.EXTRA_KM]: "EXTRA_KM",
  [ChargeType.EXTRA_TIME]: "EXTRA_TIME",
  [ChargeType.FASTAG]: "FASTAG",
  [ChargeType.VEHICLE_SWAP]: "VEHICLE_SWAP",
  [ChargeType.FUEL_DEFICIT]: "FUEL",
};

/** The category of a line: one input (or input group) decides it. */
export function dropLineCategory(line: Pick<AdjustmentLine, "entryType" | "referenceType" | "referenceId">): string {
  switch (line.entryType) {
    case "EXTRA_KM":
      return "KM";
    case "EXTRA_TIME":
      return "LATE";
    case "FUEL":
      return "FUEL";
    case "FASTAG":
      return "FASTAG";
    case "VEHICLE_SWAP":
      return "SWAP";
    case "DISCOUNT":
      return "DISCOUNT";
    case "DAMAGE":
      return line.referenceType === DROP_DAMAGE_REF ? `DAMAGE:${line.referenceId ?? ""}` : "OTHER";
    default:
      return line.entryType;
  }
}

/** Categories whose inputs differ between what the drop recorded and the edit. */
export function changedDropCategories(
  before: DropEditInputs,
  after: DropEditInputs,
  cross: { pickupOdometerChanged?: boolean; pickupFastagChanged?: boolean } = {},
): Set<string> {
  const changed = new Set<string>();
  const eqDec = (a: Decimal | null, b: Decimal | null) => (a == null || b == null ? a === b : a.eq(b));
  if (before.endOdometer !== after.endOdometer || before.manualExtraKm !== after.manualExtraKm || cross.pickupOdometerChanged) {
    changed.add("KM");
  }
  if (before.applyGrace !== after.applyGrace || (before.waiveReason != null) !== (after.waiveReason != null)) {
    changed.add("LATE");
  }
  if (!before.fuelCharge.eq(after.fuelCharge)) changed.add("FUEL");
  if (
    !eqDec(before.returnFastagBalance, after.returnFastagBalance) ||
    !before.fastagAmount.eq(after.fastagAmount) ||
    (before.fastagNotes ?? "") !== (after.fastagNotes ?? "") ||
    cross.pickupFastagChanged
  ) {
    changed.add("FASTAG");
  }
  const others = (list: DropEditInputs["otherCharges"]) =>
    JSON.stringify(list.map((o) => [o.label.trim(), o.amount.toFixed(2)]));
  if (others(before.otherCharges) !== others(after.otherCharges)) changed.add("OTHER");
  const damageIds = new Set([...Object.keys(before.damageAmounts), ...Object.keys(after.damageAmounts)]);
  for (const id of damageIds) {
    if (!eqDec(before.damageAmounts[id] ?? null, after.damageAmounts[id] ?? null)) changed.add(`DAMAGE:${id}`);
  }
  const disc = (d: DropEditInputs["discount"]) => (d ? `${d.amount.toFixed(2)}|${d.reason.trim()}` : "");
  if (disc(before.discount) !== disc(after.discount)) changed.add("DISCOUNT");
  return changed;
}

// ── Stored edit inputs (Booking.pricingSnapshot.editedDropInputs) ────────────

/** JSON of the drop inputs as the latest edit left them. */
export function serializeDropInputs(i: DropEditInputs) {
  return {
    endOdometer: i.endOdometer,
    manualExtraKm: i.manualExtraKm,
    returnFuelLevel: i.returnFuelLevel,
    returnFastagBalance: i.returnFastagBalance?.toFixed(2) ?? null,
    fuelCharge: i.fuelCharge.toFixed(2),
    fastagAmount: i.fastagAmount.toFixed(2),
    fastagNotes: i.fastagNotes,
    otherCharges: i.otherCharges.map((o) => ({ label: o.label, amount: o.amount.toFixed(2) })),
    discount: i.discount ? { amount: i.discount.amount.toFixed(2), reason: i.discount.reason } : null,
    applyGrace: i.applyGrace,
    waiveReason: i.waiveReason,
    depositHandling: i.depositHandling,
    damageAmounts: Object.fromEntries(Object.entries(i.damageAmounts).map(([k, v]) => [k, v.toFixed(2)])),
  };
}

export type SerializedDropInputs = ReturnType<typeof serializeDropInputs>;

function parseStoredInputs(raw: unknown): Partial<DropEditInputs> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SerializedDropInputs>;
  const out: Partial<DropEditInputs> = {};
  if ("manualExtraKm" in r) out.manualExtraKm = r.manualExtraKm ?? null;
  if (r.fuelCharge != null) out.fuelCharge = new Decimal(r.fuelCharge);
  if (r.fastagAmount != null) out.fastagAmount = new Decimal(r.fastagAmount);
  if ("fastagNotes" in r) out.fastagNotes = r.fastagNotes ?? null;
  if (Array.isArray(r.otherCharges)) {
    out.otherCharges = r.otherCharges.map((o) => ({ label: String(o.label), amount: new Decimal(o.amount) }));
  }
  if ("discount" in r) {
    out.discount = r.discount ? { amount: new Decimal(r.discount.amount), reason: String(r.discount.reason) } : null;
  }
  if (typeof r.applyGrace === "boolean") out.applyGrace = r.applyGrace;
  if ("waiveReason" in r) out.waiveReason = r.waiveReason ?? null;
  if (r.depositHandling === "SET_OFF" || r.depositHandling === "REFUND_IN_FULL") out.depositHandling = r.depositHandling;
  return out;
}

// ── What the drop recorded ───────────────────────────────────────────────────

/** Booking fields the edit state is read from. */
const stateBookingSelect = {
  id: true,
  endAt: true,
  returnedAt: true,
  endOdometer: true,
  returnFastagBalance: true,
  pricingSnapshot: true,
  fuelRecord: { select: { returnFuelLevel: true } },
} satisfies Prisma.BookingSelect;

/**
 * What the completed drop recorded — its inputs as the latest edit left them —
 * and its bill as charged now.
 */
export async function loadDropEditState(bookingId: number, tx?: TxClient): Promise<DropEditState> {
  const db = tx ?? prisma;
  const [booking, returnSession, adjustments, damageRows] = await Promise.all([
    db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: stateBookingSelect }),
    db.paymentSession.findFirst({
      where: { bookingId, sessionType: PaymentSessionType.RETURN, status: PaymentSessionStatus.COMPLETED },
      orderBy: { completedAt: "desc" },
      select: { metadata: true, entries: { where: { isVoided: false } } },
    }),
    db.paymentSession.findMany({
      where: { bookingId, sessionType: PaymentSessionType.ADJUSTMENT, status: { not: PaymentSessionStatus.ABANDONED } },
      orderBy: { createdAt: "asc" },
      select: { entries: { where: { isVoided: false } } },
    }),
    db.damageReport.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
      select: { publicId: true, severity: true, notes: true, status: true, chargedAtDrop: true, finalCost: true, estimatedCost: true },
    }),
  ]);

  const dropDamages = damageRows.filter((d) => isDropDamage(d.notes) && d.chargedAtDrop);
  const damages = dropDamages.map((d) => {
    const notes = (d.notes ?? {}) as Record<string, unknown>;
    return {
      publicId: d.publicId,
      label: `Damage: ${String(notes.area ?? "Vehicle")} (${d.severity})`,
      amount: dropDamageAmount(d),
      // Once the manager reviewed it, only they change it
      editable: d.status === "PENDING",
    };
  });
  const snapshot = (booking.pricingSnapshot ?? {}) as Record<string, unknown>;
  const stored = parseStoredInputs(snapshot.editedDropInputs);
  const base = {
    endOdometer: booking.endOdometer,
    returnFuelLevel: booking.fuelRecord?.returnFuelLevel ?? null,
    returnFastagBalance: dec(booking.returnFastagBalance),
    damageAmounts: Object.fromEntries(damages.map((d) => [d.publicId, d.amount])),
  };

  if (returnSession) {
    const meta = (returnSession.metadata ?? {}) as Record<string, any>;
    const entries = returnSession.entries;
    const typedFastag = entries.filter(
      (e) => e.entryType === LedgerEntryType.FASTAG && (e.metadata as any)?.source !== "FASTAG_READINGS",
    );
    const fastagLabel = typedFastag[0]?.description ?? "";
    const recorded: DropEditInputs = {
      ...base,
      manualExtraKm: typeof meta.km?.manualExtraKm === "number" ? meta.km.manualExtraKm : null,
      fuelCharge: sumAmounts(entries.filter((e) => e.entryType === LedgerEntryType.FUEL)),
      fastagAmount: sumAmounts(typedFastag),
      fastagNotes: fastagLabel.startsWith("FASTag: ") ? fastagLabel.slice("FASTag: ".length) : null,
      otherCharges: entries
        .filter((e) => e.referenceType === OTHER_CHARGE_REF)
        .map((e) => ({ label: e.description, amount: new Decimal(e.amount.toString()) })),
      discount: meta.discount ? { amount: new Decimal(meta.discount.amount), reason: String(meta.discount.reason) } : null,
      applyGrace: meta.applyGrace === true,
      waiveReason: meta.late?.waived ? meta.late.waiverReason ?? "" : null,
      depositHandling: meta.deposit?.handling === "REFUND_IN_FULL" ? "REFUND_IN_FULL" : "SET_OFF",
    };
    const billedLines = [...entries, ...adjustments.flatMap((a) => a.entries)]
      .filter((e) => !MONEY_TYPES.has(String(e.entryType)))
      .filter((e) => (e.metadata as any)?.part !== "PICKUP")
      .map((e) => ledgerLine(e));
    return {
      flow: "DROP_BILL",
      inputs: { ...recorded, ...(stored ?? {}), ...base },
      billedLines,
      billMeta: meta,
      returnedAt: meta.returnedAt ? new Date(meta.returnedAt) : booking.returnedAt,
      endAt: booking.endAt,
      billedLate: meta.late ?? null,
      damages,
    };
  }

  // Legacy drop: its return-charge rows and what it recorded on them
  const rows = await db.chargeEntry.findMany({
    where: { bookingId, chargeType: { in: LEGACY_RETURN_CHARGE_TYPES } },
    select: { chargeType: true, moduleKey: true, label: true, finalAmount: true, quantity: true, unitRate: true, notes: true, gstAmount: true, cgstAmount: true, sgstAmount: true, taxRate: true },
  });
  const details = (moduleKey: string) => {
    const row = rows.find((r) => r.moduleKey === moduleKey);
    try {
      return row?.notes?.startsWith("{") ? (JSON.parse(row.notes) as Record<string, any>) : null;
    } catch {
      return null;
    }
  };
  const kmDetails = details(LEGACY_EXTRA_KM_KEY);
  const lateDetails = details(LEGACY_EXTRA_TIME_KEY);
  const lateRow = rows.find((r) => r.moduleKey === LEGACY_EXTRA_TIME_KEY);
  const waiver = await db.auditLog.findFirst({
    where: { entity: "Booking", entityId: { in: await bookingRefs(bookingId, db) }, action: "RETURN_LATE_CHARGE_WAIVED" },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  const recorded: DropEditInputs = {
    ...base,
    manualExtraKm:
      kmDetails?.kmSource === "STAFF_ENTERED"
        ? Number(rows.find((r) => r.moduleKey === LEGACY_EXTRA_KM_KEY)?.quantity ?? 0)
        : null,
    fuelCharge: ZERO,
    fastagAmount: ZERO,
    fastagNotes: null,
    otherCharges: [],
    discount: null,
    applyGrace: lateDetails?.graceApplied === true,
    waiveReason: waiver ? String((waiver.metadata as any)?.late?.waiverReason ?? "") : null,
    depositHandling: readDepositHandling(booking.pricingSnapshot)?.mode ?? "SET_OFF",
  };
  return {
    flow: "LEGACY",
    inputs: { ...recorded, ...(stored ?? {}), ...base, fuelCharge: ZERO, otherCharges: [], discount: null, fastagAmount: ZERO },
    billedLines: rows.map((r) => {
      // A row frozen with GST before item 8 keeps it
      const gst = chargeEntryGst(r)?.gst ?? ZERO;
      return {
        part: "DROP" as const,
        entryType: LEGACY_LINE_TYPE[r.chargeType] ?? String(r.chargeType),
        classification: gst.gt(0) ? "TAXABLE" : "NON_TAXABLE",
        referenceType: r.moduleKey,
        referenceId: null,
        label: r.label,
        amount: new Decimal(r.finalAmount.toString()).plus(gst),
        ...(gst.gt(0) && { gst }),
      };
    }),
    billMeta: null,
    returnedAt: booking.returnedAt,
    endAt: booking.endAt,
    // The rate it billed at, and the policy an earlier edit recorded on the row
    billedLate: lateRow
      ? { ...(lateDetails ?? {}), rate: lateDetails?.rate ?? (lateRow.unitRate != null ? lateRow.unitRate.toString() : null) }
      : null,
    damages: [],
  };
}

async function bookingRefs(bookingId: number, db: TxClient): Promise<string[]> {
  const b = await db.booking.findUnique({ where: { id: bookingId }, select: { publicId: true } });
  return b ? [b.publicId] : [];
}

function sumAmounts(entries: Array<{ amount: { toString(): string } }>): Decimal {
  return entries.reduce((s, e) => s.plus(e.amount.toString()), ZERO);
}

function ledgerLine(e: {
  entryType: string;
  classification: string;
  referenceType: string | null;
  referenceId: string | null;
  description: string;
  amount: { toString(): string };
  gstAmount: { toString(): string };
  baseAmount?: { toString(): string } | null;
}): AdjustmentLine {
  const amount = new Decimal(e.amount.toString());
  const gst = new Decimal(e.gstAmount.toString());
  const line: AdjustmentLine = {
    part: "DROP",
    entryType: String(e.entryType),
    classification: String(e.classification),
    referenceType: e.referenceType,
    referenceId: e.referenceId,
    label: e.description,
    amount,
  };
  // A taxable line's GST sits on top of its amount (bills from before item 8)
  if (e.classification === LedgerEntryClassification.TAXABLE) {
    return { ...line, amount: amount.plus(gst), ...(!gst.isZero() && { gst }) };
  }
  // A discount of such a bill: its amount is the whole effect, with the GST it reversed and its taxable share
  if (e.classification === LedgerEntryClassification.DISCOUNT) {
    const base = e.baseAmount != null ? new Decimal(e.baseAmount.toString()) : ZERO;
    return { ...line, ...(!gst.isZero() && { gst }), ...(!base.isZero() && { base }) };
  }
  return line;
}

// ── The bill with the edited inputs ──────────────────────────────────────────

export interface DropEditOverrides {
  /** Corrected pickup odometer (Edit Pickup's cross-effect / preview) */
  pickupOdometer?: number | null;
  /** Corrected pickup FASTag balance */
  pickupFastagBalance?: Decimal | null;
  /**
   * Categories worked out again whatever the inputs say: those of an unsettled
   * edit's difference being replaced (its lines aren't billed any more)
   */
  force?: Iterable<string>;
}

export interface DropEditResult {
  /** Bill lines after the edit (unchanged categories keep their billed amounts) */
  lines: AdjustmentLine[];
  /** The edited drop bill for the screen (DROP_BILL; null for legacy) */
  bill: ReturnType<typeof serializeDropBill> | null;
  late: ReturnType<typeof serializeLateReturn> | null;
  fastag: ReturnType<typeof serializeFastagUsage> | null;
  /** Booking km fields to store (when km was worked out again) */
  km: { endOdometer: number; kmDriven: number | null; extraKm: number; includedKm: number | null } | null;
  /** Legacy: ChargeEntry rows to write for the changed categories */
  legacyRows: Array<{
    moduleKey: string;
    chargeType: ChargeType;
    label: string;
    amount: Decimal;
    quantity: number;
    unitRate: Decimal;
    details: Record<string, unknown>;
    /** GST of a row the drop froze with GST (before item 8), at its rate */
    gst?: LineGst | null;
  }>;
  changed: Set<string>;
  diff: ReturnType<typeof diffAdjustmentLines>;
}

/**
 * The drop's bill with `inputs`, line by line, and its difference from what is
 * billed now. Throws DropEditError for an impossible reading, a discount above
 * the charges or a late return that can't be priced.
 */
export async function computeDropEdit(
  bookingId: number,
  state: DropEditState,
  inputs: DropEditInputs,
  overrides: DropEditOverrides,
  tx?: TxClient,
): Promise<DropEditResult> {
  const db = tx ?? prisma;
  const changed = changedDropCategories(state.inputs, inputs, {
    pickupOdometerChanged: overrides.pickupOdometer !== undefined,
    pickupFastagChanged: overrides.pickupFastagBalance !== undefined,
  });
  for (const category of overrides.force ?? []) changed.add(category);
  // Nothing to measure from: those lines keep what they were billed
  if (inputs.endOdometer == null) changed.delete("KM");
  if (!state.returnedAt) changed.delete("LATE");
  const legacy = state.flow === "LEGACY";
  const recomputed: AdjustmentLine[] = [];
  const legacyRows: DropEditResult["legacyRows"] = [];
  const line = (entryType: string, label: string, amount: Decimal, referenceType: string | null, referenceId: string | null = null) =>
    recomputed.push({ part: "DROP", entryType, classification: "NON_TAXABLE", referenceType, referenceId, label, amount });

  // ── Km ──
  let km: DropEditResult["km"] = null;
  if (changed.has("KM") && inputs.endOdometer != null) {
    let segments: OdometerSegments = await getOdometerSegments(bookingId, db);
    if (overrides.pickupOdometer != null) segments = withPickupOdometer(segments, overrides.pickupOdometer);
    const problem = endOdometerProblem(segments, inputs.endOdometer);
    if (problem) {
      throw new DropEditError(StatusCode.BAD_REQUEST, { code: "END_ODOMETER_TOO_LOW", message: problem, field: "endOdometer" });
    }
    const allowance = await billedAllowanceFor(bookingId, state, db);
    let extraKm = 0;
    let charge = ZERO;
    let kmDriven: number | null = null;
    let staffEntered = false;
    if (!segments.complete) {
      // A swap recorded without readings: only the staff-entered extra km is billed
      extraKm = Math.max(0, Math.floor(inputs.manualExtraKm ?? 0));
      staffEntered = inputs.manualExtraKm != null;
      charge = allowance.extraKmEnabled && allowance.extraKmRate ? allowance.extraKmRate.mul(extraKm).ceil() : ZERO;
    } else {
      const billed = billedKmCharge(allowance, segments, inputs.endOdometer);
      kmDriven = billed.kmDriven;
      extraKm = billed.extraKm;
      charge = billed.charge ?? ZERO;
    }
    km = { endOdometer: inputs.endOdometer, kmDriven, extraKm, includedKm: allowance.includedKm };
    if (charge.gt(0)) {
      const rate = allowance.extraKmRate ?? ZERO;
      const label = staffEntered
        ? `Extra km (entered at drop, vehicle swapped): ${extraKm} km × ₹${rate.toFixed(2)}`
        : `Extra km: ${extraKm} km × ₹${rate.toFixed(2)}`;
      line("EXTRA_KM", label, charge, legacy ? LEGACY_EXTRA_KM_KEY : LedgerEntryType.EXTRA_KM);
      if (legacy) {
        legacyRows.push({
          moduleKey: LEGACY_EXTRA_KM_KEY,
          chargeType: ChargeType.EXTRA_KM,
          label,
          amount: charge,
          quantity: extraKm,
          unitRate: rate,
          details: { kmSource: staffEntered ? "STAFF_ENTERED" : "ODOMETER", kmDriven, includedKm: allowance.includedKm, edited: true },
        });
      }
    }
  }

  // ── Late return (measured to the drop's frozen return time) ──
  let late: DropEditResult["late"] = null;
  if (changed.has("LATE") && state.returnedAt) {
    // The policy the drop billed with (rate, grace, extra time charged), not today's
    const policy = billedLatePolicy(await resolveLateReturnPolicy(bookingId, db), state.billedLate);
    const charge = calculateLateReturnCharge(state.endAt, state.returnedAt, policy, {
      applyGrace: inputs.applyGrace,
      waive: inputs.waiveReason != null,
    });
    if (charge.status === "RATE_UNAVAILABLE") {
      throw new DropEditError(StatusCode.CONFLICT, {
        code: "LATE_RATE_UNAVAILABLE",
        message: "The vehicle's extra-hour rate isn't set up, so the late return can't be billed. Waive the late charge with a reason.",
      });
    }
    late = serializeLateReturn(charge, null, inputs.waiveReason != null ? { reason: inputs.waiveReason } : null);
    if (charge.status === "CHARGED" && charge.amount.gt(0)) {
      const label = lateReturnLabel(charge);
      line("EXTRA_TIME", label, charge.amount, legacy ? LEGACY_EXTRA_TIME_KEY : LATE_RETURN_REF);
      if (legacy && charge.rate) {
        legacyRows.push({
          moduleKey: LEGACY_EXTRA_TIME_KEY,
          chargeType: ChargeType.EXTRA_TIME,
          label,
          amount: charge.amount,
          quantity: charge.hours,
          unitRate: charge.rate,
          details: {
            dueAt: charge.dueAt.toISOString(),
            returnedAt: charge.returnedAt.toISOString(),
            lateMinutes: charge.lateMinutes,
            graceApplied: charge.graceApplied,
            // The policy billed with, for the next edit
            graceMinutes: policy.graceMinutes,
            graceType: policy.graceType,
            gracePolicyEnabled: policy.gracePolicyEnabled,
            extraTimeEnabled: policy.extraTimeEnabled,
            rate: charge.rate.toFixed(2),
            edited: true,
          },
        });
      }
    }
  }

  // ── Fuel, other charges (drop bill only) ──
  if (!legacy && changed.has("FUEL") && inputs.fuelCharge.gt(0)) {
    line("FUEL", "Fuel deficit charge", inputs.fuelCharge.toDecimalPlaces(2), LedgerEntryType.FUEL);
  }
  if (!legacy && changed.has("OTHER")) {
    for (const other of inputs.otherCharges) {
      if (other.amount.gt(0)) line("DAMAGE", other.label.trim(), other.amount.toDecimalPlaces(2), OTHER_CHARGE_REF);
    }
  }

  // ── FASTag: from the balances when every reading is there, else the typed charge ──
  let fastag: DropEditResult["fastag"] = null;
  if (changed.has("FASTAG")) {
    const legs = await getFastagLegs(bookingId, inputs.returnFastagBalance, db);
    if (overrides.pickupFastagBalance !== undefined && legs[0]) legs[0] = { ...legs[0], startBalance: overrides.pickupFastagBalance };
    const usage = calculateFastagUsage(legs);
    fastag = serializeFastagUsage(usage);
    if (usage.status === "COMPUTED") {
      if (usage.amount.gt(0)) {
        line("FASTAG", usage.label!, usage.amount, legacy ? LEGACY_FASTAG_KEY : LedgerEntryType.FASTAG);
        if (legacy) {
          legacyRows.push({
            moduleKey: LEGACY_FASTAG_KEY,
            chargeType: ChargeType.FASTAG,
            label: usage.label!,
            amount: usage.amount,
            quantity: 1,
            unitRate: usage.amount,
            details: { fastag: serializeFastagUsage(usage), edited: true },
          });
        }
      }
    } else if (!legacy && inputs.fastagAmount.gt(0)) {
      const notes = inputs.fastagNotes?.trim();
      line("FASTAG", notes ? `FASTag: ${notes}` : "FASTag charges", inputs.fastagAmount.toDecimalPlaces(2), LedgerEntryType.FASTAG);
    }
  }

  // ── Drop damages charged at drop (amounts) ──
  for (const damage of state.damages) {
    const category = `DAMAGE:${damage.publicId}`;
    if (!changed.has(category)) continue;
    const amount = inputs.damageAmounts[damage.publicId] ?? damage.amount;
    if (amount.gt(0)) line("DAMAGE", damage.label, amount.toDecimalPlaces(2), DROP_DAMAGE_REF, damage.publicId);
  }

  // A line worked out again keeps the GST its billed line carried (bills from before item 8)
  const taxed = withStoredTax(recomputed, state.billedLines);
  for (const row of legacyRows) {
    const recomputedLine = taxed.find((l) => l.referenceType === row.moduleKey);
    if (recomputedLine?.gst?.gt(0)) row.gst = lineGstOf(row.amount, recomputedLine.gst);
  }

  // Unchanged categories keep exactly what they were billed
  let lines = keepUnchangedLines(state.billedLines, taxed, (l) => changed.has(dropLineCategory(l)));
  const chargeLines = lines.filter((l) => l.entryType !== "DISCOUNT");
  const subtotal = chargeLines.reduce((s, l) => s.plus(l.amount), ZERO);

  // ── Drop discount: capped at the drop charges ──
  if (!legacy && changed.has("DISCOUNT")) {
    lines = lines.filter((l) => l.entryType !== "DISCOUNT");
    if (inputs.discount && inputs.discount.amount.gt(0)) {
      if (inputs.discount.amount.gt(subtotal)) {
        throw new DropEditError(StatusCode.BAD_REQUEST, {
          code: "DISCOUNT_EXCEEDS_CHARGES",
          message: `Discount can't be more than the drop charges (₹${subtotal.toFixed(2)}).`,
          field: "discount",
        });
      }
      lines.push({
        part: "DROP",
        entryType: "DISCOUNT",
        classification: "DISCOUNT",
        referenceType: DROP_DISCOUNT_REF,
        referenceId: null,
        label: `Drop discount: ${inputs.discount.reason.trim()}`,
        amount: inputs.discount.amount.toDecimalPlaces(2).negated(),
      });
    }
  } else if (!legacy && changed.size > 0) {
    // Charges moved: the discount is cut to them (or back up to what staff gave)
    lines = capDropDiscount(lines, inputs.discount?.amount ?? null);
  }

  const diff = diffAdjustmentLines(state.billedLines, lines);
  const bill = legacy ? null : billFor(lines);
  return { lines, bill, late, fastag, km, legacyRows, changed, diff };
}

/** The edited drop bill in the shape the drop screens render (no drop line is taxable — item 8). */
function billFor(lines: AdjustmentLine[]) {
  const charges: DropChargeLine[] = lines
    .filter((l) => l.entryType !== "DISCOUNT")
    .map((l) => ({
      type: l.entryType as LedgerEntryType,
      label: l.label,
      amount: l.amount,
      referenceType: l.referenceType ?? l.entryType,
      ...(l.referenceId && { referenceId: l.referenceId }),
    }));
  const discount = lines.filter((l) => l.entryType === "DISCOUNT").reduce((s, l) => s.plus(l.amount.abs()), ZERO);
  return serializeDropBill(buildDropBill(charges, discount, null));
}

/**
 * The free km and rate the drop billed with; anything it didn't record (older
 * drops) comes from the booking's allowance worked out now.
 */
async function billedAllowanceFor(bookingId: number, state: DropEditState, db: TxClient): Promise<BilledKmAllowance> {
  const [booking, legacyKm] = await Promise.all([
    db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { freeKmLimit: true, extraKmCharged: true } }),
    db.chargeEntry.findUnique({
      where: { bookingId_moduleKey: { bookingId, moduleKey: LEGACY_EXTRA_KM_KEY } },
      select: { unitRate: true },
    }),
  ]);
  const billed = billedKmAllowance({
    billKm: state.billMeta?.km ?? null,
    freeKmLimit: booking.freeKmLimit,
    extraKmCharged: booking.extraKmCharged,
    legacyExtraKmRate: legacyKm?.unitRate ?? null,
  });
  if (billed.includedKm != null && billed.extraKmRate != null && billed.extraKmEnabled != null) return billed;
  try {
    const live = await resolveKmAllowance(bookingId);
    return {
      includedKm: billed.includedKm ?? live.includedKm,
      extraKmRate: billed.extraKmRate ?? live.extraKmRate,
      extraKmEnabled: billed.extraKmEnabled ?? live.extraKmEnabled,
    };
  } catch {
    return billed;
  }
}

/** CGST / SGST halves of a line's GST (the legacy row columns), at the rate it was taxed. */
function lineGstOf(taxable: Decimal, gst: Decimal): LineGst {
  const cgst = gst.div(2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    taxable,
    cgst,
    sgst: gst.minus(cgst),
    gst,
    total: taxable.plus(gst),
    rate: taxable.gt(0) ? gst.div(taxable).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : ZERO,
  };
}

/**
 * Legacy drop: rewrites the return-charge rows of the changed categories with
 * the helpers the drop used (the branch manager collects them in Settlements).
 */
export async function writeLegacyDropRows(
  tx: TxClient,
  bookingId: number,
  result: DropEditResult,
  actorId: number,
): Promise<void> {
  const keys: Array<[string, string]> = [
    ["KM", LEGACY_EXTRA_KM_KEY],
    ["LATE", LEGACY_EXTRA_TIME_KEY],
    ["FASTAG", LEGACY_FASTAG_KEY],
  ];
  for (const [category, moduleKey] of keys) {
    if (!result.changed.has(category)) continue;
    const row = result.legacyRows.find((r) => r.moduleKey === moduleKey);
    if (row) {
      await upsertLegacyReturnCharge(tx, {
        bookingId,
        moduleKey,
        chargeType: row.chargeType,
        label: row.label,
        amount: row.amount,
        quantity: row.quantity,
        unitRate: row.unitRate,
        actorId,
        // No GST on drop charges (item 8) — a row the drop froze with GST keeps it
        gst: row.gst ?? null,
        details: row.details,
      });
    } else {
      await removeLegacyReturnCharge(tx, bookingId, moduleKey);
    }
  }
}
