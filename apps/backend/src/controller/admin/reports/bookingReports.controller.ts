/**
 * Admin Reports — bookings (3.1–3.5), customers (7.1, 7.2), branches (8.1) and staff (8.2).
 * GET /api/admin/dashboard/reports/<report>   (AdminCheck, read-only)
 *
 * Shared query (utils/reporting/reportFilters.ts): from, to (IST days) | preset, branchId,
 * categories, vehicleId, compare=1, export=csv, groupBy. Report-specific params are noted
 * per handler. JSON: { period, summary, previous, deltas, …breakdowns, rows, pagination,
 * notes }. export=csv streams every row (not paged) with the same filters.
 */
import type { Request, Response } from "express";
import {
  handleReportError,
  parseReportFilters,
  streamCsv,
  type CsvColumn,
  type ReportFilters,
} from "../../../utils/reporting/index.js";
import {
  bookingSourceReport,
  bookingSummaryReport,
  cancellationsReport,
  durationLeadTimeReport,
  extensionsLateReport,
} from "../../../services/reporting/bookings/bookings.service.js";
import {
  customerHistory,
  customerLtvReport,
  customerSummaryReport,
  parseCustomerSort,
} from "../../../services/reporting/bookings/customers.service.js";
import {
  branchComparisonReport,
  staffActivityReport,
  type ActivityRow,
} from "../../../services/reporting/bookings/branch-staff.service.js";
import { paginate, parsePage } from "../../../services/reporting/bookings/common.js";

type Q = Record<string, unknown>;
const str = (v: unknown): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  return t && t !== "all" ? t.slice(0, 100) : null;
};
const fileName = (name: string, f: ReportFilters) => `${name}-${f.from}-to-${f.to}.csv`;

/** Common booking columns (CSV). */
type BookingCsvRow = {
  bookingId: string;
  customerName: string;
  customerPhone: string | null;
  branchName: string;
  vehicle: string;
  category: string;
  source: string;
};
const bookingCols = <R extends BookingCsvRow>(): CsvColumn<R>[] => [
  { header: "Booking ID", value: (r) => r.bookingId },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Phone", value: (r) => r.customerPhone ?? "" },
  { header: "Branch", value: (r) => r.branchName },
  { header: "Vehicle", value: (r) => r.vehicle },
  { header: "Category", value: (r) => r.category },
  { header: "Source", value: (r) => (r.source === "APP" ? "App / online" : "Walk-in") },
];

function sendJson(res: Response, req: Request, report: { rows: unknown[] } & Record<string, unknown>, rowsKey = "rows") {
  const { rows, pagination } = paginate(report.rows, parsePage(req.query as Q));
  res.json({ ...report, [rowsKey]: rows, pagination });
}

// ── 3.1 ──────────────────────────────────────────────────────────────────────
export const GetBookingSummaryReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const report = await bookingSummaryReport(f);
    if (f.exportCsv) {
      type R = (typeof report.rows)[number];
      return await streamCsv<R>(res, {
        filename: fileName("booking-summary", f),
        columns: [
          ...bookingCols<R>(),
          { header: "Status", value: (r) => r.statusLabel },
          { header: "Created", value: (r) => r.createdAt, type: "datetime" },
          { header: "Pickup (scheduled)", value: (r) => r.startAt, type: "datetime" },
          { header: "Return (scheduled)", value: (r) => r.endAt, type: "datetime" },
          { header: "Returned", value: (r) => r.returnedAt, type: "datetime" },
          { header: "Cancelled", value: (r) => r.cancelledAt, type: "datetime" },
          { header: "Booking value", value: (r) => r.bookingValue, type: "money" },
        ],
        rows: report.rows,
      });
    }
    sendJson(res, req, report);
  } catch (err) {
    handleReportError(res, err, "booking summary report");
  }
};

// ── 3.2 ──────────────────────────────────────────────────────────────────────
// ?type=NO_SHOW|MANUAL_BM|DISPLACED|OTHER|MISSED_PICKUP narrows the rows
export const GetCancellationsReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const report = await cancellationsReport(f);
    const type = str(req.query.type);
    const rows = type
      ? report.rows.filter((r) => (type === "MISSED_PICKUP" ? r.kind === "MISSED_PICKUP" : r.type === type))
      : report.rows;
    if (f.exportCsv) {
      type R = (typeof rows)[number];
      return await streamCsv<R>(res, {
        filename: fileName("cancellations-no-shows", f),
        columns: [
          ...bookingCols<R>(),
          { header: "Type", value: (r) => r.typeLabel },
          { header: "Reason", value: (r) => r.reason ?? (r.kind === "CANCELLED" ? "Not recorded" : "") },
          { header: "Cancelled by", value: (r) => r.cancelledBy ?? (r.kind === "CANCELLED" ? "Not recorded" : "") },
          { header: "Created", value: (r) => r.createdAt, type: "datetime" },
          { header: "Pickup (scheduled)", value: (r) => r.startAt, type: "datetime" },
          { header: "Cancelled", value: (r) => r.cancelledAt, type: "datetime" },
          { header: "Booking value", value: (r) => r.bookingValue, type: "money" },
          { header: "Booked rent", value: (r) => r.bookedRent, type: "money" },
          { header: "Money received", value: (r) => r.moneyIn, type: "money" },
          { header: "Refunded", value: (r) => r.refundedOut, type: "money" },
          { header: "Rent kept", value: (r) => r.rentKept, type: "money" },
          { header: "Est. revenue lost", value: (r) => r.revenueLost, type: "money" },
        ],
        rows,
      });
    }
    sendJson(res, req, { ...report, rows });
  } catch (err) {
    handleReportError(res, err, "cancellations report");
  }
};

