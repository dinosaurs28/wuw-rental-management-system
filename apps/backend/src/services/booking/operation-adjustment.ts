/**
 * Money of an edit to a completed pickup / drop (client item 1: "Full Pickup and
 * Drop Flow should be editable") — the pure rules, no database.
 *
 * The edited operation's bill is worked out again with the edited inputs and
 * compared, line by line, with what is billed now (the original bill plus any
 * earlier edits). The difference is settled on an ADJUSTMENT payment session:
 * one ledger line per changed bill line (new − old), then the usual counter
 * payment (cash / UPI / split / credit) or refund (cash / UPI) for the total.
 * Past sessions, ledger lines and payments are never changed.
 *
 * Only inputs the edit actually changed are worked out again; every other line
 * keeps the amount it was billed (so a photo-only edit never moves money).
 */
import Decimal from "decimal.js";

const ZERO = new Decimal(0);

/** Which side of the booking a line belongs to. */
export type AdjustmentPart = "PICKUP" | "DROP";

/** Two decimals, half up — money as the ledger stores it. */
const money2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** A bill line as the comparison sees it: its effect on what the customer owes. */
export interface AdjustmentLine {
  part: AdjustmentPart;
  /** LedgerEntryType of the line (EXTRA_KM, FUEL, DISCOUNT, DEPOSIT …) */
  entryType: string;
  /** TAXABLE | NON_TAXABLE | DISCOUNT */
  classification: string;
  referenceType: string | null;
  referenceId: string | null;
  label: string;
  /** Effect on the bill incl. any GST — a discount is negative */
  amount: Decimal;
  /**
   * The GST inside `amount` (bills from before item 8 taxed drop charges; a
   * discount of such a bill reversed GST — negative). Absent = none.
   */
  gst?: Decimal;
  /** A discount's taxable share (negative), as the drop bill stored it. Absent = none. */
  base?: Decimal;
}

export interface AdjustmentDeltaLine extends Omit<AdjustmentLine, "amount" | "gst" | "base"> {
  key: string;
  oldAmount: Decimal;
  newAmount: Decimal;
  /** newAmount − oldAmount */
  delta: Decimal;
  /** The GST part of `delta` (TAXABLE / discount lines of a taxed bill), else 0 */
  gstDelta: Decimal;
  /** The taxable-share part of a discount's delta, else 0 */
  baseDelta: Decimal;
}

/** LedgerEntry.referenceType of free-form "other charges" (drop-bill.service OTHER_CHARGE_REF). */
const OTHER_CHARGE_REF = "OTHER_CHARGE";
/** LedgerEntry.referenceType of the drop discount (drop-damage.service DROP_DISCOUNT_REF). */
const DROP_DISCOUNT_REF = "DROP_DISCOUNT";

/**
 * Identity of a bill line across the original bill and its edits. Free-form
 * "other charges" are compared as one line (staff retype them freely).
 */
export function adjustmentLineKey(line: Pick<AdjustmentLine, "part" | "entryType" | "referenceType" | "referenceId">): string {
  if (line.referenceType === OTHER_CHARGE_REF) return `${line.part}|${line.entryType}|${OTHER_CHARGE_REF}|`;
  return `${line.part}|${line.entryType}|${line.referenceType ?? ""}|${line.referenceId ?? ""}`;
}

/**
 * Line-by-line difference between what is billed now (`before`, possibly
 * several rows per line: the original bill and earlier edits) and the bill
 * worked out with the edited inputs (`after`). Lines present on either side
 * are returned (with a zero delta when unchanged), in a stable order.
 */
