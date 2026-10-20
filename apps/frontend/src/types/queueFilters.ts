// Search-bar filters of the Fleet Pickup / Return queues (Oct 20 2026).
// Different filters combine with AND, values of one filter with OR.
export type QueueWhen = "today" | "tomorrow" | "overdue";
export type QueuePayment = "balance_due" | "paid";

/** Query params of GET /employee/booking and /employee/return (all optional). */
export interface QueueFilterParams {
  typeClass?: string[];
  /** VehicleCategory publicIds */
  category?: string[];
  /** "MAKE__MODEL" */
  groupKey?: string[];
  tripType?: string[];
  when?: QueueWhen[];
  /** YYYY-MM-DD (IST day, inclusive) */
  from?: string;
  to?: string;
  payment?: QueuePayment[];
}

export interface QueueFilterOption {
  value: string;
  label: string;
  /** Vehicles of the branch with it */
  count?: number;
}

/** GET /employee/queue-filters?phase=PICKUP|RETURN → { data } */
export interface QueueFilterOptions {
  typeClasses: QueueFilterOption[];
  categories: Array<QueueFilterOption & { typeClass: string }>;
  groups: Array<QueueFilterOption & { make: string; model: string }>;
  tripTypes: QueueFilterOption[];
  when: Array<{ value: QueueWhen; label: string }>;
  payment: Array<{ value: QueuePayment; label: string }>;
}
