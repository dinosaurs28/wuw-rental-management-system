// Pickup "other charges" (client, Nov 15 2026): on the Payment step staff add
// free-form charges (reason + ₹ amount, several, removable) that the customer
// pays with the pickup bill — no GST, like the drop's other charges. The
// server keeps them on the open bill and always gets the WHOLE set (PUT
// …/pickup-session/other-charges), so going back and forward or retrying never
// adds a charge twice. Pure helpers (no React).
//
//   cd mobile && ../apps/backend/node_modules/.bin/tsx --test lib/pickupCharges.test.ts

/** A charge as typed / kept in the paused draft (amount as text). */
export interface PickupChargeInput {
  label: string;
  amount: string;
}

/** A charge as the pickup bill returns it (session.otherCharges, absent on older servers). */
export interface PickupChargeView {
  publicId?: string;
  label: string;
  amount: string;
}

export const PICKUP_CHARGE_LABEL_MAX = 120;
export const PICKUP_CHARGE_MAX_LINES = 20;
export const PICKUP_CHARGE_AMOUNT_MAX = 500000;

/** Keeps only what a ₹ amount may hold while typing: digits and one dot with 2 decimals. */
export function cleanChargeAmount(text: string): string {
  const digits = text.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = digits.split('.');
  if (rest.length === 0) return whole;
  return `${whole}.${rest.join('').slice(0, 2)}`;
}

/** Why a new charge can't be added yet (null = fine). */
export function chargeInputError(label: string, amount: string, count: number): string | null {
  if (count >= PICKUP_CHARGE_MAX_LINES) return `Add at most ${PICKUP_CHARGE_MAX_LINES} other charges.`;
  const l = label.trim();
  if (!l) return 'Say what the charge is for.';
  if (l.length > PICKUP_CHARGE_LABEL_MAX) return `Keep the reason under ${PICKUP_CHARGE_LABEL_MAX} characters.`;
  if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) return 'Enter the amount in ₹ (up to 2 decimals).';
  const n = Number(amount);
  if (!(n > 0)) return 'The amount must be more than ₹0.';
  if (n > PICKUP_CHARGE_AMOUNT_MAX) return `The amount can't be more than ₹${PICKUP_CHARGE_AMOUNT_MAX}.`;
  return null;
}

/** The request body lines (amounts as numbers, 2 dp). */
export function chargesBody(list: PickupChargeInput[]): { label: string; amount: number }[] {
  return list.map((c) => ({ label: c.label.trim().replace(/\s+/g, ' '), amount: Math.round(Number(c.amount) * 100) / 100 }));
}

/** The bill's charges as draft inputs ("250.00" → "250"). */
export function chargesFromSession(list: PickupChargeView[] | undefined | null): PickupChargeInput[] {
  return (list ?? []).map((c) => ({ label: c.label, amount: String(Number(c.amount) || 0) }));
}

/** Same reasons and amounts in the same order. */
export function sameCharges(a: PickupChargeInput[], b: PickupChargeInput[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((c, i) => c.label.trim() === b[i]!.label.trim() && Number(c.amount) === Number(b[i]!.amount));
}

/** Σ of the charges in ₹, 2 dp. */
export function chargesTotal(list: PickupChargeInput[]): number {
  return Math.round(list.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100) / 100;
}

/** The charges kept in a paused draft (anything malformed is left out; absent in older drafts). */
export function draftCharges(data: Record<string, unknown> | null | undefined): PickupChargeInput[] {
  const raw = data?.otherCharges;
  if (!Array.isArray(raw)) return [];
  const out: PickupChargeInput[] = [];
  for (const item of raw.slice(0, PICKUP_CHARGE_MAX_LINES)) {
    if (!item || typeof item !== 'object') continue;
    const { label, amount } = item as Record<string, unknown>;
    const a = typeof amount === 'number' ? String(amount) : typeof amount === 'string' ? amount : '';
    if (typeof label === 'string' && label.trim() && Number(a) > 0) out.push({ label, amount: a });
  }
  return out;
}