export function diffAdjustmentLines(before: AdjustmentLine[], after: AdjustmentLine[]) {
  type Row = AdjustmentDeltaLine & { oldGst: Decimal; newGst: Decimal; oldBase: Decimal; newBase: Decimal };
  const rows = new Map<string, Row>();
  const touch = (line: AdjustmentLine) => {
    const key = adjustmentLineKey(line);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        part: line.part,
        entryType: line.entryType,
        classification: line.classification,
        referenceType: line.referenceType,
        referenceId: line.referenceId,
        label: line.label,
        oldAmount: ZERO,
        newAmount: ZERO,
        delta: ZERO,
        gstDelta: ZERO,
        baseDelta: ZERO,
        oldGst: ZERO,
        newGst: ZERO,
        oldBase: ZERO,
        newBase: ZERO,
      };
      rows.set(key, row);
    }
    // A taxed line keeps its tax treatment in the difference
    if (line.classification === "TAXABLE") row.classification = "TAXABLE";
    return row;
  };
  for (const line of before) {
    const row = touch(line);
    row.oldAmount = row.oldAmount.plus(line.amount);
    row.oldGst = row.oldGst.plus(line.gst ?? ZERO);
    row.oldBase = row.oldBase.plus(line.base ?? ZERO);
  }
  const otherLabels = new Map<string, string[]>();
  for (const line of after) {
    const row = touch(line);
    row.newAmount = row.newAmount.plus(line.amount);
    row.newGst = row.newGst.plus(line.gst ?? ZERO);
    row.newBase = row.newBase.plus(line.base ?? ZERO);
    if (line.referenceType === OTHER_CHARGE_REF) {
      otherLabels.set(row.key, [...(otherLabels.get(row.key) ?? []), line.label]);
    } else {
      row.label = line.label;
    }
  }
  for (const [key, labels] of otherLabels) rows.get(key)!.label = labels.join(", ");

  const lines: AdjustmentDeltaLine[] = [...rows.values()]
    .filter((row) => !row.oldAmount.isZero() || !row.newAmount.isZero())
    .map(({ oldGst, newGst, oldBase, newBase, ...row }) => ({
      ...row,
      delta: row.newAmount.minus(row.oldAmount),
      gstDelta: newGst.minus(oldGst),
      baseDelta: newBase.minus(oldBase),
    }));
  const oldTotal = lines.reduce((s, l) => s.plus(l.oldAmount), ZERO);
  const newTotal = lines.reduce((s, l) => s.plus(l.newAmount), ZERO);
  return { lines, oldTotal, newTotal, delta: newTotal.minus(oldTotal) };
}

/**
 * Keeps the billed amount of every line whose inputs the edit didn't change:
 * `after` lines of an unchanged group are replaced by the `before` lines of
 * that group. `changed(key)` says whether a line's inputs changed.
 */
export function keepUnchangedLines(
  before: AdjustmentLine[],
  after: AdjustmentLine[],
  changed: (line: AdjustmentLine) => boolean,
): AdjustmentLine[] {
  const keptBefore = before.filter((line) => !changed(line));
  const recomputed = after.filter((line) => changed(line));
  return [...keptBefore, ...recomputed];
}

/**
 * Recomputed lines at the tax treatment their line was billed with: a drop
 * bill from before item 8 taxed its charges, so a line worked out again keeps
 * the GST rate its billed line carried (only the taxable value changes). A
 * line with no taxed counterpart stays non-taxable (item 8).
 */
export function withStoredTax(recomputed: AdjustmentLine[], billed: AdjustmentLine[]): AdjustmentLine[] {
  return recomputed.map((line) => {
    if (line.entryType === "DISCOUNT" || (line.gst && !line.gst.isZero())) return line;
    const key = adjustmentLineKey(line);
    const same = billed.filter((b) => adjustmentLineKey(b) === key && b.entryType !== "DISCOUNT");
    const gst = same.reduce((s, b) => s.plus(b.gst ?? ZERO), ZERO);
    const taxable = same.reduce((s, b) => s.plus(b.amount.minus(b.gst ?? ZERO)), ZERO);
    if (gst.lte(0) || taxable.lte(0)) return line;
    const rate = gst.div(taxable).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const lineGst = money2(line.amount.mul(rate));
    return { ...line, classification: "TAXABLE", amount: line.amount.plus(lineGst), gst: lineGst };
  });
}

/**
 * The drop discount, never more than the drop charges: when an edit lowers the
 * charges below the discount, it is cut to them; when a discount cut that way
 * (`typed` = what staff gave) finds room again, it goes back up to `typed`. A
 * discount that reversed GST keeps its GST / taxable-share split in proportion.
 * Returns the lines unchanged when the discount stands.
 */
