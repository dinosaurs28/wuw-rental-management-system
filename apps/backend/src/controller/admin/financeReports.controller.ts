/**
 * Admin Reports 2.1–2.5 (rpt-finance). Read-only; ADMIN only (AdminCheck on the routes).
 * Each endpoint returns JSON, or a row-level CSV with export=csv (`table` picks
 * which row set when a report has several). Rules: services/reporting/finance/*.
 */
import type { Request, Response } from "express";
import {
  handleReportError,
  parseReportFilters,
  streamCsv,
  type CsvColumn,
  type ReportFilters,
} from "../../utils/reporting/index.js";
import {
  computeRevenue,
  groupByBranch,
  groupByCategory,
  groupByVehicle,
  loadRevenueRows,
  revenueDeltas,
  revenueTrend,
  sumRevenue,
  type RevenueRow,
} from "../../services/reporting/finance/revenue.js";
import { getOutstandingDues, type CustomerDue, type DueRow } from "../../services/reporting/finance/dues.js";
import { buildCollectionsReport, type CollectionRow } from "../../services/reporting/finance/collections.js";
import { buildDepositsReport, type DepositRow } from "../../services/reporting/finance/deposits.js";
import {
  buildDiscountsRefundsReport,
  type DiscountLine,
  type RefundRow,
} from "../../services/reporting/finance/discounts-refunds.js";
import { AGING_BUCKET_LABELS, MODE_LABELS } from "../../services/reporting/finance/booking-finance.js";

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Upcoming",
  PICKED_UP: "Active",
  RETURNED: "Completed",
  CANCELLED: "Cancelled",
};

function paging(req: Request) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
  return { page, pageSize };
}
function pageOf<T>(rows: T[], p: { page: number; pageSize: number }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / p.pageSize));
  return {
    rows: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize),
    pagination: { page: p.page, pageSize: p.pageSize, totalRows: rows.length, totalPages },
  };
}
const meta = (f: ReportFilters) => ({
  from: f.from,
  to: f.to,
  preset: f.preset,
  branchId: f.branchPublicId,
  categories: f.categoryPublicIds,
  vehicleId: f.vehiclePublicId,
  groupBy: f.groupBy,
  previous: f.previous,
  generatedAt: new Date().toISOString(),
});
const fileTag = (f: ReportFilters) => `${f.from}_to_${f.to}`;
const tableParam = (req: Request) => String(req.query.table ?? "").toLowerCase();

// ── 2.1 Revenue Summary ───────────────────────────────────────────────────────

const REVENUE_COLUMNS: CsvColumn<RevenueRow>[] = [
  { header: "Booking ID", value: (r) => r.bookingPublicId },
  { header: "Start (IST)", value: (r) => r.startAt, type: "datetime" },
  { header: "End (IST)", value: (r) => r.endAt, type: "datetime" },
  { header: "Status", value: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: "Branch", value: (r) => r.branchName },
  { header: "Category", value: (r) => r.vehicles.map((v) => v.categoryName).join(" / ") || "Not recorded" },
  { header: "Vehicle", value: (r) => r.vehicles.map((v) => `${v.regNo} ${v.name}`).join(" / ") || "Not recorded" },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Booking value (Sales)", value: (r) => r.bookingValue, type: "money" },
  { header: "Refundable category deposit", value: (r) => r.deposit, type: "money" },
  { header: "Rent incl GST", value: (r) => r.rent, type: "money" },
  { header: "Drop extras", value: (r) => r.extras, type: "money" },
  { header: "Goodwill refunds", value: (r) => r.goodwill, type: "money" },
  { header: "Revenue", value: (r) => r.revenue, type: "money" },
  { header: "GST included (rent + extensions)", value: (r) => r.gst, type: "money" },
];

export const GetFinanceRevenue = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const scope = { branchPublicId: f.branchPublicId, categoryPublicIds: f.categoryPublicIds, vehiclePublicId: f.vehiclePublicId };
    const [rows, prevTotals] = await Promise.all([
      loadRevenueRows({ ...scope, start: f.start, end: f.end }),
      f.compare || !f.exportCsv ? computeRevenue({ ...scope, start: f.previous.start, end: f.previous.end }) : Promise.resolve(null),
    ]);
    if (f.exportCsv) {
      return await streamCsv(res, { filename: `revenue-summary_${fileTag(f)}`, columns: REVENUE_COLUMNS, rows });
    }
    const summary = sumRevenue(rows);
    const p = pageOf(rows, paging(req));
    return res.json({
      data: {
        meta: meta(f),
        summary,
        previous: prevTotals,
        deltas: prevTotals ? revenueDeltas(summary, prevTotals) : null,
        trend: revenueTrend(rows, f, f.groupBy),
        byBranch: groupByBranch(rows),
        byCategory: groupByCategory(rows),
        byVehicle: groupByVehicle(rows),
        rows: p.rows.map((r) => ({ ...r, statusLabel: STATUS_LABEL[r.status] ?? r.status })),
        pagination: p.pagination,
      },
    });
  } catch (err) {
    handleReportError(res, err, "revenue summary");
  }
};

