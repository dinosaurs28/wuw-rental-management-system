import { Request, Response } from "express";
import { z } from "zod";
import { StatusCode } from "../../types/statusCode.js";
import { exportRowsToCSV, summaryRow } from "../../utils/reporting/index.js";
import {
  MAX_PERIOD_DAYS,
  PeriodRangeError,
  formatIst,
  resolveGroupBy,
  resolveIstPeriod,
  type IstPeriod,
  type PeriodGroupBy,
} from "../../utils/reporting/istPeriod.js";
import {
  BOOKING_SOURCES,
  BranchReportError,
  LISTABLE_STATUSES,
  PERIOD_TYPES,
  getBranchPeriodSummary,
  getReportBranch,
  listBranchPeriodBookings,
  type PeriodBookingFilters,
} from "../../services/reporting/branch-period-report.service.js";
import { SYSTEM_TIMEZONE } from "../../services/timezone/timezone.service.js";

/**
 * Branch Manager "Period" tab (#14).
 *
 *   GET /api/branchManager/reports/period           summary + breakdowns + trend + bookings page
 *   GET /api/branchManager/reports/period/bookings  bookings page only (paging / filters)
 *   GET /api/branchManager/reports/period/export    CSV (bookings list, or the trend)
 *
 * Always the manager's own branch (req.branch_Id from the JWT). Dates are IST
 * calendar days `YYYY-MM-DD`; presets are resolved by the client.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Trim; blank ⇒ undefined so an empty `?search=` or `?from=` means "not sent". */
const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v;

/** 'all' in any case stays 'all'; anything else is upper-cased (status=confirmed works). */
const enumish = (v: unknown) => {
  const s = blankToUndefined(v);
  if (typeof s !== "string") return s;
  return s.toLowerCase() === "all" ? "all" : s.toUpperCase();
};

const periodQuerySchema = z.object({
  from: z.preprocess(
    blankToUndefined,
    z.string().regex(DATE, "'from' must be a date in YYYY-MM-DD format").optional(),
  ),
  to: z.preprocess(
    blankToUndefined,
    z.string().regex(DATE, "'to' must be a date in YYYY-MM-DD format").optional(),
  ),
  groupBy: z.preprocess(
    (v) => (typeof blankToUndefined(v) === "string" ? String(blankToUndefined(v)).toLowerCase() : blankToUndefined(v)),
    z
      .enum(["auto", "day", "week", "month"], {
        message: "'groupBy' must be one of auto, day, week, month",
      })
      .default("auto"),
  ),
  page: z.preprocess(
    blankToUndefined,
    z.coerce.number({ message: "'page' must be a number" }).int().min(1, "'page' must be 1 or more").default(1),
  ),
  pageSize: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ message: "'pageSize' must be a number" })
      .int()
      .min(1, "'pageSize' must be between 1 and 100")
      .max(100, "'pageSize' must be between 1 and 100")
      .default(25),
  ),
  status: z.preprocess(
    enumish,
    z
      .enum(["all", ...LISTABLE_STATUSES], {
        message: "'status' must be one of all, CONFIRMED, PICKED_UP, RETURNED, CANCELLED",
      })
      .default("all"),
  ),
  rentalPeriod: z.preprocess(
    enumish,
    z
      .enum(["all", ...PERIOD_TYPES], {
        message: "'rentalPeriod' must be one of all, HOURLY, HALF_DAY, FULL_DAY, MULTI_DAY, MONTHLY",
      })
      .default("all"),
  ),
  source: z.preprocess(
    enumish,
    z
      .enum(["all", ...BOOKING_SOURCES], {
        message: "'source' must be one of all, ONLINE, COUNTER",
      })
      .default("all"),
  ),
  search: z.preprocess(
    blankToUndefined,
    z.string().max(100, "'search' can be at most 100 characters").optional(),
  ),
  kind: z.preprocess(
    (v) => (typeof blankToUndefined(v) === "string" ? String(blankToUndefined(v)).toLowerCase() : blankToUndefined(v)),
    z
      .enum(["bookings", "trend"], { message: "'kind' must be bookings or trend" })
      .default("bookings"),
  ),
});