export function capDropDiscount(lines: AdjustmentLine[], typed: Decimal | null): AdjustmentLine[] {
  const discounts = lines.filter((l) => l.entryType === "DISCOUNT");
  if (discounts.length === 0 && !(typed && typed.gt(0))) return lines;
  const charges = lines.filter((l) => l.entryType !== "DISCOUNT").reduce((s, l) => s.plus(l.amount), ZERO);
  const billed = discounts.reduce((s, l) => s.plus(l.amount), ZERO).negated();
  let target = billed;
  if (typed && billed.lt(typed)) target = typed;
  target = Decimal.min(target, Decimal.max(ZERO, charges));
  if (target.eq(billed)) return lines;
  const rest = lines.filter((l) => l.entryType !== "DISCOUNT");
  if (target.lte(0)) return rest;
  const first = discounts[0];
  const gst = discounts.reduce((s, l) => s.plus(l.gst ?? ZERO), ZERO);
  const base = discounts.reduce((s, l) => s.plus(l.base ?? ZERO), ZERO);
  const share = billed.gt(0) ? target.div(billed) : new Decimal(1);
  return [
    ...rest,
    {
      part: first?.part ?? "DROP",
      entryType: "DISCOUNT",
      classification: "DISCOUNT",
      referenceType: first?.referenceType ?? DROP_DISCOUNT_REF,
      referenceId: null,
      label: first?.label ?? "Drop discount",
      amount: target.negated(),
      ...(!gst.isZero() && { gst: money2(gst.mul(share)) }),
      ...(!base.isZero() && { base: money2(base.mul(share)) }),
    },
  ];
}

/**
 * The safety deposit line of a pickup edit: from the deposit as last settled
 * (`current` less the change an unsettled difference being replaced carried —
 * the booking already holds it) to `target`. Null when they match.
 */
export function depositAdjustmentLine(p: { current: Decimal; pendingDelta: Decimal; target: Decimal }): AdjustmentDeltaLine | null {
  const settled = p.current.minus(p.pendingDelta);
  if (p.target.eq(settled)) return null;
  const line = {
    part: "PICKUP" as const,
    entryType: "DEPOSIT",
    classification: "NON_TAXABLE",
    referenceType: "SAFETY_DEPOSIT",
    referenceId: null,
    label: "Safety deposit",
  };
  return {
    ...line,
    key: adjustmentLineKey(line),
    oldAmount: settled,
    newAmount: p.target,
    delta: p.target.minus(settled),
    gstDelta: ZERO,
    baseDelta: ZERO,
  };
}

/** LedgerEntry.referenceType of the edit line that takes money off the customer's credit. */
export const CREDIT_REDUCED_REF = "CUSTOMER_CREDIT_REDUCED";

/**
 * An edit that lowers what the customer owes while part of the booking is on
 * counter credit (#11) takes it off that credit first — only the rest is
 * refunded. `creditOutstanding` = the part of the booking on credit.
 */
export function creditOffset(delta: Decimal, creditOutstanding: Decimal): { reduction: Decimal; net: Decimal } {
  if (delta.gte(0) || creditOutstanding.lte(0)) return { reduction: ZERO, net: delta };
  const reduction = money2(Decimal.min(delta.abs(), creditOutstanding));
  return { reduction, net: delta.plus(reduction) };
}

/** The plan line for credit taken off instead of refunded (+, it lowers the refund). */
export function creditReductionLine(part: AdjustmentPart, reduction: Decimal): AdjustmentDeltaLine {
  const line = {
    part,
    entryType: "CREDIT",
    classification: "PAYMENT",
    referenceType: CREDIT_REDUCED_REF,
    referenceId: null,
    label: "Taken off the customer's credit instead of refunded",
  };
  return {
    ...line,
    key: adjustmentLineKey(line),
    oldAmount: ZERO,
    newAmount: reduction,
    delta: reduction,
    gstDelta: ZERO,
    baseDelta: ZERO,
  };
}

/** The late-return policy fields a drop bill records next to its late charge. */
export interface LatePolicyFields {
  extraTimeEnabled: boolean;
  gracePolicyEnabled: boolean;
  graceType: string;
  graceMinutes: number;
  extraHourRate: Decimal | null;
}

/**
 * The late-return policy the drop billed with: what the bill recorded (rate,
 * grace minutes / type, whether extra time is charged) over today's policy,
 * so an edit never re-prices a late return with rules changed since.
 */
