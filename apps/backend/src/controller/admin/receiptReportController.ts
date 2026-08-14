import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, Prisma, Role } from "@repo/database/client";
import {
  resolveReportRange,
  classifyOnline,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvDate,
  COLLECTED_PAYMENT_STATUSES,
  REVENUE_PAYMENT_PURPOSES,
  type SpecPaymentMode,
} from "../../utils/reporting/index.js";

/**
 * Receipt Report — PER-PAYMENT (spec §4.4).
 * GET /api/admin/dashboard/reports/receipts
 *
 * Source: PaymentTransaction (one row per collected payment) — NOT ReturnReceipt.
 * Anchored on payment date (collectedAt, fallback createdAt), sorted desc.
 *
 * Filters: branch (publicId), date range, Payment Mode (All/Cash/UPI/Gateway/Credit
 * — Credit never matches a collected payment), Staff (collectedById).
 *
 * Columns (spec §4.4 order): Receipt No, Receipt Date, Booking ID, Invoice No,
 * Customer Name, Customer Phone, Amount Received, Payment Mode, Transaction Ref,
 * Collected By, Branch. Total row = SUM(Amount Received).
 *
 * INVARIANT (spec §5.4): Receipt Σ(Amount Received) == Collection Grand Total for
 * the same date + payment-mode filters. To guarantee this, the WHERE clause below
 * MIRRORS the shared `getCollections` core exactly (same status/purpose set,
 * same payment-date OR anchor, same branch relation, same collectedById, same
 * sort), and the per-row dominant-mode classification is identical to the
 * Collection controller's.
 */

type ReportMode = SpecPaymentMode; // "Cash" | "UPI" | "Gateway" | "Credit"

const STAFF_ROLES: Role[] = [Role.STAFF, Role.MANAGER, Role.ADMIN];

/** Dominant mode of a collected payment (cash > gateway > upi by amount). */
const dominantMode = (cash: number, upi: number, gateway: number): ReportMode => {
  const entries: [ReportMode, number][] = [
    ["Cash", cash],
    ["Gateway", gateway],
    ["UPI", upi],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]![1] > 0 ? entries[0]![0] : "Cash";
};

/** Accept both spec (Cash/UPI/Gateway/Credit) and legacy (CASH/UPI/ONLINE) vocab. */
const parseModeFilter = (
  raw: unknown,
): ReportMode | "Online" | undefined => {
  if (!raw || String(raw) === "all") return undefined;
  const v = String(raw).toUpperCase();
  if (v === "CASH") return "Cash";
  if (v === "UPI") return "UPI";
  if (v === "GATEWAY") return "Gateway";
  if (v === "CREDIT") return "Credit";
  if (v === "ONLINE") return "Online";
  return undefined;
};

const modeMatches = (
  rowMode: ReportMode,
  filter: ReportMode | "Online",
): boolean => {
  if (filter === "Online") return rowMode === "UPI" || rowMode === "Gateway";
  return rowMode === filter;
};

