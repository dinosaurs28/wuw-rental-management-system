import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, PaymentStatus } from "@repo/database/client";
import { exportSalesReportToExcel } from "../../utils/exportToExcel.js";
import {
  resolveReportRange,
  parseCategoryIds,
  buildBookingWhere,
  getPaidByBooking,
  REVENUE_BOOKING_STATUSES,
  DB_STATUS_TO_SPEC,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvDate,
  type PaidAmounts,
} from "../../utils/reporting/index.js";

/**
 * Sales Report — the master reconciliation report (spec §3).
 *
 * Conformed to spec: date range anchored on startAt (booking_start_date),
 * category + payment-mode filters, GST sourced from BookingItem (cgst+sgst),
 * cancelled rows shown with revenue 0 and excluded from sums, sort by
 * booking_start_date desc, spec-ordered CSV with a summary row.
 *
 * INVARIANT: summary.totalRevenue is computed via the SAME buildBookingWhere
 * (revenue statuses, startAt) the dashboard uses, so it always matches the
 * dashboard "Revenue (Selected)" card for the same branch/date/category filters.
 */

const SALES_TABLE_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
  BookingStatus.RETURNED,
  BookingStatus.CANCELLED,
];

type SpecMode = "Cash" | "UPI" | "Gateway" | "Credit";

const primaryMode = (paid: PaidAmounts | undefined): SpecMode => {
  if (!paid || paid.total <= 0) return "Credit";
  const entries: [SpecMode, number][] = [
    ["Cash", paid.cash],
    ["UPI", paid.upi],
    ["Gateway", paid.gateway],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]![1] > 0 ? entries[0]![0] : "Credit";
};

