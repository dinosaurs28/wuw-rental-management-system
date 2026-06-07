import { Clock } from "lucide-react";
import { formatScheduleTime } from "@/utils/branchScheduleValidator";
import type { BranchScheduleConfig } from "@/services/branch.service";

interface BranchHoursBadgeProps {
  schedule: BranchScheduleConfig | undefined;
  date: Date | null;
}

export const BranchHoursBadge = ({ schedule, date }: BranchHoursBadgeProps) => {
  if (!schedule || !date) return null;
  if (schedule.is24Hours) {
    return (
      <p className="flex items-center gap-1.5 mt-1.5 text-[11px] font-medium text-emerald-600">
        <Clock className="size-3 shrink-0" />
        Open 24 hours
      </p>
    );
  }

  const dow = date.getDay();
  const row = schedule.schedules.find((s) => s.dayOfWeek === dow);

  if (!row) return null;

  if (!row.isOpen) {
    return (
      <p className="flex items-center gap-1.5 mt-1.5 text-[11px] font-medium text-red-500">
        <Clock className="size-3 shrink-0" />
        Closed this day
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 mt-1.5 text-[11px] font-medium text-zinc-400">
      <Clock className="size-3 shrink-0" />
      {formatScheduleTime(row.openTime)} – {formatScheduleTime(row.closeTime)}
      {schedule.graceMinutes > 0 && (
        <span className="text-zinc-300">+{schedule.graceMinutes}min grace</span>
      )}
    </p>
  );
};
