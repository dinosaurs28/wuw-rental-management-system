import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PeriodGroupBy } from "@/services/managerPeriodReport.service";
import {
  MAX_PERIOD_DAYS,
  PERIOD_PRESETS,
  validateCustomRange,
  type PeriodPreset,
} from "./periodRange";

const GROUP_BY_OPTIONS: { value: PeriodGroupBy; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

interface PeriodRangeBarProps {
  preset: PeriodPreset;
  from: string;
  to: string;
  groupBy: PeriodGroupBy;
  onPresetChange: (preset: Exclude<PeriodPreset, "custom">) => void;
  onCustomApply: (from: string, to: string) => void;
  onGroupByChange: (groupBy: PeriodGroupBy) => void;
}

/**
 * Preset chips + custom IST date range + trend bucket size. Custom dates are
 * kept as a draft until "Apply" so a half-typed range never hits the API.
 */
export function PeriodRangeBar({
  preset,
  from,
  to,
  groupBy,
  onPresetChange,
  onCustomApply,
  onGroupByChange,
}: PeriodRangeBarProps) {
  const [customOpen, setCustomOpen] = useState(preset === "custom");
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [touched, setTouched] = useState(false);

  const showCustom = customOpen || preset === "custom";
  const draftError = validateCustomRange(draftFrom, draftTo);
  const draftUnchanged = preset === "custom" && draftFrom === from && draftTo === to;

  const pickPreset = (value: PeriodPreset) => {
    if (value === "custom") {
      // Start the custom editor from whatever range is on screen.
      setDraftFrom(from);
      setDraftTo(to);
      setTouched(false);
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onPresetChange(value);
  };

  const apply = () => {
    setTouched(true);
    if (draftError) return;
    onCustomApply(draftFrom, draftTo);
  };

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5 shadow-sm space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          role="radiogroup"
          aria-label="Report period"
          className="flex flex-wrap items-center gap-1.5"
        >
          {PERIOD_PRESETS.map((p) => {
            const active = p.value === "custom" ? showCustom : !showCustom && preset === p.value;
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickPreset(p.value)}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors",
                  active
                    ? "bg-orange-50 text-orange-600 border-orange-200"
                    : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50 hover:text-neutral-900",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-neutral-500">Trend by</span>
          <Select value={groupBy} onValueChange={(v) => onGroupByChange(v as PeriodGroupBy)}>
            <SelectTrigger className="h-9 w-[110px] bg-white" aria-label="Trend by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_BY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {showCustom && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 pt-3 border-t border-neutral-100">
          <div className="space-y-1">
            <label htmlFor="period-from" className="text-xs font-medium text-neutral-500">
              From
            </label>
            <Input
              id="period-from"
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="h-9 w-full sm:w-[170px]"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="period-to" className="text-xs font-medium text-neutral-500">
              To
            </label>
            <Input
              id="period-to"
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
              className="h-9 w-full sm:w-[170px]"
            />
          </div>
          <Button
            type="button"
            onClick={apply}
            disabled={draftUnchanged}
            className="h-9 bg-orange-500 hover:bg-orange-600 text-white gap-1.5"
          >
            <CalendarRange className="h-4 w-4" />
            Apply
          </Button>
          <p className="text-xs text-neutral-400 sm:pb-2">
            IST calendar days, both inclusive · up to {MAX_PERIOD_DAYS} days
          </p>
        </div>
      )}
      {showCustom && touched && draftError && (
        <p className="text-sm text-red-600" role="alert">
          {draftError}
        </p>
      )}
    </div>
  );
}
