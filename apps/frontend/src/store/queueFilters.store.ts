import { create } from "zustand";
import type { QueueFilterParams, QueuePayment, QueueWhen } from "@/types/queueFilters";

// Search-bar filters of the Fleet Pickup / Return queues (client, Oct 20 2026),
// one set per queue, remembered for the browser session (memory only — a
// reload starts clean).

export type QueueFilterQueue = "PICKUP" | "RETURN";

export interface QueueFilterState {
  typeClass: string[];
  category: string[];
  groupKey: string[];
  tripType: string[];
  payment: QueuePayment[];
  /** One time choice: a preset, a custom day range, or none */
  when: QueueWhen | "range" | null;
  from: string | null;
  to: string | null;
}

export const EMPTY_QUEUE_FILTERS: QueueFilterState = {
  typeClass: [],
  category: [],
  groupKey: [],
  tripType: [],
  payment: [],
  when: null,
  from: null,
  to: null,
};

interface QueueFiltersStore {
  filters: Record<QueueFilterQueue, QueueFilterState>;
  setFilters: (queue: QueueFilterQueue, filters: QueueFilterState) => void;
  clearFilters: (queue: QueueFilterQueue) => void;
}

export const useQueueFiltersStore = create<QueueFiltersStore>((set) => ({
  filters: { PICKUP: EMPTY_QUEUE_FILTERS, RETURN: EMPTY_QUEUE_FILTERS },
  setFilters: (queue, filters) => set((s) => ({ filters: { ...s.filters, [queue]: filters } })),
  clearFilters: (queue) => set((s) => ({ filters: { ...s.filters, [queue]: EMPTY_QUEUE_FILTERS } })),
}));

/** The time filter is set (a preset, or a range with at least one end). */
export const hasTimeFilter = (f: QueueFilterState) =>
  f.when === "range" ? !!(f.from || f.to) : f.when != null;

/** How many filter values are on (the badge on the filter button). */
export const activeFilterCount = (f: QueueFilterState) =>
  f.typeClass.length +
  f.category.length +
  f.groupKey.length +
  f.tripType.length +
  f.payment.length +
  (hasTimeFilter(f) ? 1 : 0);

/** Query params for the queue endpoints; empty filters send nothing. */
export function queueFilterParams(f: QueueFilterState): QueueFilterParams {
  const p: QueueFilterParams = {};
  if (f.typeClass.length) p.typeClass = f.typeClass;
  if (f.category.length) p.category = f.category;
  if (f.groupKey.length) p.groupKey = f.groupKey;
  if (f.tripType.length) p.tripType = f.tripType;
  if (f.payment.length) p.payment = f.payment;
  if (f.when === "range") {
    if (f.from) p.from = f.from;
    if (f.to) p.to = f.to;
  } else if (f.when) {
    p.when = [f.when];
  }
  return p;
}

/** Stable key of the filters (fetch keys). */
export const queueFilterKey = (f: QueueFilterState) => JSON.stringify(queueFilterParams(f));
