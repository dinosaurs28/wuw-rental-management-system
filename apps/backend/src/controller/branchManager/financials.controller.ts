import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { StatusCode } from "../../types/statusCode.js";
import { exportRowsToCSV, summaryRow } from "../../utils/reporting/index.js";
import { SYSTEM_TIMEZONE } from "../../services/timezone/timezone.service.js";
import {
  ExportTooLargeError,
  exportFinancialsRows,
  getFinancialsSummary,
  listCollectors,
  listFinancialsRows,
  parseFinancialsQuery,
  type FinancialsFilter,
  type FinancialsRow,
} from "../../services/financials/financials-query.js";
import { CLIENT_PAYMENT_TYPES, CLIENT_PAYMENT_TYPE_LABELS } from "../../services/financials/payment-type.js";

/**
 * Branch Manager → Financials → "Financials" sub-tab (Oct 2026). VIEW ONLY: there is no
 * write endpoint here (money actions live in the booking drawer and the Cash Shift tab).
 *
 *   GET /api/branchManager/financials/payments         summary cards + one page of rows
 *   GET /api/branchManager/financials/payments/export  ?format=csv|xlsx — every filtered row
 *   GET /api/branchManager/financials/options          payment types + fleet members for the filters
 *
 * Always the manager's own branch (req.branch_Id from the JWT). Filters (all optional):
 * from/to (YYYY-MM-DD IST, default today) · types=RENT,LATE_FEE… · modes=CASH,UPI,GATEWAY ·
 * collectedBy=<user publicId>|ONLINE · shiftStatus=OPEN|CLOSED|NONE · search ·
 * sort=date|amount|type · dir=asc|desc · page · pageSize (≤ 100).
 */

const fail = (res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  res.status(status).json({ success: false, code, message, ...extra });

function resolve(req: Request, res: Response): FinancialsFilter | null {
  const branchId = req.branch_Id;
  if (!branchId) {
    fail(res, StatusCode.FORBIDDEN, "NO_BRANCH", "Your account is not linked to a branch.");
    return null;
  }
  const parsed = parseFinancialsQuery(req.query, branchId);
  if (!parsed.ok) {
    fail(res, StatusCode.BAD_REQUEST, parsed.code, parsed.message, parsed.errors ? { errors: parsed.errors } : {});
    return null;
  }
  return parsed.filter;
}

const echoFilters = (f: FinancialsFilter) => ({
  from: f.from,
  to: f.to,
  types: f.types,
  modes: f.modes,
  collectedBy: f.collectedBy,
  shiftStatus: f.shiftStatus,
  search: f.search,
  sort: f.sort,
  dir: f.dir,
});

const sum = (rows: FinancialsRow[], k: "amount" | "cash" | "upi" | "gateway") =>
  Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;

export const GetFinancialsPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const f = resolve(req, res);
    if (!f) return;
    const [summary, rows] = await Promise.all([getFinancialsSummary(f), listFinancialsRows(f)]);
    const totalRows = summary.total.count;
    res.status(StatusCode.OK).json({
      success: true,
      data: {
        filters: echoFilters(f),
        summary,
        rows,
        pageTotal: { count: rows.length, amount: sum(rows, "amount"), cash: sum(rows, "cash"), upi: sum(rows, "upi"), gateway: sum(rows, "gateway") },
        pagination: { page: f.page, pageSize: f.pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / f.pageSize)) },
      },
    });
  } catch (error) {
    console.error("GetFinancialsPayments Error:", error);
    fail(res, StatusCode.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Could not load the payments.");
  }
};

const istDateTime = (iso: string) => DateTime.fromISO(iso).setZone(SYSTEM_TIMEZONE).toFormat("dd-MM-yyyy HH:mm");

const shiftLabel = (r: FinancialsRow) => (r.shift ? (r.shift.isOpen ? "Open" : "Closed") : "");

