import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Delta, ValueFormat } from "./types";
import { formatValue } from "./format";

export interface ComparisonBadgeProps {
  delta: Delta | null | undefined;
  /** e.g. "vs last week" — from the API's previous.label. */
  label?: string;
  /** True when a lower value is better (costs, dues, overdue). */
  invert?: boolean;
  /** Format of the absolute change. */
  format?: ValueFormat;
  className?: string;
}

/**
 * Absolute + % change vs the previous period (spec §9.3). When the previous
 * value is 0 the % is unknown and shown as "new" instead of a fake 100%.
 */
export const ComparisonBadge = ({ delta, label, invert = false, format = "number", className }: ComparisonBadgeProps) => {
  if (!delta || delta.direction === null) {
    return <span className={cn("text-xs text-neutral-400", className)}>No comparison data</span>;
  }
  const good = delta.direction === "flat" ? null : (delta.direction === "up") !== invert;
  const tone =
    good === null
      ? "bg-neutral-100 text-neutral-600"
      : good
        ? "bg-emerald-50 text-emerald-700"
        : "bg-rose-50 text-rose-700";
  const Icon = delta.direction === "up" ? ArrowUp : delta.direction === "down" ? ArrowDown : Minus;
  const absText =
    delta.abs === null ? "" : `${delta.abs > 0 ? "+" : delta.abs < 0 ? "−" : ""}${formatValue(Math.abs(delta.abs), format === "percent" ? "number" : format)}${format === "percent" ? " pts" : ""}`;
  const pctText = delta.pct === null ? (delta.previous === 0 && (delta.current ?? 0) !== 0 ? "new" : "") : `${delta.pct > 0 ? "+" : ""}${delta.pct.toFixed(1)}%`;
  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-1 text-xs", className)}
      title={`Previous: ${formatValue(delta.previous, format)}`}
      data-testid="comparison-badge"
    >
      <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium", tone)}>
        <Icon className="h-3 w-3" aria-hidden />
        {pctText || absText || "0"}
      </span>
      {pctText && absText && <span className="text-neutral-500">{absText}</span>}
      {label && <span className="text-neutral-400">{label}</span>}
    </span>
  );
};