export const GetSalesReport = async (req: Request, res: Response) => {
  try {
    const {
      branchId,
      branch,
      categories,
      categoryId,
      status,
      paymentStatus,
      paymentMode,
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
    const categoryPublicIds = parseCategoryIds(categories ?? categoryId);
    const { start, end } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      from: req.query.from,
      to: req.query.to,
    });

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));

    const paymentModeFilter =
      paymentMode && String(paymentMode) !== "all"
        ? (String(paymentMode) as SpecMode)
        : undefined;

    // Table status set: explicit status filter, else all real sales statuses.
    const tableStatuses =
      status && Object.values(BookingStatus).includes(status as BookingStatus)
        ? [status as BookingStatus]
        : SALES_TABLE_STATUSES;

    const baseFilter = { branchPublicId, categoryPublicIds, from: start, to: end };
    const tableWhere = {
      ...buildBookingWhere({ ...baseFilter, statuses: tableStatuses }),
      ...(paymentStatus &&
      Object.values(PaymentStatus).includes(paymentStatus as PaymentStatus)
        ? { paymentStatus: paymentStatus as PaymentStatus }
        : {}),
    };

    // --- Canonical revenue (matches dashboard exactly) ---
    const canonicalAgg = await prisma.booking.aggregate({
      _sum: { totalFinal: true },
      _count: true,
      where: buildBookingWhere({ ...baseFilter, statuses: REVENUE_BOOKING_STATUSES }),
    });
    const canonicalRevenue = Number(canonicalAgg._sum.totalFinal || 0);

    // --- Full filtered set (lightweight) for summary + payment-mode filtering ---
    const fullSet = await prisma.booking.findMany({
      where: tableWhere,
      select: { id: true, totalFinal: true, status: true, startAt: true },
      orderBy: { startAt: "desc" },
    });
    const paidMap = await getPaidByBooking(fullSet.map((b) => b.id));

    const enriched = fullSet.map((b) => {
      const paid = paidMap.get(b.id);
      const isCancelled = b.status === BookingStatus.CANCELLED;
      const total = Number(b.totalFinal);
      return {
        id: b.id,
        mode: primaryMode(paid),
        paid: paid?.total ?? 0,
        revenue: isCancelled ? 0 : total,
        outstanding: isCancelled ? 0 : Math.max(0, total - (paid?.total ?? 0)),
        isCancelled,
      };
    });

    const matched = paymentModeFilter
      ? enriched.filter((e) => e.mode === paymentModeFilter)
      : enriched;

    const totalCount = matched.length;
    const displayedRevenue = matched.reduce((s, e) => s + e.revenue, 0);
    const totalCollected = matched.reduce((s, e) => s + e.paid, 0);
    const totalOutstanding = matched.reduce((s, e) => s + e.outstanding, 0);
    // When no status/payment-mode narrowing, displayed revenue == canonical.
    const totalRevenue =
      !paymentModeFilter && tableStatuses === SALES_TABLE_STATUSES
        ? canonicalRevenue
        : displayedRevenue;

    // --- Page slice (all rows for export) ---
    const wantAll = Boolean(exportFormat);
    const pageSlice = wantAll
      ? matched
      : matched.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    const pageIds = pageSlice.map((e) => e.id);

    const detailRows = await prisma.booking.findMany({
      where: { id: { in: pageIds } },
      include: {
        customer: { include: { user: { select: { name: true, phone: true, email: true } } } },
        items: {
          include: {
            vehicle: {
              select: { regNo: true, make: true, model: true, category: { select: { name: true } } },
            },
          },
        },
        branch: { select: { name: true } },
        invoice: { select: { publicId: true, invoiceNumber: true } },
        createdBy: { select: { name: true } },
      },
    });
    const detailById = new Map(detailRows.map((b) => [b.id, b]));

    const formatted = pageSlice
      .map((e) => {
        const b = detailById.get(e.id);
        if (!b) return null;
        const gst = b.items.reduce(
          (s, it) => s + Number(it.cgstAmount) + Number(it.sgstAmount),
          0,
        );
        const v = b.items[0]?.vehicle;
        const vehicleName = v ? `${v.make} ${v.model}` : "N/A";
        return {
          bookingId: b.publicId,
          bookingDate: b.createdAt.toISOString(),
          invoiceNumber: b.invoice?.invoiceNumber || b.invoice?.publicId || "N/A",
          customer: {
            name: b.customer.user.name,
            phone: b.customer.user.phone,
            email: b.customer.user.email,
          },
          vehicle: {
            regNo: v?.regNo || "N/A",
            name: vehicleName,
            details: vehicleName,
            category: v?.category.name || "N/A",
          },
          category: v?.category.name || "N/A",
          period: {
            startDate: b.startAt.toISOString(),
            endDate: b.endAt.toISOString(),
            days: b.days,
          },
          financial: {
            baseAmount: Number(b.totalBase),
            discount: Number(b.totalDiscount),
            gstAmount: gst,
            totalTax: gst,
            totalAmount: Number(b.totalFinal),
            amountPaid: e.paid,
            outstanding: e.outstanding,
            balanceAmount: e.outstanding,
            revenue: e.revenue,
          },
          paymentMode: e.mode,
          payment: {
            mode: e.mode,
            paymentStatus: b.paymentStatus,
            transactionId: b.transactionId || undefined,
          },
          status: b.status,
          statusLabel: DB_STATUS_TO_SPEC[b.status] ?? b.status,
          isCancelled: e.isCancelled,
          branch: b.branch.name,
          createdBy: b.createdBy.name,
        };
      })
      .filter(<T,>(x: T | null): x is T => x !== null)
      .sort(
        (a, b) =>
          new Date(b.period.startDate).getTime() -
          new Date(a.period.startDate).getTime(),
      );

    // Breakdown widgets (byCategory from displayed rows; status/branch via groupBy)
    const [statusGroup, branchGroup] = await Promise.all([
      prisma.booking.groupBy({
        by: ["status"],
        where: tableWhere,
        _sum: { totalFinal: true },
        _count: true,
      }),
      prisma.booking.groupBy({
        by: ["branchId"],
        where: tableWhere,
        _sum: { totalFinal: true },
        _count: true,
      }),
    ]);
    const branchIds = branchGroup.map((g) => g.branchId);
    const branchNames = await prisma.branch.findMany({
      where: { id: { in: branchIds } },
      select: { id: true, name: true },
    });
    const branchNameMap = Object.fromEntries(branchNames.map((b) => [b.id, b.name]));
    const categoryBreakdown = formatted.reduce<Record<string, { category: string; count: number; revenue: number }>>(
      (acc, row) => {
        const c = row.category;
        if (!acc[c]) acc[c] = { category: c, count: 0, revenue: 0 };
        acc[c].count += 1;
        acc[c].revenue += row.financial.revenue;
        return acc;
      },
      {},
    );

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    const reportData = {
      metadata: {
        period: { start: start.toISOString(), end: end.toISOString() },
        filters: {
          branch: branchPublicId ?? "All Branches",
          status: status || "All",
          paymentMode: paymentModeFilter || "All",
        },
        generatedAt: new Date().toISOString(),
      },
      summary: {
        totalRevenue,
        totalBookings: totalCount,
        averageBookingValue: totalCount > 0 ? totalRevenue / totalCount : 0,
        totalCollected,
        outstandingAmount: totalOutstanding,
      },
      breakdown: {
        byStatus: statusGroup.map((g) => ({
          status: g.status,
          count: g._count,
          revenue: Number(g._sum.totalFinal || 0),
        })),
        byBranch: branchGroup.map((g) => ({
          branch: branchNameMap[g.branchId] || "Unknown",
          count: g._count,
          revenue: Number(g._sum.totalFinal || 0),
        })),
        byCategory: Object.values(categoryBreakdown),
      },
      data: formatted,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRecords: totalCount,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    };

    if (exportFormat === "xlsx") {
      return await exportSalesReportToExcel(
        res,
        reportData,
        `sales-report-${csvDate(start)}-${csvDate(end)}`,
      );
    }

    if (exportFormat === "csv") {
      const columns = [
        "Booking ID", "Booking Date", "Start Date", "End Date", "Customer Name",
        "Phone", "Vehicle Reg", "Vehicle Name", "Category", "Branch", "Duration",
        "Base Amount", "Discount", "GST Amount", "Total Amount", "Amount Paid",
        "Outstanding", "Payment Mode", "Status",
      ];
      const rows = formatted.map((r) => ({
        "Booking ID": r.bookingId,
        "Booking Date": csvDate(r.bookingDate),
        "Start Date": csvDate(r.period.startDate),
        "End Date": csvDate(r.period.endDate),
        "Customer Name": r.customer.name,
        Phone: r.customer.phone,
        "Vehicle Reg": r.vehicle.regNo,
        "Vehicle Name": r.vehicle.name,
        Category: r.category,
        Branch: r.branch,
        Duration: `${r.period.days}`,
        "Base Amount": csvCurrency(r.financial.baseAmount),
        Discount: csvCurrency(r.financial.discount),
        "GST Amount": csvCurrency(r.financial.gstAmount),
        "Total Amount": csvCurrency(r.financial.totalAmount),
        "Amount Paid": csvCurrency(r.financial.amountPaid),
        Outstanding: csvCurrency(r.financial.outstanding),
        "Payment Mode": r.paymentMode,
        Status: r.statusLabel,
      }));
      const summary = summaryRow(columns, "TOTAL", {
        "Total Amount": csvCurrency(totalRevenue),
        "Amount Paid": csvCurrency(totalCollected),
        Outstanding: csvCurrency(totalOutstanding),
      });
      return exportRowsToCSV(res, {
        columns,
        rows,
        summaryRows: [summary],
        filename: `sales-report-${csvDate(start)}-${csvDate(end)}`,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Sales report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Sales Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate sales report",
    });
  }
};
