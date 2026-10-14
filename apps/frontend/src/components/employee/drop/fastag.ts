import { fastagBalanceSchema } from "@repo/schemas";

/**
 * FASTag balance typed by staff (Oct 15 2026): read at pickup and at the drop
 * for a car with a FASTag; the drop bill charges the usage in between (no GST).
 * Same rule as the server: 0 … 1,00,000 with at most 2 decimals.
 */
export function readFastagBalance(raw: string): { value: number | null; error: string | null } {
  if (!raw.trim()) return { value: null, error: "Enter the FASTag balance." };
  const parsed = fastagBalanceSchema.safeParse(raw.trim());
  if (!parsed.success || parsed.data === undefined) {
    return { value: null, error: parsed.success ? "Enter the FASTag balance." : parsed.error.issues[0]?.message ?? "Check the FASTag balance." };
  }
  return { value: parsed.data, error: null };
}

/** ₹480 / ₹480.50 for a balance from the server ("480.00") or typed. */
export function fastagInr(value: string | number | null | undefined): string {
  const n = Number(value ?? 0) || 0;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