const COLUMNS = [
  "Date & time (IST)",
  "Payment type",
  "Amount",
  "Cash",
  "UPI",
  "Online gateway",
  "Payment mode",
  "Booking ID",
  "Customer name",
  "Customer phone",
  "Vehicle",
  "Collected by",
  "Cash shift ID",
  "Shift status",
  "Status",
  "Reference",
  "Transaction ID",
  "Transaction total",
  "Notes",
];

const toExportRow = (r: FinancialsRow): Record<string, string | number> => ({
  "Date & time (IST)": istDateTime(r.paidAt),
  "Payment type": r.typeLabel,
  Amount: r.amount,
  Cash: r.cash,
  UPI: r.upi,
  "Online gateway": r.gateway,
  "Payment mode": r.mode,
  "Booking ID": r.bookingId,
  "Customer name": r.customerName,
  "Customer phone": r.customerPhone,
  Vehicle: r.vehicle,
  "Collected by": r.collectedBy?.name ?? "Online (customer)",
  "Cash shift ID": r.shift?.id ?? "",
  "Shift status": shiftLabel(r),
  Status: r.status === "COLLECTED" ? "Awaiting confirmation" : "Confirmed",
  Reference: r.reference ?? "",
  "Transaction ID": r.transactionId,
  "Transaction total": r.transactionTotal,
  Notes: r.notes ?? "",
});

export const ExportFinancialsPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const format = String(req.query.format ?? "csv").toLowerCase();
    if (format !== "csv" && format !== "xlsx") {
      fail(res, StatusCode.BAD_REQUEST, "INVALID_FORMAT", "'format' must be csv or xlsx");
      return;
    }
    const f = resolve(req, res);
    if (!f) return;
    const rows = await exportFinancialsRows(f);
    const filename = `financials_${f.from}_to_${f.to}`;
    const totals = { Amount: sum(rows, "amount"), Cash: sum(rows, "cash"), UPI: sum(rows, "upi"), "Online gateway": sum(rows, "gateway") };

    if (format === "csv") {
      exportRowsToCSV(res, {
        columns: COLUMNS,
        rows: rows.map(toExportRow),
        summaryRows: [summaryRow(COLUMNS, `Total (${rows.length} rows)`, totals)],
        filename,
      });
      return;
    }

    // Streamed workbook: a year of rows without building it all in memory
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
    const ws = wb.addWorksheet("Payments");
    ws.columns = COLUMNS.map((c) => ({ header: c, key: c, width: c === "Notes" ? 30 : 18 }));
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF5F00" } };
    header.commit();
    for (const r of rows) ws.addRow(toExportRow(r)).commit();
    const last = ws.addRow(summaryRow(COLUMNS, `Total (${rows.length} rows)`, totals));
    last.font = { bold: true };
    last.commit();
    ws.commit();
    await wb.commit();
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      fail(res, StatusCode.BAD_REQUEST, "EXPORT_TOO_LARGE", error.message);
      return;
    }
    console.error("ExportFinancialsPayments Error:", error);
    if (!res.headersSent) fail(res, StatusCode.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Could not export the payments.");
  }
};

export const GetFinancialsOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const branchId = req.branch_Id;
    if (!branchId) {
      fail(res, StatusCode.FORBIDDEN, "NO_BRANCH", "Your account is not linked to a branch.");
      return;
    }
    const collectors = await listCollectors(branchId);
    res.status(StatusCode.OK).json({
      success: true,
      data: {
        types: CLIENT_PAYMENT_TYPES.map((t) => ({ type: t, label: CLIENT_PAYMENT_TYPE_LABELS[t] })),
        modes: [
          { mode: "CASH", label: "Cash" },
          { mode: "UPI", label: "UPI" },
          { mode: "GATEWAY", label: "Online (gateway)" },
        ],
        collectors,
      },
    });
  } catch (error) {
    console.error("GetFinancialsOptions Error:", error);
    fail(res, StatusCode.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Could not load the filter options.");
  }
};
