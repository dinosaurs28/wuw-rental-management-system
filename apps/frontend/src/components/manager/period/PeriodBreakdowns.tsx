import { Clock3, Store } from "lucide-react";
import type {
  PeriodRentalBreakdownRow,
  PeriodSourceRow,
} from "@/services/managerPeriodReport.service";
import { formatCount, formatInr } from "./periodRange";

// Chart hues (validated categorical slots 1 and 2); text never wears them.
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"] as const;

function ShareMeter({ pct, color }: { pct: number; color: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
    </div>
  );
}

export function RentalPeriodBreakdown({ rows }: { rows: PeriodRentalBreakdownRow[] }) {
  const totalBookings = rows.reduce((s, r) => s + r.bookings, 0);
  const totalValue = rows.reduce((s, r) => s + r.bookingValue, 0);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="px-5 pt-4 pb-3 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-orange-500" />
          <h2 className="text-base font-semibold text-neutral-900">By rental period</h2>
        </div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Bookings starting in this period, grouped by their current length (after extensions).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400">
              <th className="px-5 py-2.5 font-semibold">Period</th>
              <th className="px-3 py-2.5 font-semibold text-right">Bookings</th>
              <th className="px-3 py-2.5 font-semibold text-right">Value</th>
              <th className="px-3 py-2.5 font-semibold text-right">Avg value</th>
              <th className="px-5 py-2.5 font-semibold w-[28%] min-w-[140px]">Share of value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type} className="border-t border-neutral-100">
                <td className="px-5 py-2.5 font-medium text-neutral-800 whitespace-nowrap">
                  {r.label}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                  {formatCount(r.bookings)}
                  <span className="ml-1 text-[11px] text-neutral-400">
                    ({r.bookingsSharePct.toFixed(1)}%)
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700 whitespace-nowrap">
                  {formatInr(r.bookingValue)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 whitespace-nowrap">
                  {r.bookings > 0 ? formatInr(r.averageValue) : "—"}
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <ShareMeter pct={r.valueSharePct} color={SERIES_COLORS[0]} />
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                      {r.valueSharePct.toFixed(1)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-200 bg-neutral-50/70 font-semibold text-neutral-800">
              <td className="px-5 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(totalBookings)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                {formatInr(Math.round(totalValue * 100) / 100)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 whitespace-nowrap">
                {totalBookings > 0
                  ? formatInr(Math.round((totalValue / totalBookings) * 100) / 100)
                  : "—"}
              </td>
              <td className="px-5 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 py-3 text-[11px] text-neutral-400 border-t border-neutral-100">
        Hourly ≤ 1 h · 12 hours ≤ 12 h · 1 day ≤ 24 h · Multi-day beyond that · Monthly = monthly
        plan or 30+ billable days.
      </p>
    </div>
  );
}

/** Online vs Counter: a two-segment split bar per measure, plus the figures. */
export function SourceBreakdown({ rows }: { rows: PeriodSourceRow[] }) {
  const measures: { key: "bookings" | "value"; label: string }[] = [
    { key: "bookings", label: "Bookings" },
    { key: "value", label: "Booking value" },
  ];
  const anyData = rows.some((r) => r.bookings > 0);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm h-full flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-orange-500" />
          <h2 className="text-base font-semibold text-neutral-900">Online vs counter</h2>
        </div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Online = booked by the customer on the website or app. Counter = created by staff or a
          manager (walk-in).
        </p>
      </div>

      <div className="px-5 py-4 space-y-4 flex-1">
        {/* Legend (identity is never colour-only: every figure below is labelled too). */}
        <div className="flex items-center gap-4 text-xs text-neutral-600">
          {rows.map((r, i) => (
            <span key={r.source} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: SERIES_COLORS[i] }}
                aria-hidden
              />
              {r.label}
            </span>
          ))}
        </div>

        {measures.map((m) => (
          <div key={m.key} className="space-y-1.5">
            <p className="text-xs font-medium text-neutral-500">{m.label}</p>
            {anyData ? (
              <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-neutral-100">
                {rows.map((r, i) => {
                  const pct = m.key === "bookings" ? r.bookingsSharePct : r.valueSharePct;
                  return pct > 0 ? (
                    <div
                      key={r.source}
                      className="h-full first:rounded-l-full last:rounded-r-full"
                      style={{ width: `${pct}%`, backgroundColor: SERIES_COLORS[i] }}
                      title={`${r.label}: ${pct.toFixed(1)}%`}
                    />
                  ) : null;
                })}
              </div>
            ) : (
              <div className="h-3 w-full rounded-full bg-neutral-100" />
            )}
          </div>
        ))}

        <div className="grid grid-cols-2 gap-3 pt-1">
          {rows.map((r) => (
            <div key={r.source} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3">
              <p className="text-xs font-semibold text-neutral-700">{r.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-neutral-900">
                {formatCount(r.bookings)}
                <span className="ml-1 text-xs font-medium text-neutral-400">
                  booking{r.bookings === 1 ? "" : "s"} · {r.bookingsSharePct.toFixed(1)}%
                </span>
              </p>
              <p className="text-sm tabular-nums text-neutral-600">
                {formatInr(r.bookingValue)}
                <span className="ml-1 text-xs text-neutral-400">
                  · {r.valueSharePct.toFixed(1)}% of value
                </span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