// ── 3.3 ──────────────────────────────────────────────────────────────────────
// ?source=APP|WALK_IN narrows the rows
export const GetBookingSourceReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const report = await bookingSourceReport(f);
    const source = str(req.query.source);
    const rows = source ? report.rows.filter((r) => r.source === source) : report.rows;
    if (f.exportCsv) {
      type R = (typeof rows)[number];
      return await streamCsv<R>(res, {
        filename: fileName("booking-source", f),
        columns: [
          ...bookingCols<R>(),
          { header: "Created by", value: (r) => r.createdByName ?? "" },
          { header: "Status", value: (r) => r.statusLabel },
          { header: "Created", value: (r) => r.createdAt, type: "datetime" },
          { header: "Pickup (scheduled)", value: (r) => r.startAt, type: "datetime" },
          { header: "Booking value", value: (r) => r.bookingValue, type: "money" },
          { header: "Revenue", value: (r) => r.revenue, type: "money" },
        ],
        rows,
      });
    }
    sendJson(res, req, { ...report, rows });
  } catch (err) {
    handleReportError(res, err, "booking source report");
  }
};

// ── 3.4 ──────────────────────────────────────────────────────────────────────
export const GetDurationLeadTimeReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const report = await durationLeadTimeReport(f);
    if (f.exportCsv) {
      type R = (typeof report.rows)[number];
      return await streamCsv<R>(res, {
        filename: fileName("duration-lead-time", f),
        columns: [
          ...bookingCols<R>(),
          { header: "Status", value: (r) => r.statusLabel },
          { header: "Created", value: (r) => r.createdAt, type: "datetime" },
          { header: "Pickup (scheduled)", value: (r) => r.startAt, type: "datetime" },
          { header: "Return (scheduled)", value: (r) => r.endAt, type: "datetime" },
          { header: "Returned", value: (r) => r.returnedAt, type: "datetime" },
          { header: "Lead time (hours)", value: (r) => r.leadHours, type: "number" },
          { header: "Lead time band", value: (r) => r.leadBucketLabel },
          { header: "Booked duration (hours)", value: (r) => r.bookedHours, type: "number" },
          { header: "Actual duration (hours)", value: (r) => r.actualHours, type: "number" },
          { header: "Rental type", value: (r) => r.periodTypeLabel },
        ],
        rows: report.rows,
      });
    }
    sendJson(res, req, report);
  } catch (err) {
    handleReportError(res, err, "duration and lead time report");
  }
};

// ── 3.5 ──────────────────────────────────────────────────────────────────────
// ?show=extended|late|overdue|unpaid narrows the rows
export const GetExtensionsLateReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const report = await extensionsLateReport(f);
    const show = str(req.query.show);
    const rows = report.rows.filter((r) =>
      show === "extended"
        ? r.extensions > 0
        : show === "late"
          ? r.isLate
          : show === "overdue"
            ? r.overdueNow
            : show === "unpaid"
              ? r.lateFeeDifference > 0
              : true,
    );
    if (f.exportCsv) {
      type R = (typeof rows)[number];
      return await streamCsv<R>(res, {
        filename: fileName("extensions-late-returns", f),
        columns: [
          ...bookingCols<R>(),
          { header: "Status", value: (r) => r.statusLabel },
          { header: "Pickup (scheduled)", value: (r) => r.startAt, type: "datetime" },
          { header: "Original return", value: (r) => r.originalEndAt, type: "datetime" },
          { header: "Return (scheduled)", value: (r) => r.endAt, type: "datetime" },
          { header: "Returned", value: (r) => r.returnedAt, type: "datetime" },
          { header: "Extensions", value: (r) => r.extensions, type: "number" },
          { header: "Extension amount", value: (r) => r.extensionAmount, type: "money" },
          { header: "Hours added", value: (r) => r.extensionHours, type: "number" },
          { header: "Late (minutes)", value: (r) => r.lateMinutes, type: "number" },
          { header: "Overdue now", value: (r) => r.overdueNow, type: "bool" },
          { header: "Late fee charged", value: (r) => r.lateFeeCharged, type: "money" },
          { header: "Late fee collected", value: (r) => r.lateFeeCollected, type: "money" },
          { header: "Of which from deposit", value: (r) => r.lateFeeFromDeposit, type: "money" },
          { header: "Difference", value: (r) => r.lateFeeDifference, type: "money" },
        ],
        rows,
      });
    }
    sendJson(res, req, { ...report, rows });
  } catch (err) {
    handleReportError(res, err, "extensions and late returns report");
  }
};

