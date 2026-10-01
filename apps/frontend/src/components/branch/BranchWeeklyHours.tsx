import type { BranchScheduleConfig } from "@/services/branch.service";
import { formatScheduleTime } from "@/utils/branchScheduleValidator";
import { cn } from "@/lib/utils";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
// Week shown Monday first
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** One line per run of consecutive days with the same hours, e.g. "Mon – Sat · 9:00 AM – 10:00 PM". */
function weeklyHoursLines(schedule: BranchScheduleConfig): { days: string; hours: string; closed: boolean }[] {
  const labelFor = (dow: number) => {
    const row = schedule.schedules.find((s) => s.dayOfWeek === dow);
    if (!row) return { hours: "Open 24 hours", closed: false };
    if (!row.isOpen) return { hours: "Closed", closed: true };
    return { hours: `${formatScheduleTime(row.openTime)} – ${formatScheduleTime(row.closeTime)}`, closed: false };
  };

  const lines: { from: number; to: number; hours: string; closed: boolean }[] = [];
  for (const dow of WEEK_ORDER) {
    const { hours, closed } = labelFor(dow);
    const last = lines[lines.length - 1];
    if (last && last.hours === hours) last.to = dow;
    else lines.push({ from: dow, to: dow, hours, closed });
  }
  return lines.map((l) => ({
    days: l.from === l.to ? DAY_SHORT[l.from] : `${DAY_SHORT[l.from]} – ${DAY_SHORT[l.to]}`,
    hours: l.hours,
    closed: l.closed,
  }));
}

interface BranchWeeklyHoursProps {
  schedule: BranchScheduleConfig;
  className?: string;
  /** Show the return grace period under the hours. */
  showGrace?: boolean;
}

/**
 * Weekly office hours from the branch's saved schedule. A 24-hour branch, or
 * one with no hours saved (bookings accepted at any time), says so instead.
 */
export function BranchWeeklyHours({ schedule, className, showGrace = false }: BranchWeeklyHoursProps) {
  if (schedule.is24Hours) {
    return <p className={cn("text-sm font-semibold text-zinc-900", className)}>Open 24 hours, every day</p>;
  }
  if (schedule.schedules.length === 0) {
    return (
      <p className={cn("text-sm font-medium text-zinc-600", className)}>
        No fixed hours — bookings are accepted at any time
      </p>
    );
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      {weeklyHoursLines(schedule).map((line) => (
        <div key={line.days} className="flex justify-between gap-8 text-sm">
          <span className="font-semibold text-zinc-900">{line.days}</span>
          <span className={line.closed ? "font-medium text-red-500" : "font-medium text-zinc-700"}>
            {line.hours}
          </span>
        </div>
      ))}
      {showGrace && schedule.graceMinutes > 0 && (
        <p className="text-xs text-zinc-500">
          Returns accepted up to {schedule.graceMinutes} min after closing
        </p>
      )}
    </div>
  );
}
