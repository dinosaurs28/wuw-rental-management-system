import { validateBookingWindow } from "@repo/schemas";
import { cn } from "@/lib/utils";
import type { BranchScheduleConfig } from "@/services/branch.service";
import { validateBookingSchedule } from "@/utils/branchScheduleValidator";
import { addHoursToSlot, istInstant } from "@/utils/bookingPickers";

const PRESETS = [
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
] as const;

interface DurationPresetChipsProps {
  pickupDate: Date | null;
  pickupTime: string;
  returnDate: Date | null;
  returnTime: string;
  /** Sets the return to pickup + N hours (rolls past midnight). */
  onApply: (returnDate: Date, returnTime: string) => void;
  schedule?: BranchScheduleConfig;
  className?: string;
}

/**
 * "12 hours" and "1 day" shortcuts next to the date/time pickers (#5). The
 * active chip is derived from the picked range, so no extra state is kept:
 * changing the pickup simply turns it off. The 12-hour chip is disabled, with
 * the reason, when pickup + 12 h falls outside the branch's return hours.
 */
export function DurationPresetChips({
  pickupDate,
  pickupTime,
  returnDate,
  returnTime,
  onApply,
  schedule,
  className,
}: DurationPresetChipsProps) {
  if (!pickupDate) return null;

  const start = istInstant(pickupDate, pickupTime || "10:00");
  const currentHours =
    returnDate ? (istInstant(returnDate, returnTime || "10:00").getTime() - start.getTime()) / 3_600_000 : null;

  const chips = PRESETS.map((preset) => {
    const target = addHoursToSlot(pickupDate, pickupTime || "10:00", preset.hours);
    const end = istInstant(target.day, target.time);
    let disabledReason: string | null = null;

    const window = validateBookingWindow({ startAt: start, endAt: end });
    if (!window.ok) disabledReason = window.message;

    // Only the 12-hour chip is held to the exact return time: a 1-day return on
    // a closed day is moved to the next open day by the usual adjustment.
    if (!disabledReason && preset.hours === 12 && schedule) {
      const verdict = validateBookingSchedule(schedule, start, end);
      const pickupProblem = verdict.status.startsWith("PICKUP_");
      if (!pickupProblem && verdict.status !== "OK" && verdict.status !== "RETURN_GRACE") {
        disabledReason =
          verdict.status === "NO_OPEN_DAY_IN_WINDOW"
            ? "The branch has no return window in the next week"
            : verdict.reason === "BEFORE_OPEN"
            ? `A 12-hour return would be before the branch opens (${verdict.openingTime})`
            : verdict.reason === "CLOSED_DAY"
              ? `A 12-hour return would fall on ${verdict.closedDayName}, when the branch is closed`
              : `A 12-hour return would be after closing (${verdict.closingTime})`;
      }
    }

    return {
      ...preset,
      target,
      disabledReason,
      active: currentHours !== null && Math.abs(currentHours - preset.hours) < 1 / 60,
    };
  });

  const reasons = chips.filter((c) => c.disabledReason);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.hours}
            type="button"
            disabled={!!chip.disabledReason}
            title={chip.disabledReason ?? undefined}
            aria-pressed={chip.active}
            onClick={() => onApply(chip.target.day, chip.target.time)}
            className={cn(
              "h-8 px-3.5 rounded-full border text-xs font-semibold transition-colors",
              chip.active
                ? "bg-zinc-900 border-zinc-900 text-white"
                : "bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400",
              "disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:border-zinc-200",
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {reasons.map((c) => (
        <p key={c.hours} className="text-[11px] text-zinc-500">
          {c.label}: {c.disabledReason}
        </p>
      ))}
    </div>
  );
}