// ── 7.1 ──────────────────────────────────────────────────────────────────────
// ?type=new|repeat  ?sort=revenue|bookings|due|name|recent  ?search=
export const GetCustomerSummaryReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const t = str(req.query.type);
    const report = await customerSummaryReport(f, {
      type: t === "new" || t === "repeat" ? t : null,
      sort: parseCustomerSort(req.query.sort),
      search: str(req.query.search),
    });
    if (f.exportCsv) {
      type R = (typeof report.rows)[number];
      return await streamCsv<R>(res, {
        filename: fileName("customer-summary", f),
        columns: [
          { header: "Customer ID", value: (r) => r.customerId },
          { header: "Customer", value: (r) => r.name },
          { header: "Phone", value: (r) => r.phone ?? "" },
          { header: "Type", value: (r) => r.typeLabel },
          { header: "Bookings in period", value: (r) => r.bookings, type: "number" },
          { header: "Revenue in period", value: (r) => r.revenue, type: "money" },
          { header: "Avg revenue per booking", value: (r) => r.avgRevenue, type: "money" },
          { header: "Due now", value: (r) => r.due, type: "money" },
          { header: "First booking", value: (r) => r.firstBookingAt, type: "date" },
          { header: "Last booking in period", value: (r) => r.lastBookingAt, type: "date" },
        ],
        rows: report.rows,
      });
    }
    sendJson(res, req, report);
  } catch (err) {
    handleReportError(res, err, "customer summary report");
  }
};

// ── 7.2 ──────────────────────────────────────────────────────────────────────
// ?allTime=1  ?sort=  ?search=   |   ?customerId=<publicId> → that customer's history
export const GetCustomerLtvReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const customerId = str(req.query.customerId);
    if (customerId) {
      const h = await customerHistory(f, customerId);
      if (!h) return res.status(404).json({ message: "Customer not found" });
      if (f.exportCsv) {
        type R = (typeof h.rows)[number];
        return await streamCsv<R>(res, {
          filename: `customer-history-${h.customer.customerId}.csv`,
          columns: [
            ...bookingCols<R>(),
            { header: "Status", value: (r) => r.statusLabel },
            { header: "Pickup (scheduled)", value: (r) => r.startAt, type: "datetime" },
            { header: "Return (scheduled)", value: (r) => r.endAt, type: "datetime" },
            { header: "Returned", value: (r) => r.returnedAt, type: "datetime" },
            { header: "Cancelled", value: (r) => r.cancelledAt, type: "datetime" },
            { header: "Extensions", value: (r) => r.extensions, type: "number" },
            { header: "Booking value", value: (r) => r.bookingValue, type: "money" },
            { header: "Revenue", value: (r) => r.revenue, type: "money" },
            { header: "Paid", value: (r) => r.paid, type: "money" },
            { header: "Due now", value: (r) => r.due, type: "money" },
          ],
          rows: h.rows,
        });
      }
      return res.json(h);
    }
    const allTime = ["1", "true", "yes"].includes(String(req.query.allTime ?? "").toLowerCase());
    const report = await customerLtvReport(f, { allTime, sort: parseCustomerSort(req.query.sort), search: str(req.query.search) });
    if (f.exportCsv) {
      type R = (typeof report.rows)[number];
      return await streamCsv<R>(res, {
        filename: fileName(allTime ? "customer-ltv-all-time" : "customer-ltv", f),
        columns: [
          { header: "Customer ID", value: (r) => r.customerId },
          { header: "Customer", value: (r) => r.name },
          { header: "Phone", value: (r) => r.phone ?? "" },
          { header: "Trips (completed)", value: (r) => r.trips, type: "number" },
          { header: "Bookings", value: (r) => r.bookings, type: "number" },
          { header: "Cancellations", value: (r) => r.cancellations, type: "number" },
          { header: "Total spend", value: (r) => r.revenue, type: "money" },
          { header: "Paid", value: (r) => r.paid, type: "money" },
          { header: "Outstanding", value: (r) => r.due, type: "money" },
          { header: "Avg spend per trip", value: (r) => r.avgRevenuePerTrip, type: "money" },
          { header: "First booking", value: (r) => r.firstBookingAt, type: "date" },
          { header: "Last booking", value: (r) => r.lastBookingAt, type: "date" },
        ],
        rows: report.rows,
      });
    }
    sendJson(res, req, report);
  } catch (err) {
    handleReportError(res, err, "customer lifetime value report");
  }
};

