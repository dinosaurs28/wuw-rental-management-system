import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { BarChart3, Download, Loader2, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PeriodTrendPoint } from "@/services/managerPeriodReport.service";
import { SERIES_COLORS } from "./PeriodBreakdowns";
import { formatCount, formatInr, formatInrCompact, formatYmdRange } from "./periodRange";

type Mode = "value" | "count";

// One unit per chart (never two y-scales): rupees, or counts.
const SERIES: Record<
  Mode,
  { key: keyof PeriodTrendPoint; label: string; color: string; money: boolean }[]
> = {
  value: [
    { key: "bookingValue", label: "Booking value", color: SERIES_COLORS[0], money: true },
    { key: "collected", label: "Collected", color: SERIES_COLORS[1], money: true },
  ],
  count: [
    { key: "bookings", label: "Bookings", color: SERIES_COLORS[0], money: false },
    { key: "returns", label: "Returns", color: SERIES_COLORS[1], money: false },
    { key: "cancellations", label: "Cancellations", color: SERIES_COLORS[2], money: false },
  ],
};

const GROUP_LABEL = { day: "day", week: "week", month: "month" } as const;

function TrendTooltip({ active, payload, mode }: TooltipProps<number, string> & { mode: Mode }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as PeriodTrendPoint;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-md text-xs min-w-[180px]">
      <p className="font-semibold text-neutral-800">{point.label}</p>
      {point.from !== point.to && (
        <p className="text-[11px] text-neutral-400">{formatYmdRange(point.from, point.to)}</p>
      )}
      <div className="mt-1.5 space-y-1">
        {SERIES[mode].map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-neutral-600">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold tabular-nums text-neutral-900">
              {s.money ? formatInr(point[s.key] as number) : formatCount(point[s.key] as number)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-neutral-100 space-y-0.5 text-neutral-500">
        {mode === "value" ? (
          <>
            <p className="tabular-nums">
              Cash {formatInr(point.cash)} · Online {formatInr(point.online)}
            </p>
            <p className="tabular-nums">{formatCount(point.bookings)} bookings starting</p>
          </>
        ) : (
          <p className="tabular-nums">
            {formatCount(point.extensions)} extension{point.extensions === 1 ? "" : "s"} ·{" "}
            {formatCount(point.refunds)} refund{point.refunds === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </div>
  );
}

interface PeriodTrendCardProps {
  trend: PeriodTrendPoint[];
  groupBy: "day" | "week" | "month";
  onDownload: () => void;
  downloading: boolean;
}

export function PeriodTrendCard({ trend, groupBy, onDownload, downloading }: PeriodTrendCardProps) {
  const [mode, setMode] = useState<Mode>("value");
  const [showTable, setShowTable] = useState(false);
  const series = SERIES[mode];
  const isEmpty = trend.every((t) => series.every((s) => !(t[s.key] as number)));

  const totals = trend.reduce(
    (acc, t) => {
      acc.bookings += t.bookings;
      acc.bookingValue += t.bookingValue;
      acc.collected += t.collected;
      acc.cash += t.cash;
      acc.online += t.online;
      acc.cancellations += t.cancellations;
      acc.returns += t.returns;
      acc.extensions += t.extensions;
      acc.extensionAmount += t.extensionAmount;
      acc.refunds += t.refunds;
      acc.refundAmount += t.refundAmount;
      return acc;
    },
    {
      bookings: 0,
      bookingValue: 0,
      collected: 0,
      cash: 0,
      online: 0,
      cancellations: 0,
      returns: 0,
      extensions: 0,
      extensionAmount: 0,
      refunds: 0,
      refundAmount: 0,
    },
  );
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="px-5 pt-4 pb-3 border-b border-neutral-100 flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-orange-500" />
            <h2 className="text-base font-semibold text-neutral-900">
              Trend by {GROUP_LABEL[groupBy]}
            </h2>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            {mode === "value"
              ? "Booking value by booking start date; collected by payment date."
              : "Bookings by start date, returns by return date, cancellations by cancellation date."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Chart measure"
            className="inline-flex rounded-lg bg-neutral-100 p-0.5"
          >
            {(
              [
                { value: "value", label: "Value (₹)" },
                { value: "count", label: "Counts" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={mode === o.value}
                onClick={() => setMode(o.value)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  mode === o.value
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-800",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
          >
            <Table2 className="h-3.5 w-3.5" />
            {showTable ? "Hide table" : "Show table"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={onDownload}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            CSV
          </Button>
        </div>
      </div>

      <div className="px-3 md:px-5 pt-4 pb-3">
        {/* Legend — always shown for 2+ series */}
        <div className="flex flex-wrap items-center gap-4 px-2 pb-2 text-xs text-neutral-600">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        {isEmpty ? (
          <div className="flex h-[260px] flex-col items-center justify-center text-neutral-400">
            <BarChart3 className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm">Nothing to chart in this period.</p>
          </div>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} barGap={2} barCategoryGap="20%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eeedeb" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: "#d4d4d4" }}
                  tick={{ fontSize: 11, fill: "#737373" }}
                  minTickGap={12}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={mode === "value" ? 60 : 36}
                  allowDecimals={mode === "value"}
                  tick={{ fontSize: 11, fill: "#737373" }}
                  tickFormatter={(v: number) => (mode === "value" ? formatInrCompact(v) : formatCount(v))}
                />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  content={(props) => <TrendTooltip {...(props as TooltipProps<number, string>)} mode={mode} />}
                />
                {series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={s.color}
                    maxBarSize={24}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {showTable && (
        <div className="border-t border-neutral-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400">
                <th className="px-5 py-2.5 font-semibold">Period</th>
                <th className="px-3 py-2.5 font-semibold text-right">Bookings</th>
                <th className="px-3 py-2.5 font-semibold text-right">Booking value</th>
                <th className="px-3 py-2.5 font-semibold text-right">Collected</th>
                <th className="px-3 py-2.5 font-semibold text-right">Cash</th>
                <th className="px-3 py-2.5 font-semibold text-right">Online</th>
                <th className="px-3 py-2.5 font-semibold text-right">Cancelled</th>
                <th className="px-3 py-2.5 font-semibold text-right">Returns</th>
                <th className="px-3 py-2.5 font-semibold text-right">Extensions</th>
                <th className="px-5 py-2.5 font-semibold text-right">Refunds</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.key} className="border-t border-neutral-100 tabular-nums text-neutral-700">
                  <td className="px-5 py-2 whitespace-nowrap font-medium text-neutral-800">{t.label}</td>
                  <td className="px-3 py-2 text-right">{formatCount(t.bookings)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatInr(t.bookingValue)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatInr(t.collected)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-neutral-500">{formatInr(t.cash)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-neutral-500">{formatInr(t.online)}</td>
                  <td className="px-3 py-2 text-right">{formatCount(t.cancellations)}</td>
                  <td className="px-3 py-2 text-right">{formatCount(t.returns)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {formatCount(t.extensions)}
                    {t.extensionAmount > 0 && (
                      <span className="ml-1 text-[11px] text-neutral-400">{formatInr(t.extensionAmount)}</span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right whitespace-nowrap">
                    {formatCount(t.refunds)}
                    {t.refundAmount > 0 && (
                      <span className="ml-1 text-[11px] text-neutral-400">{formatInr(t.refundAmount)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-neutral-200 bg-neutral-50/70 font-semibold text-neutral-800 tabular-nums">
                <td className="px-5 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right">{formatCount(totals.bookings)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatInr(r2(totals.bookingValue))}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatInr(r2(totals.collected))}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatInr(r2(totals.cash))}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatInr(r2(totals.online))}</td>
                <td className="px-3 py-2.5 text-right">{formatCount(totals.cancellations)}</td>
                <td className="px-3 py-2.5 text-right">{formatCount(totals.returns)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {formatCount(totals.extensions)}
                  <span className="ml-1 text-[11px] text-neutral-400">{formatInr(r2(totals.extensionAmount))}</span>
                </td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  {formatCount(totals.refunds)}
                  <span className="ml-1 text-[11px] text-neutral-400">{formatInr(r2(totals.refundAmount))}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
