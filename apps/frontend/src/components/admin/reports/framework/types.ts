/** Shared admin-report framework types (spec §9). Mirrors utils/reporting on the backend. */

export type ReportPreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "custom";

export const PRESET_LABELS: Record<ReportPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  lastWeek: "Last week",
  thisMonth: "This month",
  lastMonth: "Last month",
  custom: "Custom",
};

export interface ReportFilterState {
  preset: ReportPreset;
  /** yyyy-MM-dd (IST) — only sent when preset = custom. */
  from: string;
  to: string;
  /** Branch publicId or "all". */
  branchId: string;
  /** Category publicIds (empty = all). */
  categories: string[];
  /** Vehicle publicId or "all". */
  vehicleId: string;
}

/** Same shape as the backend Delta (utils/reporting/delta.ts). */
export interface Delta {
  current: number | null;
  previous: number | null;
  abs: number | null;
  pct: number | null;
  direction: "up" | "down" | "flat" | null;
}

/** Same shape as the backend PreviousPeriod (labels only needed on the client). */
export interface PeriodInfo {
  from: string;
  to: string;
  label?: string;
  currentLabel?: string;
}

export interface FilterOptionBranch {
  publicId: string;
  name: string;
}
export interface FilterOptionCategory {
  publicId: string;
  name: string;
}
export interface FilterOptionVehicle {
  publicId: string;
  regNo: string;
  name: string;
  branchPublicId: string;
  categoryPublicId: string;
}
export interface ReportFilterOptions {
  branches: FilterOptionBranch[];
  categories: FilterOptionCategory[];
  vehicles: FilterOptionVehicle[];
}

export type ValueFormat = "money" | "number" | "percent" | "days" | "text";