// ── 2.2 Payments & Collections ────────────────────────────────────────────────

const COLLECTION_COLUMNS: CsvColumn<CollectionRow>[] = [
  { header: "Transaction ID", value: (r) => r.publicId },
  { header: "Paid at (IST)", value: (r) => r.paidAt, type: "datetime" },
  { header: "Booking ID", value: (r) => r.bookingPublicId },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Branch", value: (r) => r.branchName },
  { header: "Purpose", value: (r) => r.purposeLabel },
  { header: "Direction", value: (r) => (r.direction === "IN" ? "In" : "Out (refund)") },
  { header: "Status", value: (r) => r.status },
  { header: "Counted", value: (r) => r.counted, type: "bool" },
  { header: "Amount", value: (r) => r.amount, type: "money" },
  { header: "Cash", value: (r) => r.modes.CASH, type: "money" },
  { header: "UPI", value: (r) => r.modes.UPI, type: "money" },
  { header: "Bank transfer", value: (r) => r.modes.BANK_TRANSFER, type: "money" },
  { header: "Online gateway", value: (r) => r.modes.GATEWAY, type: "money" },
  { header: "Mode", value: (r) => r.modeLabel },
  { header: "Reference / UTR", value: (r) => r.reference ?? "" },
  { header: "Collected by", value: (r) => r.collectedBy },
  { header: "Confirmed by", value: (r) => r.confirmedBy ?? "" },
  { header: "Confirmed at (IST)", value: (r) => r.confirmedAt, type: "datetime" },
  { header: "Cash shift", value: (r) => r.shift ?? "" },
  { header: "Void / rejection reason", value: (r) => r.voidReason ?? r.rejectionReason ?? "" },
];

type ShiftRow = Awaited<ReturnType<typeof buildCollectionsReport>>["discrepancies"]["cashShifts"]["rows"][number];
const SHIFT_COLUMNS: CsvColumn<ShiftRow>[] = [
  { header: "Shift ID", value: (r) => r.publicId },
  { header: "Branch", value: (r) => r.branchName },
  { header: "Executive", value: (r) => r.employee },
  { header: "Closed by", value: (r) => r.closedBy ?? "Not recorded" },
  { header: "Opened (IST)", value: (r) => r.openedAt, type: "datetime" },
  { header: "Closed (IST)", value: (r) => r.closedAt, type: "datetime" },
  { header: "Expected cash", value: (r) => r.expected, type: "money" },
  { header: "Counted cash", value: (r) => r.counted, type: "money" },
  { header: "Difference", value: (r) => r.difference, type: "money" },
  { header: "Explanation", value: (r) => r.explanation ?? "" },
];

export const GetFinanceCollections = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const report = await buildCollectionsReport(f, { compare: f.compare || !f.exportCsv });
    if (f.exportCsv) {
      if (tableParam(req) === "shifts") {
        return await streamCsv(res, { filename: `cash-shifts_${fileTag(f)}`, columns: SHIFT_COLUMNS, rows: report.discrepancies.cashShifts.rows });
      }
      return await streamCsv(res, { filename: `payments-collections_${fileTag(f)}`, columns: COLLECTION_COLUMNS, rows: report.rows });
    }
    const p = pageOf(report.rows, paging(req));
    return res.json({
      data: {
        meta: meta(f),
        modeLabels: MODE_LABELS,
        notTracked: {
          card: "Card payments are not recorded separately: Razorpay card, UPI and netbanking all show as Online gateway.",
        },
        ...report,
        rows: p.rows,
        pagination: p.pagination,
      },
    });
  } catch (err) {
    handleReportError(res, err, "payments & collections");
  }
};

// ── 2.3 Outstanding Dues & Aging ──────────────────────────────────────────────

