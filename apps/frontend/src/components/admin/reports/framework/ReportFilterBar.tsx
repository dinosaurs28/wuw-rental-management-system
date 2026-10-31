import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { getReportFilterOptions } from "./reportApi";
import { defaultReportFilters } from "./useReportFilters";
import { istToday } from "./format";
import { PRESET_LABELS, type ReportFilterOptions, type ReportFilterState, type ReportPreset } from "./types";

export interface ReportFilterBarProps {
  value: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
  /** Which controls to show (all default to true). */
  show?: { dates?: boolean; branch?: boolean; category?: boolean; vehicle?: boolean };
  /** Restrict presets (e.g. snapshot reports may hide dates entirely). */
  presets?: ReportPreset[];
  /** Label of the resolved current range, e.g. API `period.currentLabel`. */
  rangeLabel?: string;
  className?: string;
}

const ALL_PRESETS = Object.keys(PRESET_LABELS) as ReportPreset[];

/**
 * Shared report filter bar (spec §9.1): date presets + custom range (IST days),
 * branch, vehicle category (multi) and individual vehicle — all combinable.
 * The vehicle list narrows to the chosen branch/categories.
 */
export const ReportFilterBar = ({ value, onChange, show = {}, presets = ALL_PRESETS, rangeLabel, className }: ReportFilterBarProps) => {
  const { dates = true, branch = true, category = true, vehicle = true } = show;
  const [options, setOptions] = useState<ReportFilterOptions | null>(null);

  useEffect(() => {
    let alive = true;
    getReportFilterOptions()
      .then((o) => alive && setOptions(o))
      .catch(() => alive && setOptions({ branches: [], categories: [], vehicles: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const vehicles = useMemo(() => {
    const list = options?.vehicles ?? [];
    return list.filter(
      (v) =>
        (value.branchId === "all" || v.branchPublicId === value.branchId) &&
        (value.categories.length === 0 || value.categories.includes(v.categoryPublicId)),
    );
  }, [options, value.branchId, value.categories]);

  const set = (patch: Partial<ReportFilterState>) => {
    const next = { ...value, ...patch };
    // Drop a selected vehicle that no longer matches branch/category.
    if (next.vehicleId !== "all" && options) {
      const v = options.vehicles.find((x) => x.publicId === next.vehicleId);
      if (
        v &&
        ((next.branchId !== "all" && v.branchPublicId !== next.branchId) ||
          (next.categories.length > 0 && !next.categories.includes(v.categoryPublicId)))
      ) {
        next.vehicleId = "all";
      }
    }
    onChange(next);
  };

  const setPreset = (preset: ReportPreset) => {
    if (preset === "custom") {
      const today = istToday();
      set({ preset, from: value.from || `${today.slice(0, 8)}01`, to: value.to || today });
    } else {
      set({ preset, from: "", to: "" });
    }
  };

  const categoryLabel =
    value.categories.length === 0
      ? "All categories"
      : value.categories.length === 1
        ? (options?.categories.find((c) => c.publicId === value.categories[0])?.name ?? "1 category")
        : `${value.categories.length} categories`;

  return (
    <div
      className={cn("flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm", className)}
      data-testid="report-filter-bar"
    >
      {dates && (
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={cn(
                "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                value.preset === p
                  ? "border-[#FF5F00] bg-[#FF5F00] text-white"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300",
              )}
              aria-pressed={value.preset === p}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
          {value.preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="From date"
                value={value.from}
                max={value.to || undefined}
                onChange={(e) => e.target.value && set({ from: e.target.value })}
                className="h-8 rounded-md border border-neutral-200 px-2 text-xs"
              />
              <span className="text-xs text-neutral-400">to</span>
              <input
                type="date"
                aria-label="To date"
                value={value.to}
                min={value.from || undefined}
                onChange={(e) => e.target.value && set({ to: e.target.value })}
                className="h-8 rounded-md border border-neutral-200 px-2 text-xs"
              />
            </div>
          )}
          {rangeLabel && <span className="ml-1 text-xs text-neutral-500">{rangeLabel}</span>}
        </div>
      )}
      {(branch || category || vehicle) && (
        <div className="flex flex-wrap items-center gap-2">
          {branch && (
            <Select value={value.branchId} onValueChange={(v) => set({ branchId: v })}>
              <SelectTrigger className="h-9 w-full sm:w-48" aria-label="Branch">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {options?.branches.map((b) => (
                  <SelectItem key={b.publicId} value={b.publicId}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {category && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 w-full justify-start font-normal sm:w-48" aria-label="Vehicle category">
                  <span className="truncate">{categoryLabel}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="start">
                <button
                  type="button"
                  className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-50"
                  onClick={() => set({ categories: [] })}
                >
                  All categories
                </button>
                {options?.categories.map((c) => {
                  const checked = value.categories.includes(c.publicId);
                  return (
                    <label key={c.publicId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-50">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(on) =>
                          set({
                            categories: on
                              ? [...value.categories, c.publicId]
                              : value.categories.filter((x) => x !== c.publicId),
                          })
                        }
                      />
                      {c.name}
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          )}
          {vehicle && (
            <Select value={value.vehicleId} onValueChange={(v) => set({ vehicleId: v })}>
              <SelectTrigger className="h-9 w-full sm:w-56" aria-label="Vehicle">
                <SelectValue placeholder="All vehicles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vehicles</SelectItem>
                {vehicles.map((v) => (
                  <SelectItem key={v.publicId} value={v.publicId}>
                    {v.regNo} · {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            className="h-9 text-neutral-500"
            onClick={() => onChange(defaultReportFilters("thisMonth"))}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      )}
    </div>
  );
};
