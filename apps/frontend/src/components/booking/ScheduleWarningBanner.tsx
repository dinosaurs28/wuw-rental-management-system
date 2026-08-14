import { AlertTriangle, Clock, XCircle, RefreshCw } from "lucide-react";
import type { ScheduleVerdict } from "@/utils/branchScheduleValidator";

interface ScheduleWarningBannerProps {
  verdict: ScheduleVerdict | null;
}

export const ScheduleWarningBanner = ({ verdict }: ScheduleWarningBannerProps) => {
  if (!verdict || verdict.status === "OK") return null;

  // ── Pickup blocked ─────────────────────────────────────────────────────────
  if (verdict.status === "PICKUP_CLOSED_DAY") {
    return (
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3.5 text-red-800">
        <XCircle className="size-4 shrink-0 mt-0.5 text-red-500" />
        <div className="text-sm">
          <span className="font-semibold">Branch closed — </span>
          Branch is closed on{" "}
          <span className="font-semibold">{verdict.closedDayName}</span>. Please
          select a different pickup date.
        </div>
      </div>
    );
  }

  if (verdict.status === "PICKUP_BEFORE_OPEN") {
    return (
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3.5 text-red-800">
        <XCircle className="size-4 shrink-0 mt-0.5 text-red-500" />
        <div className="text-sm">
          <span className="font-semibold">Too early — </span>
          Branch opens at{" "}
          <span className="font-semibold">{verdict.openingTime}</span>. Please
          select a later pickup time.
        </div>
      </div>
    );
  }

  if (verdict.status === "PICKUP_AT_OR_AFTER_CLOSE") {
    return (
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3.5 text-red-800">
        <XCircle className="size-4 shrink-0 mt-0.5 text-red-500" />
        <div className="text-sm">
          <span className="font-semibold">Too late — </span>
          Pickup cannot be at or after closing time (
          <span className="font-semibold">{verdict.closingTime}</span>). Please
          select an earlier time.
        </div>
      </div>
    );
  }

  if (verdict.status === "NO_OPEN_DAY_IN_WINDOW") {
    return (
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3.5 text-red-800">
        <XCircle className="size-4 shrink-0 mt-0.5 text-red-500" />
        <div className="text-sm">
          <span className="font-semibold">No return window — </span>
          No available return slot in the next 7 days. Please contact the branch
          directly.
        </div>
      </div>
    );
  }

  // ── Return grace ───────────────────────────────────────────────────────────
  if (verdict.status === "RETURN_GRACE") {
    return (
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3.5 text-amber-800">
        <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-500" />
        <div className="text-sm">
          <span className="font-semibold">Within grace window — </span>
          Branch closes at{" "}
          <span className="font-semibold">{verdict.closingTime}</span>; grace
          period until{" "}
          <span className="font-semibold">{verdict.gracePeriodEnd}</span>. Your
          booking is accepted but late returns may incur extra charges.
        </div>
      </div>
    );
  }

  // ── Return bumped ──────────────────────────────────────────────────────────
  if (verdict.status === "RETURN_BUMPED") {
    const reason = verdict.closedDayName
      ? `Branch is closed on ${verdict.closedDayName}.`
      : `Return time is after closing (${verdict.closingTime}).`;

    return (
      <div className="flex items-start gap-3 bg-amber-950/70 border border-amber-800/60 rounded-xl px-4 py-4 text-amber-200">
        <RefreshCw className="size-4 shrink-0 mt-0.5 text-amber-400" strokeWidth={2.2} />
        <div className="text-sm space-y-0.5">
          <p className="font-bold text-amber-100 uppercase tracking-wide text-xs">
            Return time adjusted — booking extended to 24 hrs
          </p>
          <p className="text-amber-300/90">
            {reason} Your booking is now priced as a 24-hour rental.
          </p>
          <p className="flex items-center gap-1.5 text-amber-100 font-semibold">
            <Clock className="size-3.5 shrink-0" />
            New return: {verdict.nextOpenLabel}
          </p>
        </div>
      </div>
    );
  }

  return null;
};