const DUE_COLUMNS: CsvColumn<DueRow>[] = [
  { header: "Booking ID", value: (r) => r.bookingPublicId },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Phone", value: (r) => r.customerPhone ?? "" },
  { header: "Branch", value: (r) => r.branchName },
  { header: "Vehicle", value: (r) => r.vehicle },
  { header: "Category", value: (r) => r.category },
  { header: "Status", value: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: "Start (IST)", value: (r) => r.startAt, type: "datetime" },
  { header: "Returned (IST)", value: (r) => r.returnedAt, type: "datetime" },
  { header: "Total owed", value: (r) => r.totalOwed, type: "money" },
  { header: "Paid (confirmed, net of refunds)", value: (r) => r.netConfirmed, type: "money" },
  { header: "Due", value: (r) => r.due, type: "money" },
  { header: "Awaiting confirmation", value: (r) => Math.min(r.pendingConfirmation, r.due), type: "money" },
  { header: "Due from (IST)", value: (r) => r.dueFrom, type: "date" },
  { header: "Due from basis", value: (r) => (r.dueFromBasis === "RETURN" ? "Return (drop charges)" : "Pickup") },
  { header: "Age (days)", value: (r) => r.ageDays, type: "number" },
  { header: "Bucket", value: (r) => (r.bucket ? AGING_BUCKET_LABELS[r.bucket] : "") },
  { header: "Last payment (IST)", value: (r) => r.lastPaymentAt, type: "datetime" },
];
const CUSTOMER_DUE_COLUMNS: CsvColumn<CustomerDue>[] = [
  { header: "Customer ID", value: (r) => r.customerPublicId },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Phone", value: (r) => r.customerPhone ?? "" },
  { header: "Bookings with dues", value: (r) => r.bookings, type: "number" },
  { header: "Due", value: (r) => r.due, type: "money" },
  { header: "0-7 days", value: (r) => r.buckets["0-7"], type: "money" },
  { header: "8-30 days", value: (r) => r.buckets["8-30"], type: "money" },
  { header: "Over 30 days", value: (r) => r.buckets["31+"], type: "money" },
  { header: "Oldest (days)", value: (r) => r.oldestAgeDays, type: "number" },
  { header: "Awaiting confirmation", value: (r) => r.pendingConfirmation, type: "money" },
];

export const GetFinanceDues = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const dues = await getOutstandingDues({
      branchPublicId: f.branchPublicId,
      categoryPublicIds: f.categoryPublicIds,
      vehiclePublicId: f.vehiclePublicId,
    });
    if (f.exportCsv) {
      if (tableParam(req) === "customers") {
        return await streamCsv(res, { filename: `outstanding-dues-by-customer`, columns: CUSTOMER_DUE_COLUMNS, rows: dues.byCustomer });
      }
      return await streamCsv(res, { filename: `outstanding-dues`, columns: DUE_COLUMNS, rows: dues.rows });
    }
    const { rows, ...rest } = dues;
    const p = pageOf(rows, paging(req));
    return res.json({
      data: {
        meta: { ...meta(f), asOf: dues.asOf, dateRangeApplied: false },
        bucketLabels: AGING_BUCKET_LABELS,
        ...rest,
        rows: p.rows,
        pagination: p.pagination,
      },
    });
  } catch (err) {
    handleReportError(res, err, "outstanding dues");
  }
};

// ── 2.4 Security Deposits ─────────────────────────────────────────────────────

const DEPOSIT_COLUMNS: CsvColumn<DepositRow>[] = [
  { header: "Booking ID", value: (r) => r.bookingPublicId },
  { header: "Start (IST)", value: (r) => r.startAt, type: "datetime" },
  { header: "Returned (IST)", value: (r) => r.returnedAt, type: "datetime" },
  { header: "Status", value: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: "Branch", value: (r) => r.branchName },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Vehicle", value: (r) => r.vehicle },
  { header: "Deposit taken", value: (r) => r.taken, type: "money" },
  { header: "Deducted", value: (r) => r.deducted, type: "money" },
  { header: "Deduction reason", value: (r) => r.reasonText },
  { header: "Refunded", value: (r) => r.refunded, type: "money" },
  { header: "Still held", value: (r) => r.held, type: "money" },
  { header: "Unreconciled", value: (r) => r.unreconciled, type: "money" },
  { header: "Handling", value: (r) => r.handling ?? "" },
  { header: "Flow", value: (r) => r.flow },
  { header: "Category deposit (in booking value)", value: (r) => r.categoryDeposit, type: "money" },
];
type DepositTxn = Awaited<ReturnType<typeof buildDepositsReport>>["transactions"][number];
const DEPOSIT_TXN_COLUMNS: CsvColumn<DepositTxn>[] = [
  { header: "Transaction ID", value: (r) => r.publicId },
  { header: "Booking ID", value: (r) => r.bookingPublicId },
  { header: "Paid at (IST)", value: (r) => r.paidAt, type: "datetime" },
  { header: "Status", value: (r) => r.status },
  { header: "Amount", value: (r) => r.amount, type: "money" },
  { header: "Mode", value: (r) => r.mode },
  { header: "Reference", value: (r) => r.reference ?? "" },
  { header: "Collected by", value: (r) => r.collectedBy },
];

