import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { type ReportFilterState, type ReportPreset, PRESET_LABELS } from "./types";
import { istToday } from "./format";

const PRESETS = Object.keys(PRESET_LABELS) as ReportPreset[];

export const defaultReportFilters = (preset: ReportPreset = "thisMonth"): ReportFilterState => {
  const today = istToday();
  return {
    preset,
    from: preset === "custom" ? `${today.slice(0, 8)}01` : "",
    to: preset === "custom" ? today : "",
    branchId: "all",
    categories: [],
    vehicleId: "all",
  };
};

/** Axios query params for a filter state (the backend parseReportFilters contract). */
export const reportFilterParams = (f: ReportFilterState): Record<string, string> => {
  const p: Record<string, string> = {};
  if (f.preset === "custom") {
    if (f.from) p.from = f.from;
    if (f.to) p.to = f.to;
    p.preset = "custom";
  } else {
    p.preset = f.preset;
  }
  if (f.branchId && f.branchId !== "all") p.branchId = f.branchId;
  if (f.categories.length > 0) p.categories = f.categories.join(",");
  if (f.vehicleId && f.vehicleId !== "all") p.vehicleId = f.vehicleId;
  return p;
};

/** URL search string for deep links (e.g. dashboard click-throughs). */
export const reportFilterSearch = (f: Partial<ReportFilterState>): string => {
  const full = { ...defaultReportFilters(f.preset ?? "thisMonth"), ...f };
  return new URLSearchParams(reportFilterParams(full)).toString();
};

/**
 * Report filter state kept in the URL (?preset=&from=&to=&branchId=&categories=&vehicleId=)
 * so filters survive reloads and the dashboard can deep-link into reports.
 */
export const useReportFilters = (opts: { defaultPreset?: ReportPreset } = {}) => {
  const [search, setSearch] = useSearchParams();
  const defaults = useMemo(() => defaultReportFilters(opts.defaultPreset ?? "thisMonth"), [opts.defaultPreset]);

  const filters: ReportFilterState = useMemo(() => {
    const rawPreset = search.get("preset") as ReportPreset | null;
    const from = search.get("from") ?? "";
    const to = search.get("to") ?? "";
    const preset: ReportPreset =
      rawPreset && PRESETS.includes(rawPreset) ? rawPreset : from && to ? "custom" : defaults.preset;
    return {
      preset,
      from: preset === "custom" ? from || defaults.from || istToday() : "",
      to: preset === "custom" ? to || defaults.to || istToday() : "",
      branchId: search.get("branchId") || "all",
      categories: (search.get("categories") || "").split(",").filter(Boolean),
      vehicleId: search.get("vehicleId") || "all",
    };
  }, [search, defaults]);

  const setFilters = useCallback(
    (next: ReportFilterState) => {
      setSearch(
        (prev) => {
          const keep = new URLSearchParams();
          // Preserve unrelated params (tabs, sort, page …).
          prev.forEach((v, k) => {
            if (!["preset", "from", "to", "branchId", "categories", "vehicleId"].includes(k)) keep.set(k, v);
          });
          for (const [k, v] of Object.entries(reportFilterParams(next))) keep.set(k, v);
          return keep;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  const reset = useCallback(() => setFilters(defaults), [setFilters, defaults]);
  const params = useMemo(() => reportFilterParams(filters), [filters]);

  return { filters, setFilters, params, reset };
};
