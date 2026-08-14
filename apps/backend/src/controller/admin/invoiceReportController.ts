import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, Prisma } from "@repo/database/client";
import {
  resolveReportRange,
  getPaidByBooking,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvDate,
} from "../../utils/reporting/index.js";

/**
 * Invoice Report Controller — conformed to spec §4.10.
 * GET /api/admin/dashboard/reports/invoices
 *
 * - Anchored on invoice.createdAt (invoices exist regardless of booking status),
 *   sorted desc. Does NOT use buildBookingWhere / revenue statuses.
 * - Payment Status is DERIVED from payments (getPaidByBooking), NOT invoice.status:
 *     Paid    = paid >= total
 *     Partial = 0 < paid < total
 *     Unpaid  = paid == 0
 *   Because the filter is derived, when a paymentStatus filter or export is active
 *   we fetch all candidates, compute paid, filter in memory, then paginate (like Sales).
 * - Adds: Amount Paid, Balance Due (= total − paid, never negative; overpaid flag),
 *   Vehicle (name + reg via booking.items[0].vehicle), Rental Period (startAt–endAt).
 *
 * Query Parameters:
 * - startDate / endDate (or preset / from / to)
 * - branchId / branch (optional)
 * - paymentStatus: 'all' | 'paid' | 'partial' | 'unpaid' (optional — DERIVED)
 * - customer: string (optional, matches customer name or phone)
 * - page / limit (optional)
 * - export: 'csv' (optional)
 */

type DerivedStatus = "Paid" | "Partial" | "Unpaid";

const derivePaymentStatus = (paid: number, total: number): DerivedStatus => {
  if (paid >= total && total > 0) return "Paid";
  if (paid <= 0) return "Unpaid";
  return paid >= total ? "Paid" : "Partial";
};

const normalizeStatusFilter = (raw: unknown): DerivedStatus | null => {
  const s = String(raw ?? "all").toLowerCase().replace(/\s+/g, "");
  if (s === "paid") return "Paid";
  if (s === "partial" || s === "partiallypaid") return "Partial";
  if (s === "unpaid") return "Unpaid";
  return null; // "all" or unrecognized
};

