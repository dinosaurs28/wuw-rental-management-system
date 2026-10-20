import { useEffect, useState } from "react";
import { format, parse } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Check, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  EMPTY_QUEUE_FILTERS,
  activeFilterCount,
  hasTimeFilter,
  type QueueFilterState,
} from "@/store/queueFilters.store";
import type { QueueFilterOption, QueueFilterOptions } from "@/types/queueFilters";

// Search-bar filters of the Fleet queues (client, Oct 20 2026): a filter button
// inside the search field opens this popover; active filters show as removable
// chips under the field. Vehicle choices come from the branch's fleet.

const ymdToDate = (s: string) => parse(s, "yyyy-MM-dd", new Date());
const dayLabel = (s: string) => format(ymdToDate(s), "d MMM");
const WHEN_FALLBACK: Record<string, string> = { today: "Today", tomorrow: "Tomorrow", overdue: "Overdue" };

/** The time filter in words ("Today", "12 Oct – 15 Oct", "From 12 Oct"), or null. */
export function timeFilterLabel(f: QueueFilterState, options?: QueueFilterOptions | null): string | null {
  if (!hasTimeFilter(f)) return null;
  if (f.when !== "range") return options?.when.find((w) => w.value === f.when)?.label ?? WHEN_FALLBACK[f.when!];
  if (f.from && f.to) return f.from === f.to ? dayLabel(f.from) : `${dayLabel(f.from)} – ${dayLabel(f.to)}`;
  return f.from ? `From ${dayLabel(f.from)}` : `Until ${dayLabel(f.to!)}`;
}

type ListKey = "typeClass" | "category" | "groupKey" | "tripType" | "payment";
const LIST_KEYS: ListKey[] = ["typeClass", "category", "groupKey", "tripType", "payment"];

function optionsFor(key: ListKey, options?: QueueFilterOptions | null): QueueFilterOption[] {
  if (!options) return [];
  switch (key) {
    case "typeClass":
      return options.typeClasses;
    case "category":
      return options.categories;
    case "groupKey":
      return options.groups;
    case "tripType":
      return options.tripTypes;
    case "payment":
      return options.payment;
  }
}

// A value the options don't list (still loading): readable fallback
const fallbackLabel = (value: string) => value.replace(/__/g, " ").replace(/_/g, " ");

interface ActiveChip {
  key: string;
  label: string;
  remove: (f: QueueFilterState) => QueueFilterState;
}

function activeChips(f: QueueFilterState, options?: QueueFilterOptions | null): ActiveChip[] {
  const chips: ActiveChip[] = [];
  const time = timeFilterLabel(f, options);
  if (time) chips.push({ key: "time", label: time, remove: (s) => ({ ...s, when: null, from: null, to: null }) });
  for (const key of LIST_KEYS) {
    const list = optionsFor(key, options);
    for (const value of f[key] as string[]) {
      chips.push({
        key: `${key}:${value}`,
        label: list.find((o) => o.value === value)?.label ?? fallbackLabel(value),
        remove: (s) => ({ ...s, [key]: (s[key] as string[]).filter((v) => v !== value) }),
      });
    }
  }
  return chips;
}

/** The active filters in one line for the empty state ("Today · Two-wheeler"). */
export function filterSummary(f: QueueFilterState, options?: QueueFilterOptions | null): string {
  return activeChips(f, options)
    .map((c) => c.label)
    .join(" · ");
}

/** Active filters as removable chips under the search field, then "Clear all". */
export function QueueFilterChips({
  filters,
  options,
  onChange,
}: {
  filters: QueueFilterState;
  options?: QueueFilterOptions | null;
  onChange: (f: QueueFilterState) => void;
}) {
  const chips = activeChips(filters, options);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(chip.remove(filters))}
          className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100"
          aria-label={`Remove filter ${chip.label}`}
        >
          <span className="truncate">{chip.label}</span>
          <X className="h-3 w-3 shrink-0" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(EMPTY_QUEUE_FILTERS)}
        className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Clear all
      </button>
    </div>
  );
}

