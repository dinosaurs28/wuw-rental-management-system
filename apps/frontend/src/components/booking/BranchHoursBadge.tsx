import { Clock } from "lucide-react";
import {
  formatScheduleTime,
  istTodayCalendarDay,
  nextOpeningAfterClosedDay,
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

/** One-line office hours for a picked date, e.g. "9:00 AM – 10:00 PM +30min grace". */
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

  const dow = date.getDay();
  const row = schedule.schedules.find((s) => s.dayOfWeek === dow);

  if (!row) return null;

  // Closed all day, or today after closing: say when it opens next
  const opensNext = nextOpeningAfterClosedDay(schedule, date);
  const isToday =
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() ===
    istTodayCalendarDay().getTime();

  if (!row.isOpen || opensNext) {
    return (
      <p className={cn(base, "text-red-500")}>
        <Clock className="size-3 shrink-0" />
        {isToday ? "Branch closed today" : "Branch closed this day"}
        {opensNext && <span className="text-zinc-400">· opens {opensNext}</span>}
      </p>
    );
  }

  return (
    <p className={cn(base, "text-zinc-400")}>
      <Clock className="size-3 shrink-0" />
      {formatScheduleTime(row.openTime)} – {formatScheduleTime(row.closeTime)}
      {kind !== "pickup" && schedule.graceMinutes > 0 && (
        <span className="text-zinc-300">+{schedule.graceMinutes}min grace</span>
      )}
    </p>
  );
};
