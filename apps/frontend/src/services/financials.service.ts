import apiClient from "@/lib/axios";
import { downloadBlob } from "@/utils/exportHelpers";
import type { ClientPaymentType, PaymentModeKey } from "@/lib/paymentTypes";

/** Branch Manager → Financials → "Financials" sub-tab (view only). */

export type ShiftStatusFilter = "OPEN" | "CLOSED" | "NONE";
export type FinancialsSort = "date" | "amount" | "type";

export interface FinancialsQuery {
  from: string;
  to: string;
  /** empty = all types */
  types: ClientPaymentType[];
  modes: PaymentModeKey[];
  /** collector user publicId, "ONLINE" (paid online by the customer) or null */
  collectedBy: string | null;
  shiftStatus: ShiftStatusFilter | null;
  search: string;
  sort: FinancialsSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface FinancialsTypeCard {
  type: ClientPaymentType;
  label: string;
  amount: number;
  count: number;
  countInRange: number;
  amountInRange: number;
}

export interface FinancialsRow {
  id: string;
  transactionId: string;
  paidAt: string;
  type: ClientPaymentType;
  typeLabel: string;
  amount: number;
  cash: number;
  upi: number;
  gateway: number;
  mode: string;
  method: string;
  status: string;
  purpose: string;
  transactionTotal: number;
  transactionCash: number;
  transactionOnline: number;
  partCount: number;
  bookingId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicle: string;
  vehicleName: string;
  collectedBy: { id: string; name: string } | null;
  shift: { id: string; status: string; isOpen: boolean } | null;
  reference: string | null;
  onlineGateway: string | null;
  hasProof: boolean;
  notes: string | null;
}

export interface FinancialsResponse {
  filters: Record<string, unknown>;
  summary: {
    total: { amount: number; count: number };
    byType: FinancialsTypeCard[];
    byMode: { cash: number; upi: number; gateway: number };
  };
  rows: FinancialsRow[];
  pageTotal: { count: number; amount: number; cash: number; upi: number; gateway: number };
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
}

export interface FinancialsOptions {
  collectors: { id: string; name: string }[];
}

const toParams = (q: Partial<FinancialsQuery>) => {
  const p: Record<string, string | number> = {};
  if (q.from) p.from = q.from;
  if (q.to) p.to = q.to;
  if (q.types?.length) p.types = q.types.join(",");
  if (q.modes?.length) p.modes = q.modes.join(",");
  if (q.collectedBy) p.collectedBy = q.collectedBy;
  if (q.shiftStatus) p.shiftStatus = q.shiftStatus;
  if (q.search?.trim()) p.search = q.search.trim();
  if (q.sort) p.sort = q.sort;
  if (q.dir) p.dir = q.dir;
  if (q.page) p.page = q.page;
  if (q.pageSize) p.pageSize = q.pageSize;
  return p;
};

export const financialsService = {
  getPayments: async (q: FinancialsQuery): Promise<FinancialsResponse> => {
    const res = await apiClient.get<{ data: FinancialsResponse }>("/branchManager/financials/payments", {
      params: toParams(q),
    });
    return res.data.data;
  },
  getOptions: async (): Promise<FinancialsOptions> => {
    const res = await apiClient.get<{ data: FinancialsOptions }>("/branchManager/financials/options");
    return res.data.data;
  },
  download: async (q: FinancialsQuery, format: "csv" | "xlsx"): Promise<void> => {
    const res = await apiClient.get("/branchManager/financials/payments/export", {
      params: { ...toParams({ ...q, page: undefined, pageSize: undefined }), format },
      responseType: "blob",
      timeout: 120000,
    });
    downloadBlob(res.data as Blob, `financials-${q.from}-to-${q.to}.${format}`);
  },
};