type PeriodQuery = z.infer<typeof periodQuerySchema>;

interface ResolvedRequest {
  query: PeriodQuery;
  period: IstPeriod;
  groupBy: PeriodGroupBy;
  filters: PeriodBookingFilters;
}

const fail = (
  res: Response,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) => res.status(status).json({ success: false, code, message, ...extra });

/** Parse + resolve the shared query; sends the 400 itself and returns null on failure. */
const resolveRequest = (req: Request, res: Response): ResolvedRequest | null => {
  const parsed = periodQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
    fail(
      res,
      StatusCode.BAD_REQUEST,
      "INVALID_PERIOD_QUERY",
      issues[0]?.message ?? "Invalid report filters.",
      { errors: issues },
    );
    return null;
  }

  let period: IstPeriod;
  try {
    period = resolveIstPeriod({ from: parsed.data.from, to: parsed.data.to });
  } catch (err) {
    if (err instanceof PeriodRangeError) {
      fail(res, StatusCode.BAD_REQUEST, err.code, err.message, {
        maxDays: MAX_PERIOD_DAYS,
      });
      return null;
    }
    throw err;
  }

  const q = parsed.data;
  return {
    query: q,
    period,
    groupBy: resolveGroupBy(q.groupBy, period.days),
    filters: {
      status: q.status,
      rentalPeriod: q.rentalPeriod,
      source: q.source,
      search: q.search,
    },
  };
};

const rangeBlock = (r: ResolvedRequest) => ({
  from: r.period.from,
  to: r.period.to,
  days: r.period.days,
  timezone: SYSTEM_TIMEZONE,
  groupBy: r.groupBy,
  groupByRequested: r.query.groupBy,
  previous: { from: r.period.prevFrom, to: r.period.prevTo },
});

const handleError = (res: Response, label: string, error: unknown) => {
  if (error instanceof BranchReportError) {
    return fail(res, error.status, error.code, error.message);
  }
  console.error(`${label} Error:`, error);
  return fail(
    res,
    StatusCode.INTERNAL_SERVER_ERROR,
    "PERIOD_REPORT_FAILED",
    "Could not load the period report. Please try again.",
  );
};

/**
 * GET /api/branchManager/reports/period
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=auto|day|week|month
 * &page&pageSize&status&rentalPeriod&source&search   (bookings list)
 */
export const GetPeriodReport = async (req: Request, res: Response) => {
  const r = resolveRequest(req, res);
  if (!r) return;
  try {
    const branch = await getReportBranch(req.branch_Id);
    const [report, bookings] = await Promise.all([
      getBranchPeriodSummary(branch, r.period, r.groupBy),
      listBranchPeriodBookings(branch, r.period, r.filters, {
        page: r.query.page,
        pageSize: r.query.pageSize,
      }),
    ]);

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Period report generated",
      data: {
        branch: { publicId: branch.publicId, name: branch.name },
        range: rangeBlock(r),
        generatedAt: new Date().toISOString(),
        ...report,
        bookings: { ...bookings, filters: r.filters },
      },
    });
  } catch (error) {
    return handleError(res, "GetPeriodReport", error);
  }
};

/**
 * GET /api/branchManager/reports/period/bookings
 * Same query as /reports/period; returns only the bookings page.
 */
export const GetPeriodBookings = async (req: Request, res: Response) => {
  const r = resolveRequest(req, res);
  if (!r) return;
  try {
    const branch = await getReportBranch(req.branch_Id);
    const bookings = await listBranchPeriodBookings(branch, r.period, r.filters, {
      page: r.query.page,
      pageSize: r.query.pageSize,
    });
    return res.status(StatusCode.OK).json({
      success: true,
      data: {
        branch: { publicId: branch.publicId, name: branch.name },
        range: rangeBlock(r),
        ...bookings,
        filters: r.filters,
      },
    });
  } catch (error) {
    return handleError(res, "GetPeriodBookings", error);
  }
};

/** CSV money: plain 2-dp number, no grouping or symbol. */
const money = (n: number) => n.toFixed(2);

