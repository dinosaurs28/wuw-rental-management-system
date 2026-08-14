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
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

const pad = (n: number) => String(n).padStart(2, "0");

export function TimeSelect({ value, onChange, className, triggerClassName }: TimeSelectProps) {
  const [hStr, mStr] = value.split(":");
  const hour = parseInt(hStr ?? "10", 10);
  const minute = parseInt(mStr ?? "0", 10);

  // Snap stored minute to nearest valid 15-min slot for display
  const displayMinute = MINUTES.includes(minute)
    ? minute
    : (MINUTES.find((m) => m > minute) ?? 0);

  const handleHourChange = (h: string) => {
    onChange(`${pad(parseInt(h))}:${pad(displayMinute)}`);
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
            <SelectItem key={h} value={String(h)} className="justify-center pr-2 pl-2">
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
            <SelectItem key={m} value={String(m)} className="justify-center pr-2 pl-2">
              {pad(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
