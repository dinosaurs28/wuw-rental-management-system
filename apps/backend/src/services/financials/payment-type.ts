/**
 * The six payment types of the Branch Manager "Financials" view (client spec, Oct 2026):
 * Rent · Security deposit · Extension fee · Late fee · Extra charges · Damages.
 *
 * What counts as "collected"
 *   - PaymentTransaction rows with status COLLECTED (cash / counter UPI awaiting the BM's
 *     confirmation) or CONFIRMED. VOIDED, REJECTED, FAILED, INITIATED and REFUNDED rows are
 *     left out: they are money that never arrived or was reversed.
 *   - Refunds (purpose OVERPAYMENT_REFUND / CANCELLATION_REFUND, incl. "Refund to customer"
 *     and deposit refunds) are money paid OUT, so they are excluded from "collected" — not
 *     shown as negative rows. They stay visible in the booking drawer and the Period tab.
 *
 * Purpose → type
 *   ADVANCE, FULL_PAYMENT  → RENT
 *   EXTENSION              → EXTENSION_FEE
 *   SAFETY_DEPOSIT         → SECURITY_DEPOSIT
 *   DAMAGE_FEE             → DAMAGES (damage-report payments)
 *   REMAINING_BALANCE      → ALLOCATE (below)
 *
 * REMAINING_BALANCE is what a pickup, a drop bill, an edit (ADJUSTMENT), a credit clearance
 * or a legacy settlement collected, so one payment can cover rent + late fee + extras +
 * damage. It is split, in proportion and exact to the paise (the cash and online parts
 * split the same way), over the positive, non-voided charge lines of:
 *   (A) its own payment session — the row's idempotencyKey is `pt:<ledger PAYMENT key>`
 *       (createSessionPaymentTransactions), so the ledger PAYMENT line names the session;
 *   (B) else the booking's COMPLETED RETURN session completed at or before the payment
 *       (money taken after a drop bill: credit clearances, settlements);
 *   (C) else the booking's legacy ChargeEntry rows (no BASE, no deposit) recorded at or
 *       before the payment (pre-ledger drops);
 *   (D) else, or when none of those has a positive line, all of it is RENT.
 *
 * Bill line → type (ledger LedgerEntryType / legacy ChargeType)
 *   BOOKING_BASE / BASE                       → RENT
 *   EXTENSION                                 → EXTENSION_FEE
 *   EXTRA_TIME (late return), GRACE_ADJUSTMENT → LATE_FEE
 *   DAMAGE (drop damage, damage module)       → DAMAGES
 *   DAMAGE with referenceType OTHER_CHARGE    → EXTRA_CHARGES (free-form "other" drop charge)
 *   EXTRA_KM, FUEL / FUEL_DEFICIT, FASTAG, VEHICLE_SWAP → EXTRA_CHARGES
 *   DEPOSIT, DISCOUNT, PAYMENT, REFUND, CREDIT → not a weight (the deposit part of a session
 *   payment is already its own SAFETY_DEPOSIT row; discounts lower what was paid in
 *   proportion).
 *
 * The SQL CASE expressions below are generated from these same tables, so the database
 * query and the TypeScript helpers can't drift apart.
 */

export const CLIENT_PAYMENT_TYPES = [
  "RENT",
  "SECURITY_DEPOSIT",
  "EXTENSION_FEE",
  "LATE_FEE",
  "EXTRA_CHARGES",
  "DAMAGES",
] as const;

export type ClientPaymentType = (typeof CLIENT_PAYMENT_TYPES)[number];

export const CLIENT_PAYMENT_TYPE_LABELS: Record<ClientPaymentType, string> = {
  RENT: "Rent",
  SECURITY_DEPOSIT: "Security deposit",
  EXTENSION_FEE: "Extension fee",
  LATE_FEE: "Late fee",
  EXTRA_CHARGES: "Extra charges",
  DAMAGES: "Damages",
};

/** 1-based display / sort order. */
export const typeOrder = (t: ClientPaymentType): number => CLIENT_PAYMENT_TYPES.indexOf(t) + 1;

export const isClientPaymentType = (v: unknown): v is ClientPaymentType =>
  typeof v === "string" && (CLIENT_PAYMENT_TYPES as readonly string[]).includes(v);

/** Statuses that are money received. */
export const COLLECTED_STATUSES = ["COLLECTED", "CONFIRMED"] as const;