export function billedLatePolicy<P extends LatePolicyFields>(
  live: P,
  billed: {
    rate?: string | number | null;
    graceMinutes?: number | null;
    graceType?: string | null;
    gracePolicyEnabled?: boolean | null;
    extraTimeEnabled?: boolean | null;
  } | null,
): P {
  if (!billed) return live;
  return {
    ...live,
    ...(billed.rate != null && { extraHourRate: new Decimal(String(billed.rate)) }),
    ...(typeof billed.graceMinutes === "number" && { graceMinutes: billed.graceMinutes }),
    ...(typeof billed.graceType === "string" && { graceType: billed.graceType }),
    ...(typeof billed.gracePolicyEnabled === "boolean" && { gracePolicyEnabled: billed.gracePolicyEnabled }),
    ...(typeof billed.extraTimeEnabled === "boolean" && { extraTimeEnabled: billed.extraTimeEnabled }),
  };
}

/**
 * Settling an edit's difference never takes more than the booking owes, nor
 * pays back more than it was paid: `unpaid` = what the booking owes less the
 * money in (credit left out), `sessionDeposit` = the deposit change on the
 * difference (not counted as owed until settled). Returns why it can't be
 * settled, or null.
 */
export function adjustmentSettleProblem(
  net: Decimal,
  unpaid: Decimal,
  sessionDeposit: Decimal,
): "ALREADY_COLLECTED" | "ALREADY_REFUNDED" | null {
  const tolerance = new Decimal("0.01");
  if (net.gt(0) && unpaid.plus(sessionDeposit).plus(tolerance).lt(net)) return "ALREADY_COLLECTED";
  if (net.lt(0) && unpaid.negated().minus(sessionDeposit).plus(tolerance).lt(net.abs())) return "ALREADY_REFUNDED";
  return null;
}

export type SettlementAction = "COLLECT" | "REFUND" | "NONE";

/** Collect more, refund, or nothing — and how much. */
export function settlementOf(delta: Decimal): { action: SettlementAction; amount: Decimal } {
  const rounded = delta.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (rounded.gt(0)) return { action: "COLLECT", amount: rounded };
  if (rounded.lt(0)) return { action: "REFUND", amount: rounded.abs() };
  return { action: "NONE", amount: ZERO };
}

/**
 * How the difference can be settled at the counter, under the existing rules:
 * money collected by cash / UPI (photo) / split / credit — but a safety deposit
 * is never taken on credit; money paid back by cash or UPI. Collected by the
 * branch manager instead (legacy drop: return charges go to Settlements).
 */
export function settlementMethods(input: {
  action: SettlementAction;
  depositIncrease: boolean;
  settledByBranchManager: boolean;
}): { collect: string[]; refund: string[] } {
  if (input.settledByBranchManager || input.action === "NONE") return { collect: [], refund: [] };
  if (input.action === "REFUND") return { collect: [], refund: ["CASH", "UPI"] };
  const collect = ["CASH", "UPI", "SPLIT"];
  if (!input.depositIncrease) collect.push("CREDIT");
  return { collect, refund: [] };
}

/**
 * Safety deposit at drop: SET_OFF credits the held deposit against the drop
 * charges (charges above it collected, deposit above them refunded);
 * REFUND_IN_FULL refunds it all and collects the charges. Either way the
 * customer's net is charges − held, so switching between them after the drop
 * moves no money — only the recorded choice changes.
 */
export function depositOutcome(handling: "SET_OFF" | "REFUND_IN_FULL", held: Decimal, charges: Decimal) {
  if (handling === "SET_OFF") {
    return {
      setOff: Decimal.min(held, charges),
      refund: Decimal.max(ZERO, held.minus(charges)),
      toCollect: Decimal.max(ZERO, charges.minus(held)),
    };
  }
  return { setOff: ZERO, refund: held, toCollect: charges };
}

/** Customer's net payment for the drop (collected − refunded) under a deposit outcome. */
export function dropNet(outcome: { refund: Decimal; toCollect: Decimal }): Decimal {
  return outcome.toCollect.minus(outcome.refund);
}

/** JSON of a delta line for clients and the adjustment session's metadata. */
export function serializeDeltaLine(line: AdjustmentDeltaLine) {
  return {
    key: line.key,
    part: line.part,
    entryType: line.entryType,
    referenceType: line.referenceType,
    referenceId: line.referenceId,
    label: line.label,
    oldAmount: line.oldAmount.toFixed(2),
    newAmount: line.newAmount.toFixed(2),
    delta: line.delta.toFixed(2),
  };
}

