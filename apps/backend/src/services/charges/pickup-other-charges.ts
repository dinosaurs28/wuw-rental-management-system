/**
 * Pickup "other charges" (client, Nov 15 2026) — the pure rules (no database).
 *
 * At the pickup's Payment step the Fleet Executive may add free-form charges
 * (a reason + a ₹ amount, several, each removable) that the customer pays with
 * the pickup bill. They reuse the drop's "other charges" model: each is a
 * DAMAGE ledger line with referenceType OTHER_CHARGE (drop-bill.service
 * OTHER_CHARGE_REF), NON_TAXABLE, no GST — like every drop / recovery extra
 * (Oct 3 2026, item 8) — on the PICKUP payment session, marked metadata.part
 * "PICKUP". So Financials / reports classify them as "Extra charges"
 * (payment-type.ts), the invoice prints them (invoice-finalization), and
 * computeBookingOwed counts them as owed (pickupCharges) next to the rent.
 *
 * The request always carries the WHOLE set (replace, never append): back /
 * forward navigation and retries send the same list again and change nothing.
 */
import Decimal from "decimal.js";

/** LedgerEntry.referenceType shared with the drop's free-form other charges. */
export const PICKUP_OTHER_CHARGE_REF = "OTHER_CHARGE";
/** metadata.part of a pickup other charge line (the drop's lines carry none). */
export const PICKUP_OTHER_CHARGE_PART = "PICKUP";

export const PICKUP_CHARGE_LABEL_MAX = 120;
export const PICKUP_CHARGE_MAX_LINES = 20;
/** Highest single charge (₹) — a typo guard, far above any real extra. */
export const PICKUP_CHARGE_AMOUNT_MAX = new Decimal(500000);

export interface PickupOtherCharge {
  label: string;
  /** ₹, 2 dp, > 0, no GST */
  amount: Decimal;
}

/** 400 PICKUP_CHARGES_INVALID with the line it is about. */
export class PickupChargeError extends Error {
  readonly status = 400;
  readonly code = "PICKUP_CHARGES_INVALID";
  constructor(message: string, public readonly index: number | null = null) {
    super(message);
    this.name = "PickupChargeError";
  }
  toJSON() {
    return { success: false, code: this.code, message: this.message, ...(this.index != null && { index: this.index }) };
  }
}

function parseAmount(raw: unknown, index: number): Decimal {
  const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new PickupChargeError(`Charge ${index + 1}: enter the amount in ₹ with up to 2 decimals.`, index);
  }
  const amount = new Decimal(text);
  if (amount.lte(0)) throw new PickupChargeError(`Charge ${index + 1}: the amount must be more than ₹0.`, index);
  if (amount.gt(PICKUP_CHARGE_AMOUNT_MAX)) {
    throw new PickupChargeError(`Charge ${index + 1}: the amount can't be more than ₹${PICKUP_CHARGE_AMOUNT_MAX.toFixed(0)}.`, index);
  }
  return amount.toDecimalPlaces(2);
}

function parseLabel(raw: unknown, index: number): string {
  const label = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!label) throw new PickupChargeError(`Charge ${index + 1}: say what the charge is for.`, index);
  if (label.length > PICKUP_CHARGE_LABEL_MAX) {
    throw new PickupChargeError(`Charge ${index + 1}: keep the reason under ${PICKUP_CHARGE_LABEL_MAX} characters.`, index);
  }
  return label;
}

/**
 * The charges sent with a request. undefined = not sent (older builds: nothing
 * changes); [] / null = none (clears them). Each line `{ label, amount }`
 * (`reason` / `description` accepted for `label`). 400 PICKUP_CHARGES_INVALID.
 */
export function parsePickupOtherCharges(raw: unknown): PickupOtherCharge[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new PickupChargeError("Other charges must be a list.");
  if (raw.length > PICKUP_CHARGE_MAX_LINES) {
    throw new PickupChargeError(`Add at most ${PICKUP_CHARGE_MAX_LINES} other charges.`);
  }
  return raw.map((line, i) => {
    if (!line || typeof line !== "object") throw new PickupChargeError(`Charge ${i + 1} is not valid.`, i);
    const l = line as Record<string, unknown>;
    return { label: parseLabel(l.label ?? l.reason ?? l.description, i), amount: parseAmount(l.amount, i) };
  });
}

/** A live ledger line read back as a charge (label = description). */
export interface PickupChargeLine {
  publicId: string;
  description: string;
  amount: { toString(): string };
  entryType: string;
  referenceType: string | null;
  isVoided?: boolean | null;
}

/** The live pickup other-charge lines of a session's entries, in the order they were added. */
export function pickupChargeLines<T extends PickupChargeLine>(entries: T[]): T[] {
  return entries.filter(
    (e) => !e.isVoided && String(e.entryType) === "DAMAGE" && e.referenceType === PICKUP_OTHER_CHARGE_REF,
  );
}

/** Same labels and amounts in the same order — replacing would change nothing. */
export function sameCharges(current: PickupChargeLine[], next: PickupOtherCharge[]): boolean {
  if (current.length !== next.length) return false;
  return current.every((c, i) => {
    const n = next[i]!;
    return c.description === n.label && new Decimal(c.amount.toString()).eq(n.amount);
  });
}

/** Σ of the charges, 2 dp. */
export function pickupChargesTotal(lines: Array<{ amount: { toString(): string } | Decimal }>): Decimal {
  return lines.reduce<Decimal>((s, l) => s.add(new Decimal(l.amount.toString())), new Decimal(0)).toDecimalPlaces(2);
}

/** The charges as the session serializers return them (additive field). */
export function pickupChargesView(entries: PickupChargeLine[]) {
  const lines = pickupChargeLines(entries);
  return {
    otherCharges: lines.map((l) => ({
      publicId: l.publicId,
      label: l.description,
      amount: new Decimal(l.amount.toString()).toFixed(2),
    })),
    otherChargesTotal: pickupChargesTotal(lines).toFixed(2),
  };
}