/** Purposes shown in the view (refund purposes are paid out, not collected). */
const PURPOSE_TYPE: Record<string, ClientPaymentType | "ALLOCATE"> = {
  ADVANCE: "RENT",
  FULL_PAYMENT: "RENT",
  EXTENSION: "EXTENSION_FEE",
  SAFETY_DEPOSIT: "SECURITY_DEPOSIT",
  DAMAGE_FEE: "DAMAGES",
  REMAINING_BALANCE: "ALLOCATE",
};

export const COLLECTED_PURPOSES = Object.keys(PURPOSE_TYPE);

/** Type of a payment purpose; "ALLOCATE" = split over its bill lines; null = not collected money. */
export function typeForPurpose(purpose: string): ClientPaymentType | "ALLOCATE" | null {
  return PURPOSE_TYPE[purpose] ?? null;
}

/** Ledger line types that weigh a REMAINING_BALANCE payment. */
const LEDGER_TYPE: Record<string, ClientPaymentType> = {
  BOOKING_BASE: "RENT",
  EXTENSION: "EXTENSION_FEE",
  EXTRA_TIME: "LATE_FEE",
  GRACE_ADJUSTMENT: "LATE_FEE",
  DAMAGE: "DAMAGES",
  EXTRA_KM: "EXTRA_CHARGES",
  FUEL: "EXTRA_CHARGES",
  FASTAG: "EXTRA_CHARGES",
  VEHICLE_SWAP: "EXTRA_CHARGES",
};

/** referenceType of the free-form "other" drop charge (drop-bill.service.ts OTHER_CHARGE_REF). */
export const OTHER_CHARGE_REFERENCE = "OTHER_CHARGE";

export const ALLOCATABLE_LEDGER_TYPES = Object.keys(LEDGER_TYPE);

export function typeForLedgerLine(entryType: string, referenceType: string | null | undefined): ClientPaymentType | null {
  if (entryType === "DAMAGE" && referenceType === OTHER_CHARGE_REFERENCE) return "EXTRA_CHARGES";
  return LEDGER_TYPE[entryType] ?? null;
}

/** Legacy ChargeEntry types that weigh a payment (BASE is in the booking rent, deposit is held money). */
const CHARGE_TYPE: Record<string, ClientPaymentType> = {
  EXTRA_TIME: "LATE_FEE",
  GRACE_ADJUSTMENT: "LATE_FEE",
  DAMAGE: "DAMAGES",
  EXTRA_KM: "EXTRA_CHARGES",
  FUEL_DEFICIT: "EXTRA_CHARGES",
  FASTAG: "EXTRA_CHARGES",
  VEHICLE_SWAP: "EXTRA_CHARGES",
};

export const ALLOCATABLE_CHARGE_TYPES = Object.keys(CHARGE_TYPE);

export function typeForChargeEntry(chargeType: string): ClientPaymentType | null {
  return CHARGE_TYPE[chargeType] ?? null;
}

// ── SQL generation (values are fixed enum names from the tables above, never user input) ──

const lit = (s: string): string => {
  if (!/^[A-Z_]+$/.test(s)) throw new Error(`Unsafe SQL literal: ${s}`);
  return `'${s}'`;
};
export const sqlList = (values: readonly string[]): string => values.map(lit).join(", ");

/** CASE over a PaymentTransaction purpose column (text) → direct type, NULL for REMAINING_BALANCE. */
export function purposeCaseSql(col: string): string {
  const whens = Object.entries(PURPOSE_TYPE)
    .filter(([, t]) => t !== "ALLOCATE")
    .map(([p, t]) => `WHEN ${lit(p)} THEN ${lit(t)}`);
  return `(CASE ${col} ${whens.join(" ")} ELSE 'RENT' END)`;
}

/** CASE over a LedgerEntry (entryType text, referenceType) → type. */
export function ledgerCaseSql(entryTypeCol: string, referenceTypeCol: string): string {
  const whens = Object.entries(LEDGER_TYPE).map(([e, t]) =>
    e === "DAMAGE"
      ? `WHEN ${entryTypeCol} = 'DAMAGE' AND COALESCE(${referenceTypeCol}, '') = ${lit(OTHER_CHARGE_REFERENCE)} THEN 'EXTRA_CHARGES' WHEN ${entryTypeCol} = 'DAMAGE' THEN ${lit(t)}`
      : `WHEN ${entryTypeCol} = ${lit(e)} THEN ${lit(t)}`,
  );
  return `(CASE ${whens.join(" ")} END)`;
}