/** The ledger fields the netting below reads. */
export interface NettableEntry {
  publicId: string;
  entryType: string;
  classification: string;
  referenceType: string | null;
  referenceId: string | null;
  description: string;
  amount: { toString(): string };
  gstAmount: { toString(): string };
  baseAmount?: { toString(): string } | null;
  metadata?: unknown;
  isVoided?: boolean;
}

/**
 * The drop bill as edited, for the invoice: the completed RETURN session's
 * charge / discount lines netted with the delta lines of edits (ADJUSTMENT
 * entries with metadata.part DROP). Only lines an edit touched are netted — a
 * line keeps its original row (its publicId stays the invoice source), its tax
 * treatment (a taxed line's taxable value and GST are netted separately) and
 * the latest label; lines netted to zero drop out. Other charges an edit
 * touched become one line. Lines no edit touched, and payment / refund rows,
 * are passed through untouched.
 */
export function netDropEntries<T extends NettableEntry>(original: T[], adjustments: NettableEntry[]): T[] {
  const live = original.filter((e) => !e.isVoided);
  const deltas = adjustments.filter(
    (e) =>
      !e.isVoided &&
      e.classification !== "PAYMENT" &&
      (e.metadata as { part?: string } | null)?.part === "DROP",
  );
  if (deltas.length === 0) return live;
  const keyOf = (e: NettableEntry) => adjustmentLineKey({ part: "DROP", ...e });
  const touched = new Set(deltas.map(keyOf));
  const dec = (v: { toString(): string } | null | undefined) => new Decimal(v == null ? "0" : v.toString());

  const out: T[] = [];
  const rows = new Map<string, { base: T; amount: Decimal; gst: Decimal; baseAmount: Decimal; taxed: boolean; label: string }>();
  const add = (key: string, e: NettableEntry, label: string, asBase: T | null) => {
    let row = rows.get(key);
    if (!row) {
      row = { base: (asBase ?? e) as T, amount: ZERO, gst: ZERO, baseAmount: ZERO, taxed: false, label };
      rows.set(key, row);
    }
    // Ledger amounts: TAXABLE = taxable value (GST beside it); DISCOUNT = whole effect
    row.amount = row.amount.plus(dec(e.amount));
    row.gst = row.gst.plus(dec(e.gstAmount));
    row.baseAmount = row.baseAmount.plus(dec(e.baseAmount));
    if (e.classification === "TAXABLE") row.taxed = true;
    return row;
  };
  for (const e of live) {
    const key = keyOf(e);
    // Money rows, and lines no edit touched, stay as they are
    if (e.classification === "PAYMENT" || !touched.has(key)) {
      out.push(e);
      continue;
    }
    const existing = rows.get(key);
    const row = add(key, e, e.description, e);
    if (existing && e.referenceType === OTHER_CHARGE_REF) row.label = `${row.label}, ${e.description}`;
  }
  for (const d of deltas) {
    const key = keyOf(d);
    const label = String((d.metadata as { label?: unknown } | null)?.label ?? d.description);
    // A line the original bill didn't have: the delta row stands for it
    const row = add(key, d, label, rows.has(key) ? null : (d as T));
    row.label = label;
  }
  for (const { base, amount, gst, baseAmount, taxed, label } of rows.values()) {
    if (amount.plus(taxed ? gst : ZERO).isZero()) continue;
    const discount = base.classification === "DISCOUNT";
    out.push({
      ...base,
      classification: discount ? "DISCOUNT" : taxed ? "TAXABLE" : "NON_TAXABLE",
      amount: amount.toFixed(2),
      gstAmount: (discount || taxed ? gst : ZERO).toFixed(2),
      baseAmount: (discount ? baseAmount : taxed ? amount : ZERO).toFixed(2),
      description: label,
      // A discount's split as netted (the invoice falls back to these when a part is ₹0)
      ...(discount && {
        metadata: {
          ...((base.metadata ?? {}) as Record<string, unknown>),
          taxableShare: baseAmount.abs().toFixed(2),
          gst: gst.abs().toFixed(2),
        },
      }),
    });
  }
  return out;
}
