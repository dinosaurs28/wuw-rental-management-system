// FASTag balance read at pickup and at the drop (Oct 15 2026): for a car with a
// FASTag, staff read the tag's balance at the handover and again when it comes
// back; the drop bill charges the usage in between (no GST). Mirrors
// packages/schemas/src/fastag.ts — 0 … 1,00,000 with at most 2 decimals.

export const FASTAG_BALANCE_MAX = 100000;

/** A FASTag balance typed in rupees, else null. */
export function parseFastagBalance(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= FASTAG_BALANCE_MAX ? n : null;
}

/** Why the typed balance can't be used (blank = not entered yet); null when it can. */
export function fastagBalanceError(raw: string): string | null {
  if (!raw.trim()) return 'Enter the FASTag balance.';
  return parseFastagBalance(raw) == null ? 'Enter an amount like 250 or 250.50 (up to ₹1,00,000).' : null;
}

/** Digits and the decimal point only, while typing. */
export const cleanFastagInput = (t: string) => t.replace(/[^0-9.]/g, '');

/** ₹480 / ₹480.50 for a balance from the server ("480.00") or typed. */
export function fastagInr(value: string | number | null | undefined): string {
  const n = Number(value ?? 0) || 0;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
