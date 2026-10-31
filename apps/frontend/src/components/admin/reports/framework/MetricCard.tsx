import { Link } from "react-router-dom";
import { ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ComparisonBadge } from "./ComparisonBadge";
import type { Delta, ValueFormat } from "./types";
import { formatValue } from "./format";

export interface ReportMetricCardProps {
  label: string;
  value: number | string | null | undefined;
  format?: ValueFormat;
  delta?: Delta | null;
  compareLabel?: string;
  /** Lower is better (dues, overdue …). */
  invert?: boolean;
  /** Click-through target (path + search). */
  to?: string;
  hint?: string;
  /** Data the system doesn't record — shows "Not tracked yet" + the note. */
  notTracked?: string;
  tone?: "default" | "warning" | "danger" | "success";
  loading?: boolean;
  className?: string;
  testId?: string;
}

const toneRing: Record<NonNullable<ReportMetricCardProps["tone"]>, string> = {
  default: "border-neutral-200",
  warning: "border-amber-300 bg-amber-50/40",
  danger: "border-rose-300 bg-rose-50/40",
  success: "border-emerald-300 bg-emerald-50/40",
};

/** Summary metric with optional previous-period delta and click-through. */
export const MetricCard = ({
  label,
  value,
  format = "number",
  delta,
  compareLabel,
  invert,
  to,
  hint,
  notTracked,
  tone = "default",
  loading,
  className,
  testId,
}: ReportMetricCardProps) => {
  const body = (
    <div
      className={cn(
        "group h-full rounded-xl border bg-white p-4 shadow-sm transition-colors",
        toneRing[tone],
        to && "hover:border-[#FF5F00]/60",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
        {to && <ChevronRight className="h-4 w-4 text-neutral-300 group-hover:text-[#FF5F00]" aria-hidden />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-28" />
      ) : notTracked ? (
        <div className="mt-2">
          <p className="text-lg font-semibold text-neutral-400">Not tracked yet</p>
          <p className="mt-1 flex gap-1 text-xs text-neutral-500">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {notTracked}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900" data-testid={testId ? `${testId}-value` : undefined}>
          {formatValue(value, format)}
        </p>
      )}
      {!loading && !notTracked && delta !== undefined && (
        <ComparisonBadge delta={delta} label={compareLabel} invert={invert} format={format} className="mt-1" />
      )}
      {!loading && hint && !notTracked && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5F00] rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
};