export const GetInvoiceReport = async (req: Request, res: Response) => {
  try {
    const {
      branchId,
      branch,
      paymentStatus,
      customer,
      page = "1",
      limit = "50",
      export: exportFormat,
    } = req.query;

    const { start, end } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      from: req.query.from,
      to: req.query.to,
    });

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;

    const customerSearch =
      customer && String(customer).trim() ? String(customer).trim() : undefined;

    const statusFilter = normalizeStatusFilter(paymentStatus);
    const wantAll = Boolean(exportFormat) || statusFilter !== null;

    // Build invoice where (anchor on invoice.createdAt). Status of the booking is
    // intentionally NOT constrained — invoices exist regardless.
    const bookingWhere: Prisma.BookingWhereInput = { deletedAt: null };
    if (branchPublicId) bookingWhere.branch = { publicId: branchPublicId };
    if (customerSearch) {
      bookingWhere.customer = {
        user: {
          OR: [
            { name: { contains: customerSearch, mode: "insensitive" } },
            { phone: { contains: customerSearch, mode: "insensitive" } },
          ],
        },
      };
    }

    const where: Prisma.InvoiceWhereInput = {
      createdAt: { gte: start, lte: end },
      booking: bookingWhere,
    };

    const invoiceInclude = {
      booking: {
        include: {
          customer: {
            include: { user: { select: { name: true, phone: true } } },
          },
          branch: { select: { name: true } },
          items: {
            include: {
              vehicle: { select: { regNo: true, make: true, model: true } },
            },
          },
        },
      },
    } satisfies Prisma.InvoiceInclude;

    // Fetch candidate invoices. When the derived payment-status filter or an
    // export is active we need ALL rows to compute paid + filter/sum in memory;
    // otherwise we can DB-paginate and compute paid only for the page slice.
    const candidates = await prisma.invoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: { createdAt: "desc" },
      ...(wantAll ? {} : { skip: (pageNum - 1) * limitNum, take: limitNum }),
    });

    // For summary + derived filtering we always need paid across the full set.
    const allInvoices = wantAll
      ? candidates
      : await prisma.invoice.findMany({
          where,
          include: invoiceInclude,
          orderBy: { createdAt: "desc" },
        });

    const paidMap = await getPaidByBooking(
      allInvoices.map((inv) => inv.booking.id),
    );

    const buildRow = (inv: (typeof allInvoices)[number]) => {
      const total = Number(inv.total);
      const paid = paidMap.get(inv.booking.id)?.total ?? 0;
      const overpaid = paid > total;
      const balanceDue = Math.max(0, total - paid);
      const derived = derivePaymentStatus(paid, total);
      const v = inv.booking.items[0]?.vehicle;
      const vehicleName = v ? `${v.make} ${v.model}` : "N/A";

      return {
        invoiceId: inv.publicId,
        invoiceNumber:
          inv.invoiceNumber ?? `INV-${inv.publicId.slice(0, 8).toUpperCase()}`,
        bookingId: inv.booking.publicId,
        customer: {
          name: inv.booking.customer.user.name,
          phone: inv.booking.customer.user.phone,
        },
        branch: inv.booking.branch.name,
        vehicle: { regNo: v?.regNo || "N/A", name: vehicleName },
        period: {
          startDate: inv.booking.startAt.toISOString(),
          endDate: inv.booking.endAt.toISOString(),
        },
        subtotal: Number(inv.subtotal),
        discount: Number(inv.discount),
        tax: Number(inv.tax),
        damageCharges: Number(inv.damageCharges),
        total,
        amountPaid: paid,
        balanceDue,
        overpaid,
        paymentStatus: derived,
        // Legacy field retained for backward compatibility (raw invoice status).
        status: inv.status,
        generatedAt: inv.generatedAt?.toISOString() ?? inv.createdAt.toISOString(),
        invoiceDate: inv.createdAt.toISOString(),
      };
    };

    const allRows = allInvoices.map(buildRow);

    // Apply derived payment-status filter in memory.
    const filteredRows = statusFilter
      ? allRows.filter((r) => r.paymentStatus === statusFilter)
      : allRows;

    // Summary over the filtered set.
    const totalBilled = filteredRows.reduce((s, r) => s + r.total, 0);
    const totalDiscount = filteredRows.reduce((s, r) => s + r.discount, 0);
    const totalTax = filteredRows.reduce((s, r) => s + r.tax, 0);
    const totalPaid = filteredRows.reduce((s, r) => s + r.amountPaid, 0);
    const totalBalance = filteredRows.reduce((s, r) => s + r.balanceDue, 0);
    const paidCount = filteredRows.filter((r) => r.paymentStatus === "Paid").length;
    const partialCount = filteredRows.filter((r) => r.paymentStatus === "Partial").length;
    const unpaidCount = filteredRows.filter((r) => r.paymentStatus === "Unpaid").length;
    // Legacy summary field: "pending" = not fully paid.
    const pendingCount = partialCount + unpaidCount;

    const totalRecords = filteredRows.length;

    // Page slice (when not exporting).
    const pageRows = wantAll
      ? filteredRows
      : filteredRows.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    const filename = `invoice-report-${csvDate(start)}-${csvDate(end)}`;

    if (exportFormat === "csv") {
      // Spec §4.10 column order. CSV omits the PDF link (uses Invoice No).
      const columns = [
        "Invoice No",
        "Invoice Date",
        "Booking ID",
        "Customer Name",
        "Customer Phone",
        "Vehicle",
        "Rental Period",
        "Base Amount",
        "Discount",
        "GST",
        "Invoice Total",
        "Amount Paid",
        "Balance Due",
        "Payment Status",
      ];

      const csvRows = filteredRows.map((r) => ({
        "Invoice No": r.invoiceNumber,
        "Invoice Date": csvDate(r.invoiceDate),
        "Booking ID": r.bookingId,
        "Customer Name": r.customer.name,
        "Customer Phone": r.customer.phone,
        Vehicle: `${r.vehicle.name} (${r.vehicle.regNo})`,
        "Rental Period": `${csvDate(r.period.startDate)} - ${csvDate(r.period.endDate)}`,
        "Base Amount": csvCurrency(r.subtotal),
        Discount: csvCurrency(r.discount),
        GST: csvCurrency(r.tax),
        "Invoice Total": csvCurrency(r.total),
        "Amount Paid": csvCurrency(r.amountPaid),
        "Balance Due": csvCurrency(r.balanceDue),
        "Payment Status": r.paymentStatus,
      }));

      const summary = summaryRow(columns, "TOTAL", {
        "Base Amount": csvCurrency(filteredRows.reduce((s, r) => s + r.subtotal, 0)),
        Discount: csvCurrency(totalDiscount),
        GST: csvCurrency(totalTax),
        "Invoice Total": csvCurrency(totalBilled),
        "Amount Paid": csvCurrency(totalPaid),
        "Balance Due": csvCurrency(totalBalance),
      });

      return exportRowsToCSV(res, {
        columns,
        rows: csvRows,
        summaryRows: [summary],
        filename,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Invoice report generated successfully",
      data: {
        metadata: {
          generatedAt: new Date().toISOString(),
          dateRange: {
            startDate: start.toISOString().split("T")[0],
            endDate: end.toISOString().split("T")[0],
          },
          branch: branchPublicId ?? "All Branches",
          paymentStatus: statusFilter ?? "All",
        },
        summary: {
          totalInvoices: totalRecords,
          totalBilled,
          totalDiscount,
          totalTax,
          totalPaid,
          totalBalance,
          paidCount,
          partialCount,
          unpaidCount,
          pendingCount,
        },
        data: pageRows,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalRecords / limitNum) || 1,
          totalRecords,
          hasNext: pageNum * limitNum < totalRecords,
          hasPrev: pageNum > 1,
        },
      },
    });
  } catch (error) {
    console.error("Invoice Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate invoice report",
    });
  }
};
