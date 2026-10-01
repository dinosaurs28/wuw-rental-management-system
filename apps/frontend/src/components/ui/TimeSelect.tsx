import { useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TimeSelectProps {
  value: string; // "HH:MM"
  onChange: (value: string) => void;
  className?: string;
  triggerClassName?: string;
  /**
   * Slots that can't be picked (e.g. outside branch office hours, or a pickup
   * time that has already passed today). An hour is greyed out when none of
   * its minutes is allowed. If the current value becomes disallowed it snaps
   * to the next allowed slot that day, else to the nearest earlier one (e.g.
   * a return after closing moves back to closing / grace end).
   */
  isDisabled?: (hour: number, minute: number) => boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * First allowed slot at or after (hour, minute), else the nearest allowed slot
 * before it — never the day's first slot, which can be hours earlier. Past
 * pickup slots are disallowed by the caller, so this never moves into the past.
 */
function nearestAllowedSlot(
  isDisabled: (hour: number, minute: number) => boolean,
  hour: number,
  minute: number,
): string | null {
  const slots = HOURS.flatMap((h) => MINUTES.map((m) => [h, m] as const));
  const from = hour * 60 + minute;
  const after = slots.find(([h, m]) => h * 60 + m >= from && !isDisabled(h, m));
  const before = [...slots].reverse().find(([h, m]) => h * 60 + m < from && !isDisabled(h, m));
  const found = after ?? before;
  return found ? `${pad(found[0])}:${pad(found[1])}` : null;
}

export function TimeSelect({ value, onChange, className, triggerClassName, isDisabled }: TimeSelectProps) {
  const [hStr, mStr] = value.split(":");
  const hour = parseInt(hStr ?? "10", 10);
  const minute = parseInt(mStr ?? "0", 10);

  // Snap stored minute to nearest valid 15-min slot for display
  const displayMinute = MINUTES.includes(minute)
    ? minute
    : (MINUTES.find((m) => m > minute) ?? 0);

  // Keep the value inside the allowed slots (e.g. after the date changed to a
  // day with different hours). A day with no allowed slot is left alone — the
  // caller shows why (closed day, past the booking window).
  const currentDisallowed = !!isDisabled && isDisabled(hour, displayMinute);
  useEffect(() => {
    if (!isDisabled || !currentDisallowed) return;
    const next = nearestAllowedSlot(isDisabled, hour, displayMinute);
    if (next && next !== value) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDisallowed, isDisabled, hour, displayMinute]);

  const hourDisabled = (h: number) => !!isDisabled && MINUTES.every((m) => isDisabled(h, m));

  const handleHourChange = (h: string) => {
    const newHour = parseInt(h);
    // Keep the minute when it's allowed in the new hour, else take its first allowed minute
    const minuteForHour =
      isDisabled && isDisabled(newHour, displayMinute)
        ? (MINUTES.find((m) => !isDisabled(newHour, m)) ?? displayMinute)
        : displayMinute;
    onChange(`${pad(newHour)}:${pad(minuteForHour)}`);
  };

  const handleMinuteChange = (m: string) => {
    onChange(`${pad(hour)}:${pad(parseInt(m))}`);
  };

  const triggerBase =
    "!border-0 !shadow-none !bg-transparent !p-0 !h-auto !rounded-none focus-visible:!ring-0 focus-visible:!ring-offset-0 !w-auto gap-0.5 text-sm font-medium";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Select value={String(hour)} onValueChange={handleHourChange}>
        <SelectTrigger className={cn(triggerBase, triggerClassName)}>
          <SelectValue>{pad(hour)}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="center" className="min-w-[72px] max-h-48 overflow-y-auto">
          {HOURS.map((h) => (
            <SelectItem key={h} value={String(h)} disabled={hourDisabled(h)} className="justify-center pr-2 pl-2">
              {pad(h)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-sm font-semibold text-zinc-400 select-none leading-none">:</span>

      <Select value={String(displayMinute)} onValueChange={handleMinuteChange}>
        <SelectTrigger className={cn(triggerBase, triggerClassName)}>
          <SelectValue>{pad(displayMinute)}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="center" className="min-w-[72px]">
          {MINUTES.map((m) => (
            <SelectItem
              key={m}
              value={String(m)}
              disabled={!!isDisabled && isDisabled(hour, m)}
              className="justify-center pr-2 pl-2"
            >
              {pad(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
