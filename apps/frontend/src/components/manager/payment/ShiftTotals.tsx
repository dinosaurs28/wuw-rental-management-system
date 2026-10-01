import type { ReactNode } from "react";

import type { ShiftDayTotals } from "@/services/payment.service";
import { VARIANCE_TONE_CLASSES, describeVariance, formatMoney, toPaise } from "./cashShiftFormat";

/** Signed, coloured variance; "—" when there is none (an OPEN shift). */
export function VarianceValue({ value }: { value: string | null | undefined }) {
  const v = describeVariance(value);
  if (!v) return <span className="text-neutral-300">—</span>;
  return <span className={`font-semibold tabular-nums ${VARIANCE_TONE_CLASSES[v.tone]}`}>{v.text}</span>;
}

function TotalsTile({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${valueClass ?? "text-neutral-900"}`}>{value}</p>
      {sub && <div className="mt-0.5 text-[11px] text-neutral-500">{sub}</div>}
    </div>
  );
}

/** Totals over a whole shift filter (every page). Counted cash and variance cover closed shifts only. */
export function TotalsStrip({ totals }: { totals: ShiftDayTotals }) {
  const ended = totals.closedCount + totals.flaggedCount;
  // Old-rule closes are left out of the variance sum
  const legacy = totals.legacyCount ?? 0;
  const variance = describeVariance(ended - legacy > 0 ? totals.variance : null);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <TotalsTile
        label="Shifts"
        value={String(totals.shiftCount)}
        sub={`${totals.openCount} open · ${totals.closedCount} closed · ${totals.flaggedCount} flagged`}
      />
      <TotalsTile label="Opening cash" value={formatMoney(totals.openingCash)} />
      <TotalsTile
        label="Cash collected"
        value={formatMoney(totals.cashCollected)}
        sub={
          toPaise(totals.pendingCash) > 0 ? (
            <span className="font-medium text-amber-700">{formatMoney(totals.pendingCash)} pending confirmation</span>
          ) : undefined
        }
      />
      <TotalsTile label="Cash refunded" value={formatMoney(totals.cashRefunded)} />
      <TotalsTile label="Expected in drawer" value={formatMoney(totals.expectedClosing)} />
      <TotalsTile
        label="Counted at close"
        value={ended > 0 ? formatMoney(totals.closingCash) : "—"}
        sub="Closed shifts only"
      />
      <TotalsTile
        label="Variance"
        value={variance ? variance.text : "—"}
        valueClass={variance ? VARIANCE_TONE_CLASSES[variance.tone] : "text-neutral-400"}
        sub={
          legacy > 0
            ? `Closed shifts only · leaves out ${legacy} closed under the old rule`
            : "Closed shifts only"
        }
      />
      <TotalsTile label="UPI collected" value={formatMoney(totals.upiCollected)} sub="Not in the drawer" />
    </div>
  );
}
