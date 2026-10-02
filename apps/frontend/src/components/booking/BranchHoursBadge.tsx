import { Clock } from "lucide-react";
import {
  calendarDayWindow,
  formatScheduleTime,
  istTodayCalendarDay,
  minutesToDisplay,
  nextOpeningAfterClosedDay,
  scheduleRowForDay,
} from "@/utils/branchScheduleValidator";
import type { BranchScheduleConfig } from "@/services/branch.service";
import { cn } from "@/lib/utils";

interface BranchHoursBadgeProps {
  schedule: BranchScheduleConfig | undefined;
  /** The picked calendar day. */
  date: Date | null;
  /** "pickup" hides the return grace window (it only applies to returns). */
  kind?: "pickup" | "return";
  className?: string;
}

/**
 * One-line office hours for a picked date (the saved hours, or the default
 * 8:00 AM – 11:00 PM), e.g. "9:00 AM – 10:00 PM +30min grace" for a return or
 * "8:00 AM – 11:00 PM · last pickup 10:30 PM" for a pickup.
 */
export const BranchHoursBadge = ({ schedule, date, kind, className }: BranchHoursBadgeProps) => {
  if (!schedule || !date) return null;
  const base = cn("flex items-center gap-1.5 mt-1.5 text-[11px] font-medium", className);
  if (schedule.is24Hours) {
    return (
      <p className={cn(base, "text-emerald-600")}>
        <Clock className="size-3 shrink-0" />
        Open 24 hours
      </p>
    );
  }

  const row = scheduleRowForDay(schedule, date.getDay());
  const lastPickupMin = calendarDayWindow(schedule, date)?.lastPickupMin;

  // Closed all day, or today after closing (pickup: after the last pickup): say when it opens next
  const opensNext = nextOpeningAfterClosedDay(schedule, date, new Date(), { pickup: kind === "pickup" });
  const isToday =
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() ===
    istTodayCalendarDay().getTime();

  if (!row.isOpen || opensNext) {
    // Still open for returns, but the last pickup has gone by
    const pickupsOver = row.isOpen && kind === "pickup";
    return (
      <p className={cn(base, "text-red-500")}>
        <Clock className="size-3 shrink-0" />
        {pickupsOver
          ? "No more pickups today"
          : isToday
            ? "Branch closed today"
            : "Branch closed this day"}
        {opensNext && <span className="text-zinc-400">· opens {opensNext}</span>}
      </p>
    );
  }

  return (
    <p className={cn(base, "text-zinc-400")}>
      <Clock className="size-3 shrink-0" />
      {formatScheduleTime(row.openTime)} – {formatScheduleTime(row.closeTime)}
      {kind === "pickup" && lastPickupMin !== undefined && (
        <span className="text-zinc-300">· last pickup {minutesToDisplay(lastPickupMin)}</span>
      )}
      {kind !== "pickup" && schedule.graceMinutes > 0 && (
        <span className="text-zinc-300">+{schedule.graceMinutes}min grace</span>
      )}
    </p>
  );
};