export const GetFinanceDeposits = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const report = await buildDepositsReport(f, { compare: f.compare || !f.exportCsv });
    if (f.exportCsv) {
      if (tableParam(req) === "transactions") {
        return await streamCsv(res, { filename: `deposit-transactions_${fileTag(f)}`, columns: DEPOSIT_TXN_COLUMNS, rows: report.transactions });
      }
      return await streamCsv(res, { filename: `security-deposits_${fileTag(f)}`, columns: DEPOSIT_COLUMNS, rows: report.rows });
    }
    const p = pageOf(report.rows, paging(req));
    return res.json({ data: { meta: meta(f), ...report, rows: p.rows, pagination: p.pagination } });
  } catch (err) {
    handleReportError(res, err, "security deposits");
  }
};

// ── 2.5 Discounts & Refunds ───────────────────────────────────────────────────

const DISCOUNT_COLUMNS: CsvColumn<DiscountLine>[] = [
  { header: "Booking ID", value: (r) => r.bookingPublicId },
  { header: "Start (IST)", value: (r) => r.startAt, type: "datetime" },
  { header: "Branch", value: (r) => r.branchName },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Discount type", value: (r) => r.sourceLabel },
  { header: "Amount (excl GST)", value: (r) => r.amount, type: "money" },
  { header: "GST taken off", value: (r) => r.gst, type: "money" },
  { header: "Coupon code", value: (r) => r.code ?? "" },
  { header: "Applied by", value: (r) => r.appliedBy },
  { header: "Approved by", value: (r) => r.approvedBy ?? "" },
  { header: "Reason", value: (r) => r.reason ?? "" },
  { header: "Applied at (IST)", value: (r) => r.appliedAt, type: "datetime" },
];
const REFUND_COLUMNS: CsvColumn<RefundRow>[] = [
  { header: "Transaction ID", value: (r) => r.publicId },
  { header: "Paid at (IST)", value: (r) => r.paidAt, type: "datetime" },
  { header: "Booking ID", value: (r) => r.bookingPublicId },
  { header: "Booking status", value: (r) => STATUS_LABEL[r.bookingStatus] ?? r.bookingStatus },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Branch", value: (r) => r.branchName },
  { header: "Refund type", value: (r) => r.kindLabel },
  { header: "Status", value: (r) => r.status },
  { header: "Counted", value: (r) => r.counted, type: "bool" },
  { header: "Amount", value: (r) => r.amount, type: "money" },
  { header: "Goodwill part", value: (r) => r.goodwill, type: "money" },
  { header: "Mode", value: (r) => r.mode },
  { header: "Reference", value: (r) => r.reference ?? "" },
  { header: "Proof photo", value: (r) => r.proof, type: "bool" },
  { header: "Paid by", value: (r) => r.paidBy },
  { header: "Reason / note", value: (r) => r.reason ?? "" },
  { header: "Void reason", value: (r) => r.voidReason ?? "" },
];

export const GetFinanceDiscountsRefunds = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const report = await buildDiscountsRefundsReport(f, { compare: f.compare || !f.exportCsv });
    if (f.exportCsv) {
      if (tableParam(req) === "refunds") {
        return await streamCsv(res, { filename: `refunds_${fileTag(f)}`, columns: REFUND_COLUMNS, rows: report.refundRows });
      }
      return await streamCsv(res, { filename: `discounts_${fileTag(f)}`, columns: DISCOUNT_COLUMNS, rows: report.discountLines });
    }
    const pg = paging(req);
    const d = pageOf(report.discountLines, pg);
    const r = pageOf(report.refundRows, pg);
    return res.json({
      data: {
        meta: meta(f),
        ...report,
        discountLines: d.rows,
        discountPagination: d.pagination,
        refundRows: r.rows,
        refundPagination: r.pagination,
      },
    });
  } catch (err) {
    handleReportError(res, err, "discounts & refunds");
  }
};