// ── 8.1 ──────────────────────────────────────────────────────────────────────
export const GetBranchComparisonReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const report = await branchComparisonReport(f);
    if (f.exportCsv) {
      type R = (typeof report.rows)[number];
      return await streamCsv<R>(res, {
        filename: fileName("branch-comparison", f),
        columns: [
          { header: "Branch", value: (r) => r.branchName },
          { header: "Bookings", value: (r) => r.bookings, type: "number" },
          { header: "Cancellations", value: (r) => r.cancellations, type: "number" },
          { header: "Revenue", value: (r) => r.revenue, type: "money" },
          { header: "Avg revenue per booking", value: (r) => r.avgRevenuePerBooking, type: "money" },
          { header: "Collected", value: (r) => r.collected, type: "money" },
          { header: "Outstanding dues", value: (r) => r.due, type: "money" },
          { header: "Vehicles", value: (r) => r.vehicles, type: "number" },
          { header: "Rented days", value: (r) => r.rentedDays, type: "number" },
          { header: "Available days", value: (r) => r.availableDays, type: "number" },
          { header: "Utilization %", value: (r) => r.utilizationPct, type: "number" },
          ...(f.compare
            ? ([
                { header: "Revenue (previous)", value: (r) => r.previous?.revenue, type: "money" },
                { header: "Bookings (previous)", value: (r) => r.previous?.bookings, type: "number" },
                { header: "Utilization % (previous)", value: (r) => r.previous?.utilizationPct, type: "number" },
              ] as CsvColumn<R>[])
            : []),
        ],
        rows: report.rows,
      });
    }
    res.json(report);
  } catch (err) {
    handleReportError(res, err, "branch comparison report");
  }
};

// ── 8.2 ──────────────────────────────────────────────────────────────────────
// ?staffId=<User publicId>  ?kind=BOOKING_CREATED|PAYMENT_COLLECTED|REFUND_PAID|PICKUP|DROP
// ?view=staff (default CSV) | transactions (CSV of every action)
export const GetStaffActivityReport = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Q);
    const report = await staffActivityReport(f, { staffPublicId: str(req.query.staffId), kind: str(req.query.kind) });
    if (f.exportCsv) {
      if (str(req.query.view) === "transactions") {
        return await streamCsv<ActivityRow>(res, {
          filename: fileName("staff-activity-transactions", f),
          columns: [
            { header: "When", value: (r) => r.at, type: "datetime" },
            { header: "Staff", value: (r) => r.staffName },
            { header: "Role", value: (r) => r.staffRole },
            { header: "Activity", value: (r) => r.kindLabel },
            { header: "Branch", value: (r) => r.branchName },
            { header: "Booking ID", value: (r) => r.bookingId },
            { header: "Customer", value: (r) => r.customerName },
            { header: "Amount", value: (r) => r.amount, type: "money" },
            { header: "Cash", value: (r) => r.cash, type: "money" },
            { header: "Online", value: (r) => r.online, type: "money" },
            { header: "Detail", value: (r) => r.detail ?? "" },
          ],
          rows: report.transactions,
        });
      }
      type R = (typeof report.staff)[number];
      return await streamCsv<R>(res, {
        filename: fileName("staff-activity", f),
        columns: [
          { header: "Staff", value: (r) => r.staffName },
          { header: "Role", value: (r) => r.staffRole },
          { header: "Bookings created", value: (r) => r.bookingsCreated, type: "number" },
          { header: "Booking value", value: (r) => r.bookingValue, type: "money" },
          { header: "Payments collected", value: (r) => r.paymentsCollected, type: "number" },
          { header: "Amount collected", value: (r) => r.amountCollected, type: "money" },
          { header: "Cash collected", value: (r) => r.cashCollected, type: "money" },
          { header: "Online / UPI collected", value: (r) => r.onlineCollected, type: "money" },
          { header: "Refunds paid", value: (r) => r.refundsPaid, type: "number" },
          { header: "Refund amount", value: (r) => r.refundAmount, type: "money" },
          { header: "Pickups", value: (r) => r.pickups, type: "number" },
          { header: "Drops", value: (r) => r.drops, type: "number" },
          { header: "Handovers", value: (r) => r.handovers, type: "number" },
        ],
        rows: report.staff,
      });
    }
    const { rows, pagination } = paginate(report.transactions, parsePage(req.query as Q));
    res.json({ ...report, transactions: rows, pagination });
  } catch (err) {
    handleReportError(res, err, "staff activity report");
  }
};