/** CASE over a legacy ChargeEntry chargeType (text) → type. */
export function chargeCaseSql(col: string): string {
  const whens = Object.entries(CHARGE_TYPE).map(([c, t]) => `WHEN ${lit(c)} THEN ${lit(t)}`);
  return `(CASE ${col} ${whens.join(" ")} END)`;
}

/** CASE type → its 1-based order (sort by type, cumulative allocation order). */
export function typeOrderCaseSql(col: string): string {
  return `(CASE ${col} ${CLIENT_PAYMENT_TYPES.map((t, i) => `WHEN ${lit(t)} THEN ${i + 1}`).join(" ")} ELSE 99 END)`;
}

// ── Pure allocation (same arithmetic as the SQL) ──────────────────────────────

export interface PaymentAllocation {
  type: ClientPaymentType;
  /** cash + online of this part */
  amount: number;
  cash: number;
  online: number;
}

const toPaise = (n: number): number => Math.round(n * 100);

/**
 * Splits a payment over weighted types, exact to the paise: part i gets
 * round(x·cumW_i/W) − round(x·cumW_{i−1}/W), in type order, for x = cash and online,
 * so the parts always add back to the payment. Weights ≤ 0 are ignored; with no
 * positive weight the whole payment goes to `fallback`.
 *
 * Postgres ROUND(numeric) rounds halves away from zero, as Math.round does for the
 * non-negative paise values used here.
 */
export function allocatePayment(
  payment: { cash: number; online: number },
  weights: ReadonlyArray<{ type: ClientPaymentType; weight: number }>,
  fallback: ClientPaymentType = "RENT",
): PaymentAllocation[] {
  const byType = new Map<ClientPaymentType, number>();
  for (const w of weights) {
    if (!(w.weight > 0)) continue;
    byType.set(w.type, (byType.get(w.type) ?? 0) + w.weight);
  }
  const cashP = toPaise(payment.cash);
  const onlineP = toPaise(payment.online);
  if (byType.size === 0) {
    return [{ type: fallback, amount: (cashP + onlineP) / 100, cash: cashP / 100, online: onlineP / 100 }];
  }
  const ordered = [...byType.entries()].sort((a, b) => typeOrder(a[0]) - typeOrder(b[0]));
  const total = ordered.reduce((s, [, w]) => s + w, 0);
  const out: PaymentAllocation[] = [];
  let cum = 0;
  for (const [type, w] of ordered) {
    const prev = cum;
    cum += w;
    const cash = Math.round((cashP * cum) / total) - Math.round((cashP * prev) / total);
    const online = Math.round((onlineP * cum) / total) - Math.round((onlineP * prev) / total);
    out.push({ type, amount: (cash + online) / 100, cash: cash / 100, online: online / 100 });
  }
  return out;
}

/**
 * The cash / online parts of a row, made consistent with its total: rows written
 * before the split columns were filled (both 0) take the method's side.
 */
export function normaliseParts(p: { method: string; total: number; cash: number; online: number }): { cash: number; online: number } {
  const t = toPaise(p.total);
  const c = toPaise(p.cash);
  const o = toPaise(p.online);
  if (c + o === t) return { cash: c / 100, online: o / 100 };
  const cash = p.method === "CASH" ? t : p.method === "ONLINE" ? 0 : Math.min(c, t);
  return { cash: cash / 100, online: (t - cash) / 100 };
}

/** Online part through a payment gateway (Razorpay …) rather than counter UPI — utils/reporting classifyOnline. */
export const GATEWAY_REGEX = "razorpay|stripe|cashfree|payu|paytm|gateway|online|card";

export function isGatewayPayment(onlineGateway: string | null | undefined): boolean {
  return !!onlineGateway && new RegExp(GATEWAY_REGEX, "i").test(onlineGateway);
}

export type PaymentModeKey = "CASH" | "UPI" | "GATEWAY";

export const PAYMENT_MODE_LABELS: Record<PaymentModeKey, string> = {
  CASH: "Cash",
  UPI: "UPI",
  GATEWAY: "Online (gateway)",
};

/** "Cash", "UPI", "Cash + UPI", "Online (Razorpay)" … */
export function paymentModeLabel(p: { cash: number; online: number; onlineGateway: string | null | undefined }): string {
  const parts: string[] = [];
  if (p.cash > 0) parts.push("Cash");
  if (p.online > 0) {
    if (isGatewayPayment(p.onlineGateway)) {
      const g = String(p.onlineGateway);
      parts.push(/razorpay/i.test(g) ? "Online (Razorpay)" : "Online (gateway)");
    } else {
      parts.push("UPI");
    }
  }
  return parts.length ? parts.join(" + ") : "Cash";
}