export const GetReceiptReport = async (req: Request, res: Response) => {
  try {
    const {
      branchId,
      branch,
      paymentMethod,
      paymentMode,
      staff,
      staffId,
      collectedBy,
      page = "1",
      limit = "50",
      export: exportFormat,
    } = req.query;

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;

    const { start, end } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      from: req.query.from,
      to: req.query.to,
    });

    const modeFilter = parseModeFilter(paymentMode ?? paymentMethod);

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));

    // --- Resolve staff publicId -> User.id (STAFF/MANAGER/ADMIN) ---
    const staffPublicId =
      staff && String(staff) !== "all"
        ? String(staff)
        : staffId && String(staffId) !== "all"
          ? String(staffId)
          : collectedBy && String(collectedBy) !== "all"
            ? String(collectedBy)
            : undefined;

    let collectedById: number | undefined;
    if (staffPublicId) {
      const staffUser = await prisma.user.findFirst({
        where: { publicId: staffPublicId, role: { in: STAFF_ROLES } },
        select: { id: true },
      });
      if (staffUser) collectedById = staffUser.id;
      else {
        return res.status(StatusCode.OK).json({
          message: "Receipt report generated successfully",
          data: emptyReport(start, end, branchPublicId, modeFilter, staffPublicId, pageNum),
        });
      }
    }

    // --- WHERE: mirrors getCollections (collected revenue txns, payment-date anchor) ---
    const where: Prisma.PaymentTransactionWhereInput = {
      status: { in: COLLECTED_PAYMENT_STATUSES },
      purpose: { in: REVENUE_PAYMENT_PURPOSES },
      OR: [
        { collectedAt: { gte: start, lte: end } },
        { collectedAt: null, createdAt: { gte: start, lte: end } },
      ],
    };
    if (branchPublicId) where.branch = { publicId: branchPublicId };
    if (collectedById) where.collectedById = collectedById;

    // Fetch the full filtered set (mode filter is applied in-app per dominant mode,
    // so pagination + totals are computed after classification).
    const txns = await prisma.paymentTransaction.findMany({
      where,
      select: {
        publicId: true,
        totalAmount: true,
        cashAmount: true,
        onlineAmount: true,
        onlineGateway: true,
        onlineTransactionRef: true,
        collectedAt: true,
        createdAt: true,
        collectedById: true,
        booking: {
          select: {
            publicId: true,
            invoice: { select: { invoiceNumber: true } },
            customer: { select: { user: { select: { name: true, phone: true } } } },
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }],
    });

    // Classify each payment and apply the payment-mode filter (identical to Collection).
    const classified = txns.map((t) => {
      const online = Number(t.onlineAmount);
      const isGateway = classifyOnline(t.onlineGateway) === "Gateway";
      const cash = Number(t.cashAmount);
      const upi = online > 0 && !isGateway ? online : 0;
      const gateway = online > 0 && isGateway ? online : 0;
      return {
        t,
        mode: dominantMode(cash, upi, gateway),
        amount: Number(t.totalAmount),
      };
    });

    const matched = modeFilter
      ? classified.filter((r) => modeMatches(r.mode, modeFilter))
      : classified;

    const totalAmountReceived = matched.reduce((s, r) => s + r.amount, 0);
    const totalRecords = matched.length;

    // --- Resolve collector names ---
    const staffIds = [
      ...new Set(
        matched
          .map((r) => r.t.collectedById)
          .filter((id): id is number => id !== null),
      ),
    ];
    const staffUsers = staffIds.length
      ? await prisma.user.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true },
        })
      : [];
    const staffNameById = new Map(staffUsers.map((u) => [u.id, u.name]));

    const toRow = (r: (typeof matched)[number]) => {
      const { t, mode, amount } = r;
      return {
        receiptNo: t.publicId,
        receiptDate: (t.collectedAt ?? t.createdAt).toISOString(),
        bookingId: t.booking.publicId,
        invoiceNo: t.booking.invoice?.invoiceNumber ?? "",
        customerName: t.booking.customer.user.name,
        customerPhone: t.booking.customer.user.phone,
        amountReceived: amount,
        paymentMode: mode,
        transactionRef: t.onlineTransactionRef ?? "",
        collectedBy:
          t.collectedById !== null
            ? (staffNameById.get(t.collectedById) ?? "Unknown")
            : "—",
        branch: t.booking.branch.name,
      };
    };

    const allRows = matched.map(toRow);

    // CSV: export the full filtered set (all rows), not just the page.
    if (exportFormat === "csv") {
      const columns = [
        "Receipt No",
        "Receipt Date",
        "Booking ID",
        "Invoice No",
        "Customer Name",
        "Customer Phone",
        "Amount Received",
        "Payment Mode",
        "Transaction Ref",
        "Collected By",
        "Branch",
      ];
      const csvRows = allRows.map((r) => ({
        "Receipt No": r.receiptNo,
        "Receipt Date": csvDate(r.receiptDate),
        "Booking ID": r.bookingId,
        "Invoice No": r.invoiceNo,
        "Customer Name": r.customerName,
        "Customer Phone": r.customerPhone,
        "Amount Received": csvCurrency(r.amountReceived),
        "Payment Mode": r.paymentMode,
        "Transaction Ref": r.transactionRef,
        "Collected By": r.collectedBy,
        Branch: r.branch,
      }));
      const totalRow = summaryRow(columns, "TOTAL", {
        "Amount Received": csvCurrency(totalAmountReceived),
      });
      return exportRowsToCSV(res, {
        columns,
        rows: csvRows,
        summaryRows: [totalRow],
        filename: `receipt-report-${csvDate(start)}-${csvDate(end)}`,
      });
    }

    // JSON: paginate the classified+filtered rows.
    const pageRows = allRows.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    const totalPages = Math.ceil(totalRecords / limitNum) || 1;

    return res.status(StatusCode.OK).json({
      message: "Receipt report generated successfully",
      data: {
        metadata: {
          generatedAt: new Date().toISOString(),
          dateRange: {
            startDate: start.toISOString().split("T")[0],
            endDate: end.toISOString().split("T")[0],
          },
          branch: branchPublicId ?? "All Branches",
          paymentMode: modeFilter ?? "All",
          staff: staffPublicId ?? "All",
        },
        summary: {
          totalReceipts: totalRecords,
          totalAmountReceived,
        },
        data: pageRows,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalRecords,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
        },
      },
    });
  } catch (error) {
    console.error("Receipt Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate receipt report",
    });
  }
};

const emptyReport = (
  start: Date,
  end: Date,
  branchPublicId: string | undefined,
  modeFilter: ReportMode | "Online" | undefined,
  staffPublicId: string | undefined,
  pageNum: number,
) => ({
  metadata: {
    generatedAt: new Date().toISOString(),
    dateRange: {
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
    },
    branch: branchPublicId ?? "All Branches",
    paymentMode: modeFilter ?? "All",
    staff: staffPublicId ?? "All",
  },
  summary: { totalReceipts: 0, totalAmountReceived: 0 },
  data: [] as unknown[],
  pagination: {
    currentPage: pageNum,
    totalPages: 1,
    totalRecords: 0,
    hasNext: false,
    hasPrev: pageNum > 1,
  },
});
