// Display helpers for the discounts the server applies (#20 coupons, #24
// duration slabs). The app never computes a discount — these only name the
// amounts the server sent.

/** "Weekly" → "Weekly discount"; a label that already says "discount" is kept. */
function slabName(label: string | null | undefined): string {
  const l = (label ?? '').trim();
  if (!l) return 'Duration discount';
  return /discount/i.test(l) ? l : `${l} discount`;
}

function pctText(percent: number | null | undefined): string | null {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Number(n.toFixed(2))}%`;
}

/**
 * Label for the duration-slab line, e.g. "Weekly discount (10%)". FLAT slabs
 * are ₹ off per vehicle, so they carry no percent.
 */
export function durationDiscountText(p: {
  durationDiscountLabel?: string | null;
  durationDiscountPercent?: number | null;
  durationDiscountType?: 'PERCENTAGE' | 'FLAT' | null;
}): string {
  const pct = p.durationDiscountType === 'FLAT' ? null : pctText(p.durationDiscountPercent);
  const name = slabName(p.durationDiscountLabel);
  return pct ? `${name} (${pct})` : name;
}

/**
 * The discount lines of a vehicle quote: the named duration slab, and whatever
 * else is in the combined `discountAmount` (a manual/other layer) as "Discount".
 * Falls back to one "Discount" line when the server sent no layer split.
 */
export function quoteDiscountLines(pd: {
  discountAmount: number;
  durationDiscountAmount?: number;
  durationDiscountPercent?: number;
  durationDiscountLabel?: string | null;
  durationDiscountType?: 'PERCENTAGE' | 'FLAT' | null;
}): { label: string; amount: number }[] {
  const total = Number(pd.discountAmount) || 0;
  if (total <= 0) return [];
  const duration = Number(pd.durationDiscountAmount);
  if (!Number.isFinite(duration) || duration <= 0) return [{ label: 'Discount', amount: total }];
  const lines = [{ label: durationDiscountText(pd), amount: duration }];
  const rest = Math.round((total - duration) * 100) / 100;
  if (rest > 0) lines.push({ label: 'Discount', amount: rest });
  return lines;
}

/** Listing chip for a slab already inside the dated price, e.g. "Weekly −10%". */
export function slabChipText(info: { discountLabel?: string | null; discountPercent?: number | null } | null | undefined): string | null {
  if (!info || info.discountPercent == null) return null;
  const pct = pctText(info.discountPercent);
  if (!pct) return null;
  const label = (info.discountLabel ?? '').trim();
  return label ? `${label} −${pct}` : `−${pct}`;
}

/** Why a counter coupon came out smaller than its face value. */
export function counterCouponCapNote(cappedBy: 'OWED' | 'COMBINED_CAP' | null | undefined): string | null {
  if (cappedBy === 'OWED') return 'Limited to the rental still due at this pickup.';
  if (cappedBy === 'COMBINED_CAP') return "Reduced to the branch's maximum total discount.";
  return null;
}
