import type { ComponentType, ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  CalendarCheck,
  Hourglass,
  IndianRupee,
  Minus,
  Repeat2,
  RotateCcw,
  Sparkles,
  Undo2,
  Wallet,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PeriodReport } from "@/services/managerPeriodReport.service";
import { formatCount, formatInr, formatYmdRange } from "./periodRange";

interface DeltaProps {
  change: number | null;
  /** true when a rise is bad news (outstanding, cancellations, refunds). */
  riseIsBad?: boolean;
}

/** % change vs the previous window — arrow + text, never colour alone. */
function Delta({ change, riseIsBad = false }: DeltaProps) {
  if (change === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
        <Sparkles className="h-3 w-3" />
        New
      </span>
    );
  }
  if (change === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
        <Minus className="h-3 w-3" />
        No change
      </span>
    );
  }
  const up = change > 0;
  const good = riseIsBad ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
      )}
    >
      <Icon className="h-3 w-3" />
      {up ? "+" : "−"}
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

interface KpiCardProps {
  title: string;
  icon: ComponentType<{ className?: string }>;
  value: string;
  /** What population / date this figure is counted on. */
  countedBy: string;
  details?: ReactNode;
  change: number | null;
  previousValue: string;
  riseIsBad?: boolean;
}

function KpiCard({
  title,
  icon: Icon,
  value,
  countedBy,
  details,
  change,
  previousValue,
  riseIsBad,
}: KpiCardProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-700">{title}</p>
          <p className="text-[11px] text-neutral-400 leading-snug mt-0.5">{countedBy}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50">
          <Icon className="h-4 w-4 text-orange-500" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-neutral-900 tabular-nums">{value}</p>
      {details && <div className="mt-1 text-xs text-neutral-500 space-y-0.5">{details}</div>}
      <div className="mt-auto pt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Delta change={change} riseIsBad={riseIsBad} />
        <span className="text-[11px] text-neutral-400 tabular-nums">prev {previousValue}</span>
      </div>
    </div>
  );
}

export function PeriodKpiGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36 mt-1.5" />
          <Skeleton className="h-7 w-24 mt-4" />
          <Skeleton className="h-3 w-32 mt-2" />
          <Skeleton className="h-5 w-20 mt-4 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function PeriodKpiGrid({ report }: { report: PeriodReport }) {
  const { summary: s, previous: p, change: c, range } = report;

  return (
    <section aria-label="Key figures" className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          title="Bookings"
          icon={CalendarCheck}
          value={formatCount(s.bookings)}
          countedBy="Starting in this period (confirmed, active, completed)"
          details={<p>Avg {formatInr(s.averageBookingValue)} per booking</p>}
          change={c.bookings}
          previousValue={formatCount(p.bookings)}
        />
        <KpiCard
          title="Booking value"
          icon={IndianRupee}
          value={formatInr(s.bookingValue)}
          countedBy="Same bookings · incl. confirmed extensions"
          details={
            s.depositsInBookingValue > 0 ? (
              <p>incl. {formatInr(s.depositsInBookingValue)} refundable deposit</p>
            ) : (
              <p>No refundable deposit included</p>
            )
          }
          change={c.bookingValue}
          previousValue={formatInr(p.bookingValue)}
        />
        <KpiCard
          title="Collected"
          icon={Wallet}
          value={formatInr(s.collected.total)}
          countedBy="Payments received in this period · any booking"
          details={
            <>
              <p>
                Cash {formatInr(s.collected.cash)} · Online {formatInr(s.collected.online)}
              </p>
              <p className="text-neutral-400">
                UPI {formatInr(s.collected.upi)} · Gateway {formatInr(s.collected.gateway)} ·{" "}
                {formatCount(s.collected.payments)} payment{s.collected.payments === 1 ? "" : "s"}
              </p>
            </>
          }
          change={c.collected}
          previousValue={formatInr(p.collected.total)}
        />
        <KpiCard
          title="Outstanding"
          icon={Hourglass}
          value={formatInr(s.outstanding)}
          countedBy="Still owed on this period's bookings, as of now"
          details={
            <p>
              {formatCount(s.outstandingBookings)} booking{s.outstandingBookings === 1 ? "" : "s"}{" "}
              with a balance
            </p>
          }
          change={c.outstanding}
          previousValue={formatInr(p.outstanding)}
          riseIsBad
        />
        <KpiCard
          title="Cancellations"
          icon={Ban}
          value={formatCount(s.cancellations.count)}
          countedBy="By cancellation date"
          details={<p>{formatInr(s.cancellations.fees)} in cancellation fees</p>}
          change={c.cancellations}
          previousValue={formatCount(p.cancellations.count)}
          riseIsBad
        />
        <KpiCard
          title="Returns"
          icon={Undo2}
          value={formatCount(s.returns.count)}
          countedBy="Vehicles returned in this period"
          change={c.returns}
          previousValue={formatCount(p.returns.count)}
        />
        <KpiCard
          title="Extensions"
          icon={Repeat2}
          value={formatCount(s.extensions.count)}
          countedBy="Confirmed · by request date"
          details={
            <>
              <p>{formatInr(s.extensions.amount)} incl. GST</p>
              {s.extensions.count > 0 && (
                <p className="text-neutral-400">
                  Taxable {formatInr(s.extensions.taxableAmount)} · CGST{" "}
                  {formatInr(s.extensions.cgstAmount)} · SGST {formatInr(s.extensions.sgstAmount)}
                </p>
              )}
            </>
          }
          change={c.extensions}
          previousValue={formatCount(p.extensions.count)}
        />
        <KpiCard
          title="Refunds paid"
          icon={RotateCcw}
          value={formatInr(s.refunds.amount)}
          countedBy="Completed in this period"
          details={
            <p>
              {formatCount(s.refunds.count)} refund{s.refunds.count === 1 ? "" : "s"} completed
            </p>
          }
          change={c.refundAmount}
          previousValue={formatInr(p.refunds.amount)}
          riseIsBad
        />
      </div>
      <p className="text-xs text-neutral-400">
        Changes compare with {formatYmdRange(range.previous.from, range.previous.to)}, the{" "}
        {range.days} day{range.days === 1 ? "" : "s"} just before this period. “New” means there
        was nothing to compare with.
      </p>
    </section>
  );
}
