import apiClient from "@/lib/axios";
import { downloadBlob } from "@/utils/exportHelpers";

// ── Branch Manager "Period" report (#14) ──────────────────────────────────────
// GET /api/branchManager/reports/period{,/bookings,/export}. The branch is always
// the manager's own (from the JWT); dates are IST calendar days (YYYY-MM-DD).

export type PeriodGroupBy = "auto" | "day" | "week" | "month";
export type RentalPeriodKey = "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";
export type BookingSourceKey = "ONLINE" | "COUNTER";
export type PeriodBookingStatus = "CONFIRMED" | "PICKED_UP" | "RETURNED" | "CANCELLED";

export interface PeriodKpis {
  bookings: number;
  bookingValue: number;
  depositsInBookingValue: number;
  averageBookingValue: number;
  collected: {
    total: number;
    cash: number;
    online: number;
    upi: number;
    gateway: number;
    payments: number;
  };
  outstanding: number;
  outstandingBookings: number;
  cancellations: { count: number; fees: number };
  returns: { count: number };
  extensions: {
    count: number;
    amount: number;
    baseAmount: number;
    discountAmount: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    taxAmount: number;
  };
  refunds: { count: number; amount: number };
}

/** % change vs the previous window (1 dp); null = previous was 0 and current isn't. */
export interface PeriodKpiChange {
  bookings: number | null;
  bookingValue: number | null;
  collected: number | null;
  outstanding: number | null;
  cancellations: number | null;
  returns: number | null;
  extensions: number | null;
  extensionAmount: number | null;
  refunds: number | null;
  refundAmount: number | null;
}

export interface PeriodRange {
  from: string;
  to: string;
  days: number;
  timezone: string;
  groupBy: Exclude<PeriodGroupBy, "auto">;
  groupByRequested: PeriodGroupBy;
  previous: { from: string; to: string };
}

export interface PeriodRentalBreakdownRow {
  type: RentalPeriodKey;
  label: string;
  bookings: number;
  bookingValue: number;
  averageValue: number;
  bookingsSharePct: number;
  valueSharePct: number;
}

export interface PeriodSourceRow {
  source: BookingSourceKey;
  label: string;
  bookings: number;
  bookingValue: number;
  bookingsSharePct: number;
  valueSharePct: number;
}

export interface PeriodTrendPoint {
  key: string;
  label: string;
  from: string;
  to: string;
  bookings: number;
  bookingValue: number;
  collected: number;
  cash: number;
  online: number;
  cancellations: number;
  returns: number;
  extensions: number;
  extensionAmount: number;
  refunds: number;
  refundAmount: number;
}

export interface PeriodBookingRow {
  publicId: string;
  customerName: string;
  customerPhone: string;
  vehicle: string;
  regNo: string;
  vehicles: { make: string; model: string; regNo: string }[];
  startAt: string;
  endAt: string;
  rentalPeriod: RentalPeriodKey;
  rentalPeriodLabel: string;
  source: BookingSourceKey;
  sourceLabel: string;
  counterStaffName: string | null;
  status: PeriodBookingStatus;
  statusLabel: string;
  total: number;
  paid: number;
  balance: number;
  extensionCount: number;
}

export interface PeriodBookingFilters {
  status: "all" | PeriodBookingStatus;
  rentalPeriod: "all" | RentalPeriodKey;
  source: "all" | BookingSourceKey;
  search?: string;
}

export interface PeriodBookingsPage {
  rows: PeriodBookingRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  totals: { bookings: number; total: number; paid: number; balance: number };
  filters: PeriodBookingFilters;
}

export interface PeriodReport {
  branch: { publicId: string; name: string };
  range: PeriodRange;
  generatedAt: string;
  summary: PeriodKpis;
  previous: PeriodKpis;
  change: PeriodKpiChange;
  byRentalPeriod: PeriodRentalBreakdownRow[];
  bySource: PeriodSourceRow[];
  trend: PeriodTrendPoint[];
  bookings: PeriodBookingsPage;
}

export interface PeriodQuery {
  from: string;
  to: string;
  groupBy?: PeriodGroupBy;
  page?: number;
  pageSize?: number;
  status?: PeriodBookingFilters["status"];
  rentalPeriod?: PeriodBookingFilters["rentalPeriod"];
  source?: PeriodBookingFilters["source"];
  search?: string;
}

/** Drop blank / "all" params so the URL only carries what the manager chose. */
const toParams = (q: PeriodQuery & { kind?: "bookings" | "trend" }) => {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && (v.trim() === "" || v === "all")) continue;
    params[k] = typeof v === "string" ? v.trim() : v;
  }
  return params;
};

/** The server's `message` from an axios error with a JSON body. */
export const periodErrorMessage = (error: unknown, fallback: string): string => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  const message = (data as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message ? message : fallback;
};

/** Same, for a `responseType: 'blob'` call (CSV export): errors arrive as a JSON Blob. */
export const periodBlobErrorMessage = async (error: unknown, fallback: string): Promise<string> => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.message === "string" && parsed.message) return parsed.message;
    } catch {
      /* not JSON */
    }
    return fallback;
  }
  return periodErrorMessage(error, fallback);
};

export const managerPeriodReportService = {
  getReport: async (q: PeriodQuery): Promise<PeriodReport> => {
    const response = await apiClient.get("/branchManager/reports/period", {
      params: toParams(q),
      timeout: 30000,
    });
    return response.data.data as PeriodReport;
  },

  getBookings: async (q: PeriodQuery): Promise<PeriodBookingsPage> => {
    const response = await apiClient.get("/branchManager/reports/period/bookings", {
      params: toParams(q),
      timeout: 30000,
    });
    const d = response.data.data;
    return {
      rows: d.rows,
      pagination: d.pagination,
      totals: d.totals,
      filters: d.filters,
    } as PeriodBookingsPage;
  },

  /**
   * Downloads the CSV through axios (the accessToken cookie rides along) and names
   * the file on the client — Content-Disposition is not exposed over CORS.
   */
  downloadCsv: async (
    q: PeriodQuery,
    kind: "bookings" | "trend",
    /** The bucket size the report resolved (range.groupBy) — names the trend file. */
    resolvedGroupBy?: Exclude<PeriodGroupBy, "auto">,
  ): Promise<void> => {
    // Paging doesn't apply to the export — it always carries every matching row.
    const response = await apiClient.get("/branchManager/reports/period/export", {
      params: toParams({ ...q, page: undefined, pageSize: undefined, kind }),
      responseType: "blob",
      timeout: 60000,
    });
    const filename =
      kind === "trend"
        ? `period-${q.from}-to-${q.to}-trend-by-${resolvedGroupBy ?? q.groupBy ?? "auto"}.csv`
        : `period-${q.from}-to-${q.to}-bookings.csv`;
    downloadBlob(response.data as Blob, filename);
  },
};