/** Neutralise spreadsheet formulas in free text (names typed by people). */
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "branch";

/**
 * GET /api/branchManager/reports/period/export
 * kind=bookings (default): every booking matching the list filters (no paging).
 * kind=trend: one row per trend bucket for the range/groupBy.
 */
export const ExportPeriodReport = async (req: Request, res: Response) => {
  const r = resolveRequest(req, res);
  if (!r) return;
  try {
    const branch = await getReportBranch(req.branch_Id);
    const base = `period-${slug(branch.name)}-${r.period.from}-to-${r.period.to}`;

    if (r.query.kind === "trend") {
      const { trend } = await getBranchPeriodSummary(branch, r.period, r.groupBy);
      const columns = [
        "Period",
        "From",
        "To",
        "Bookings",
        "Booking Value",
        "Collected",
        "Cash",
        "Online",
        "Cancellations",
        "Returns",
        "Extensions",
        "Extension Amount",
        "Refunds",
        "Refund Amount",
      ];
      const rows = trend.map((t) => ({
        Period: t.label,
        From: t.from,
        To: t.to,
        Bookings: t.bookings,
        "Booking Value": money(t.bookingValue),
        Collected: money(t.collected),
        Cash: money(t.cash),
        Online: money(t.online),
        Cancellations: t.cancellations,
        Returns: t.returns,
        Extensions: t.extensions,
        "Extension Amount": money(t.extensionAmount),
        Refunds: t.refunds,
        "Refund Amount": money(t.refundAmount),
      }));
      const sum = (k: keyof (typeof trend)[number]) =>
        trend.reduce((s, t) => s + Number(t[k]), 0);
      const total = summaryRow(columns, "Total", {
        From: r.period.from,
        To: r.period.to,
        Bookings: sum("bookings"),
        "Booking Value": money(sum("bookingValue")),
        Collected: money(sum("collected")),
        Cash: money(sum("cash")),
        Online: money(sum("online")),
        Cancellations: sum("cancellations"),
        Returns: sum("returns"),
        Extensions: sum("extensions"),
        "Extension Amount": money(sum("extensionAmount")),
        Refunds: sum("refunds"),
        "Refund Amount": money(sum("refundAmount")),
      });
      return exportRowsToCSV(res, {
        columns,
        rows,
        summaryRows: [total],
        filename: `${base}-trend-by-${r.groupBy}`,
      });
    }

    const list = await listBranchPeriodBookings(branch, r.period, r.filters, {
      page: 1,
      pageSize: null,
    });
    const columns = [
      "Booking ID",
      "Customer",
      "Phone",
      "Vehicle",
      "Reg No",
      "Start (IST)",
      "End (IST)",
      "Rental Period",
      "Source",
      "Created By",
      "Status",
      "Extensions",
      "Total",
      "Paid",
      "Balance",
    ];
    const rows = list.rows.map((b) => ({
      "Booking ID": b.publicId,
      Customer: safeText(b.customerName),
      Phone: b.customerPhone,
      Vehicle: b.vehicle,
      "Reg No": b.regNo,
      "Start (IST)": formatIst(new Date(b.startAt)),
      "End (IST)": formatIst(new Date(b.endAt)),
      "Rental Period": b.rentalPeriodLabel,
      Source: b.sourceLabel,
      "Created By": b.counterStaffName ? safeText(b.counterStaffName) : "Customer",
      Status: b.statusLabel,
      Extensions: b.extensionCount,
      Total: money(b.total),
      Paid: money(b.paid),
      Balance: money(b.balance),
    }));
    const total = summaryRow(columns, "Total", {
      Customer: `${list.totals.bookings} booking${list.totals.bookings === 1 ? "" : "s"}`,
      Total: money(list.totals.total),
      Paid: money(list.totals.paid),
      Balance: money(list.totals.balance),
    });
    return exportRowsToCSV(res, {
      columns,
      rows,
      summaryRows: [total],
      filename: `${base}-bookings`,
    });
  } catch (error) {
    return handleError(res, "ExportPeriodReport", error);
  }
};
