import type { ReactNode } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { istCalendarParts } from "@/utils/bookingPickers";
import { formatScheduleTime } from "@/utils/branchScheduleValidator";
import { packageLengthLabel, type PackageRangeState } from "@/utils/bookingPackages";

// Pieces of the package picker (P1 / P4a), laid out by each booking surface in
// its own style: the package select, "12 hours" / "1 day" quick chips, the
// Fleet extra-hours select, the read-only return and the reason lines.
// State comes from packageRangeState() in utils/bookingPackages.ts.

/** "Tue, 7 Oct · 10:00 AM" (IST) for a computed return. */
export function formatPackageReturn(at: Date | null): string {
  if (!at) return "—";
  const { day, time } = istCalendarParts(at);
  return `${format(day, "EEE, d MMM")} · ${formatScheduleTime(time)}`;
}

/**
 * "return by 10:30 PM today" / "return by 10:30 PM on Tue, 7 Oct" — the
 * 12-hour package held to closing on the pickup day (client item 6).
 */
export function formatClampedReturn(at: Date, now: Date = new Date()): string {
  const { day, time } = istCalendarParts(at);
  const today = istCalendarParts(now).day;
  return `return by ${formatScheduleTime(time)} ${
    day.getTime() === today.getTime() ? "today" : `on ${format(day, "EEE, d MMM")}`
  }`;
}

interface PackageSelectProps {
  state: PackageRangeState;
  onSelect: (packageHours: number) => void;
  disabled?: boolean;
  triggerClassName?: string;
  /** Rendered before the value inside the trigger (an icon). */
  icon?: ReactNode;
}

/** "12 hours", "1 day" … "15 days" — packages past the window aren't listed; out-of-hours ones are greyed with the reason. */
export function PackageSelect({ state, onSelect, disabled, triggerClassName, icon }: PackageSelectProps) {
  const noPickup = state.options.length === 0;
  return (
    <Select
      value={state.selected ? String(state.selected.hours) : ""}
      onValueChange={(v) => onSelect(Number(v))}
      disabled={disabled || noPickup}
    >
      <SelectTrigger aria-label="Rental length" className={triggerClassName}>
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <SelectValue placeholder={noPickup ? "Pick a pickup first" : "Choose length"}>
            {state.selected?.label}
          </SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72 overflow-y-auto rounded-xl">
        {state.options.map((opt) => (
          <SelectItem
            key={opt.id}
            value={String(opt.hours)}
            disabled={!!opt.disabledReason}
            className="py-2"
          >
            <div className="flex flex-col items-start">
              <span className="font-medium">{opt.label}</span>
              <span className="text-[11px] text-zinc-500">
                {opt.disabledReason ??
                  (opt.clampedReturn
                    ? `${upperFirst(formatClampedReturn(opt.returnAt))}, when the branch closes`
                    : `Return ${formatPackageReturn(opt.returnAt)}`)}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface PackageQuickChipsProps {
  state: PackageRangeState;
  onSelect: (packageHours: number) => void;
  className?: string;
}

/** The two most common packages as one-tap chips (same rules as the select). */
export function PackageQuickChips({ state, onSelect, className }: PackageQuickChipsProps) {
  const chips = state.options.filter((o) => o.hours === 12 || o.hours === 24);
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {chips.map((chip) => {
        const active = state.selected?.hours === chip.hours;
        return (
          <button
            key={chip.id}
            type="button"
            disabled={!!chip.disabledReason}
            title={
              chip.disabledReason ??
              (chip.clampedReturn ? `${chip.label} · ${formatClampedReturn(chip.returnAt)}` : undefined)
            }
            aria-pressed={active}
            onClick={() => onSelect(chip.hours)}
            className={cn(
              "h-8 px-3.5 rounded-full border text-xs font-semibold transition-colors",
              active
                ? "bg-zinc-900 border-zinc-900 text-white"
                : "bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400",
              "disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:border-zinc-200",
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

interface ExtraHoursSelectProps {
  state: PackageRangeState;
  onSelect: (extraHours: number) => void;
  disabled?: boolean;
  triggerClassName?: string;
}

/** Fleet walk-in: 0–11 extra hours on top of the package, billed at the Extra Hour Rate. */
export function ExtraHoursSelect({ state, onSelect, disabled, triggerClassName }: ExtraHoursSelectProps) {
  if (state.extraOptions.length === 0) return null;
  return (
    <Select
      value={String(state.extraHours)}
      onValueChange={(v) => onSelect(Number(v))}
      disabled={disabled || !state.selected}
    >
      <SelectTrigger aria-label="Extra hours" className={triggerClassName}>
        <SelectValue>
          {state.extraHours === 0 ? "No extra hours" : `+${state.extraHours} hour${state.extraHours === 1 ? "" : "s"}`}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72 overflow-y-auto rounded-xl">
        {state.extraOptions.map((opt) => (
          <SelectItem
            key={opt.hours}
            value={String(opt.hours)}
            disabled={!!opt.disabledReason}
            className="py-2"
          >
            <div className="flex flex-col items-start">
              <span className="font-medium">
                {opt.hours === 0 ? "No extra hours" : `+${opt.hours} hour${opt.hours === 1 ? "" : "s"}`}
              </span>
              <span className="text-[11px] text-zinc-500">
                {opt.disabledReason ?? `Return ${formatPackageReturn(opt.returnAt)}`}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface PackageHintsProps {
  state: PackageRangeState;
  /** Fleet: say that extra hours are billed at the Extra Hour Rate. */
  showExtraHoursNote?: boolean;
  className?: string;
}

/**
 * Why a quick-chip length ("12 hours", "1 day") can't be picked for this
 * pickup, and when no package fits at all. Day packages keep the pickup's
 * clock time, so "1 day" only needs a line when the next day is closed. A
 * 12-hour package held to closing (client item 6) says when it returns.
 */
export function PackageHints({ state, showExtraHoursNote, className }: PackageHintsProps) {
  const lines: string[] = [];
  if (state.noneAvailable) {
    lines.push("No rental length fits this pickup time — the branch is closed at every return. Choose another pickup time.");
  } else {
    for (const opt of state.options) {
      if ((opt.hours === 12 || opt.hours === 24) && opt.disabledReason) {
        lines.push(`${opt.label} isn't available for this pickup: ${lowerFirst(opt.disabledReason)}.`);
      } else if (opt.clampedReturn && !opt.disabledReason) {
        const dayOption = state.options.find((o) => o.hours === 24 && !o.disabledReason);
        lines.push(
          `${opt.label} · ${formatClampedReturn(opt.returnAt)}, when the branch closes (12 hours would run past closing).${
            dayOption ? ` Choose ${dayOption.label} to keep it overnight.` : ""
          }`,
        );
      }
    }
  }
  if (showExtraHoursNote && state.selected && state.extraHours > 0) {
    const total = state.selected.hours + state.extraHours;
    lines.push(
      `Booked for ${total} hours (${packageLengthLabel(state.selected.hours, state.extraHours)}) — each vehicle's price includes the extra hours.`,
    );
  }
  if (lines.length === 0) return null;
  return (
    <div className={cn("space-y-1", className)}>
      {lines.map((line) => (
        <p key={line} className={cn("text-[11px]", state.noneAvailable ? "text-red-500 font-medium" : "text-zinc-500")}>
          {line}
        </p>
      ))}
    </div>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