function ToggleChip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {selected && <Check className="h-3 w-3" />}
      {label}
      {count != null && (
        <span className={cn("text-[10px]", selected ? "text-background/70" : "text-muted-foreground")}>{count}</span>
      )}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-foreground">
        {title}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Filter button for inside the search field; opens the filter popover. */
export function QueueFilterPopover({
  phase,
  filters,
  options,
  optionsLoading,
  optionsError,
  onApply,
}: {
  phase: "PICKUP" | "RETURN";
  filters: QueueFilterState;
  options?: QueueFilterOptions | null;
  optionsLoading: boolean;
  optionsError: boolean;
  onApply: (f: QueueFilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<QueueFilterState>(filters);
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open]);

  const count = activeFilterCount(filters);
  const draftCount = activeFilterCount(draft);
  const toggle = (key: ListKey, value: string) =>
    setDraft((d) => {
      const list = d[key] as string[];
      return { ...d, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });
  const setWhen = (when: QueueFilterState["when"]) =>
    setDraft((d) => (d.when === when ? { ...d, when: null, from: null, to: null } : { ...d, when, from: null, to: null }));
  const range: DateRange | undefined = draft.from
    ? { from: ymdToDate(draft.from), to: draft.to ? ymdToDate(draft.to) : undefined }
    : undefined;

  const listSection = (key: ListKey, title: string, hint?: string) => {
    const list = optionsFor(key, options);
    if (list.length === 0) return null;
    return (
      <Section title={title} hint={hint}>
        {list.map((o) => (
          <ToggleChip
            key={o.value}
            label={o.label}
            count={o.count}
            selected={(draft[key] as string[]).includes(o.value)}
            onClick={() => toggle(key, o.value)}
          />
        ))}
      </Section>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative rounded p-1 text-muted-foreground hover:text-foreground",
            count > 0 && "text-orange-600 hover:text-orange-700",
          )}
          aria-label={count > 0 ? `Filters, ${count} on` : "Filters"}
          title="Filters"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full bg-orange-600 px-1 text-[10px] font-bold leading-4 text-white">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        {/* Scrolls within the room left on screen; the Apply bar stays visible */}
        <div
          className="space-y-4 overflow-y-auto p-4"
          style={{ maxHeight: "min(560px, calc(var(--radix-popover-content-available-height, 70vh) - 64px))" }}
        >
          <Section
            title={phase === "PICKUP" ? "Pickup time" : "Return time"}
            hint="replaces the date picked above"
          >
            {(options?.when ?? []).map((w) => (
              <ToggleChip key={w.value} label={w.label} selected={draft.when === w.value} onClick={() => setWhen(w.value)} />
            ))}
            <ToggleChip label="Custom dates" selected={draft.when === "range"} onClick={() => setWhen("range")} />
          </Section>
          {draft.when === "range" && (
            <div className="rounded-md border">
              <Calendar
                mode="range"
                selected={range}
                onSelect={(r) =>
                  setDraft((d) => ({
                    ...d,
                    from: r?.from ? format(r.from, "yyyy-MM-dd") : null,
                    to: r?.to ? format(r.to, "yyyy-MM-dd") : null,
                  }))
                }
                className="p-3"
              />
            </div>
          )}
          {optionsLoading && !options ? (
            <p className="text-xs text-muted-foreground">Loading the vehicle filters…</p>
          ) : optionsError && !options ? (
            <p className="text-xs text-destructive">Could not load the vehicle filters. Close and reopen to retry.</p>
          ) : (
            <>
              {listSection("typeClass", "Vehicle type")}
              {listSection("category", "Category")}
              {listSection("groupKey", "Model", "vehicles in the branch")}
              {listSection("tripType", "Trip type")}
              {listSection("payment", "Payment")}
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={draftCount === 0}
            onClick={() => setDraft(EMPTY_QUEUE_FILTERS)}
          >
            Clear all
          </Button>
          <Button
            size="sm"
            className="bg-orange-600 text-white hover:bg-orange-700"
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            {draftCount > 0 ? `Apply · ${draftCount} filter${draftCount === 1 ? "" : "s"}` : "Apply"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
