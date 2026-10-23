// Filter state of the Financials sub-tab. It lives in the Financials page shell
// (FinancialsDashboardPage), so it survives switching to Cash Shift and back.
import type { ClientPaymentType, PaymentModeKey } from "@/lib/paymentTypes";
import type { FinancialsSort, ShiftStatusFilter } from "@/services/financials.service";
import { resolvePreset, type PeriodPreset } from "@/components/manager/period/periodRange";

/** Presets the client asked for (no "This week"). */
export type FinancialsPreset = Exclude<PeriodPreset, "thisWeek">;

export const FINANCIALS_PRESETS: { value: FinancialsPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom" },
];

export interface FinancialsViewState {
  preset: FinancialsPreset;
  from: string;
  to: string;
  /** null = All types; [] = cleared (nothing selected) */
  types: ClientPaymentType[] | null;
  mode: PaymentModeKey | null;
  collectedBy: string | null;
  shiftStatus: ShiftStatusFilter | null;
  search: string;
  sort: FinancialsSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export const defaultFinancialsState = (): FinancialsViewState => {
  const { from, to } = resolvePreset("today");
  return {
    preset: "today",
    from,
    to,
    types: null,
    mode: null,
    collectedBy: null,
    shiftStatus: null,
    search: "",
    sort: "date",
    dir: "desc",
    page: 1,
    pageSize: 25,
  };
};

/** Reset filters: All types + Today (keeps the page size). */
export const resetFinancialsFilters = (s: FinancialsViewState): FinancialsViewState => ({
  ...defaultFinancialsState(),
  pageSize: s.pageSize,
});
