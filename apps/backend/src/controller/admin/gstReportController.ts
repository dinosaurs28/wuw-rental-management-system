import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { exportGSTToExcel } from "../../utils/exportToExcel.js";
import {
  resolveReportRange,
  parseCategoryIds,
  buildBookingWhere,
  REVENUE_BOOKING_STATUSES,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvDate,
} from "../../utils/reporting/index.js";

/**
 * GST Report Controller — conformed to spec §4.9.
 * GET /api/admin/dashboard/reports/gst
 *
 * Output GST only; Input GST (Section B) is DEFERRED — no Expense/VendorInvoice
 * tables exist, so Section B is rendered empty with a "not configured" note and
 * Net GST Liability = Total Output GST − 0 = Output total.
 *
 * Canonical conventions (spec §2):
 * - Anchor on booking.startAt via buildBookingWhere + REVENUE_BOOKING_STATUSES
 *   (NOT invoice.createdAt / invoice status). CONFIRMED bookings without a
 *   finalized invoice therefore appear; Document No falls back to Booking ID.
 * - CGST/SGST sourced from BookingItem.cgstAmount + sgstAmount (NEVER invoice.tax/2).
 * - IGST = 0 (no column in DB; intra-state).
 * - Taxable = booking.totalBase − booking.totalDiscount (base before GST).
 * - Customer GSTIN = "" (not stored; do NOT use branch gstNumber as customer GSTIN).
 *
 * Query Parameters:
 * - startDate / endDate (or preset / from / to)
 * - branchId / branch (optional)
 * - gstType: 'both' | 'output' | 'input' (optional, default both)
 * - categories / categoryId (optional)
 * - export: 'xlsx' | 'csv' (optional)
 */
export const GetGSTReport = async (req: Request, res: Response) => {
  try {
    const { branchId, branch, categories, categoryId, gstType, export: exportFormat } =
      req.query;

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

    // GST Type filter: Both / Output Only / Input Only.
    // Input is deferred (always empty), so "Input Only" yields an empty output set.
    const gstTypeNorm = String(gstType ?? "both").toLowerCase();
    const inputOnly = gstTypeNorm === "input" || gstTypeNorm === "input only";

    // ------------------------------------------------------------------
    // Source: bookings (revenue statuses, startAt anchor) — NOT invoices.
    // ------------------------------------------------------------------
    const bookings = inputOnly
      ? []
      : await prisma.booking.findMany({
          where: buildBookingWhere({
            branchPublicId,
            categoryPublicIds,
            from: start,
            to: end,
            statuses: REVENUE_BOOKING_STATUSES,
          }),
          include: {
            customer: {
              include: { user: { select: { name: true, phone: true } } },
            },
            branch: { select: { name: true } },
            invoice: { select: { invoiceNumber: true, publicId: true } },
            items: { select: { cgstAmount: true, sgstAmount: true } },
          },
          orderBy: { startAt: "asc" },
        });

    // ------------------------------------------------------------------
    // Build Section A (Output GST) rows + running totals.
    // ------------------------------------------------------------------
    let totalTaxableAmount = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    const totalIGST = 0; // intra-state only; no DB column
    let totalGST = 0;
    let totalInvoiceAmount = 0;

    const monthlyBreakdown: Record<string, any> = {};
    const branchBreakdown: Record<string, any> = {};

    const outputRows = bookings.map((b: any) => {
      const cgst = b.items.reduce((s: number, it: any) => s + Number(it.cgstAmount), 0);
      const sgst = b.items.reduce((s: number, it: any) => s + Number(it.sgstAmount), 0);
      const igst = 0;
      const rowGST = cgst + sgst;
      // Taxable = base before GST (booking.totalBase − totalDiscount).
      const taxableAmount = Number(b.totalBase) - Number(b.totalDiscount);
      const invoiceTotal = taxableAmount + rowGST;
      const documentNo = b.invoice?.invoiceNumber || b.invoice?.publicId || b.publicId;

      totalTaxableAmount += taxableAmount;
      totalCGST += cgst;
      totalSGST += sgst;
      totalGST += rowGST;
      totalInvoiceAmount += invoiceTotal;

      // Monthly breakdown (anchored on startAt)
      const monthKey = b.startAt.toISOString().substring(0, 7);
      if (!monthlyBreakdown[monthKey]) {
        monthlyBreakdown[monthKey] = {
          month: monthKey,
          invoiceCount: 0,
          taxableAmount: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          totalGST: 0,
          totalAmount: 0,
        };
      }
      monthlyBreakdown[monthKey].invoiceCount += 1;
      monthlyBreakdown[monthKey].taxableAmount += taxableAmount;
      monthlyBreakdown[monthKey].cgst += cgst;
      monthlyBreakdown[monthKey].sgst += sgst;
      monthlyBreakdown[monthKey].totalGST += rowGST;
      monthlyBreakdown[monthKey].totalAmount += invoiceTotal;

      // Branch breakdown
      const branchName = b.branch.name;
      if (!branchBreakdown[branchName]) {
        branchBreakdown[branchName] = {
          branchName,
          invoiceCount: 0,
          taxableAmount: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          totalGST: 0,
          totalAmount: 0,
        };
      }
      branchBreakdown[branchName].invoiceCount += 1;
      branchBreakdown[branchName].taxableAmount += taxableAmount;
      branchBreakdown[branchName].cgst += cgst;
      branchBreakdown[branchName].sgst += sgst;
      branchBreakdown[branchName].totalGST += rowGST;
      branchBreakdown[branchName].totalAmount += invoiceTotal;

      return {
        section: "Output GST",
        date: b.startAt.toISOString(),
        documentNo,
        partyName: b.customer.user.name,
        gstin: "", // Customer GSTIN not stored (spec §2 deferred) — blank, never branch GSTIN
        taxableAmount,
        cgst,
        sgst,
        igst,
        totalGST: rowGST,
        invoiceTotal,

        // --- Backward-compatible legacy field names (existing frontend/Excel) ---
        invoiceId: b.invoice?.publicId || b.publicId,
        invoiceNumber: documentNo,
        bookingId: b.publicId,
        customerName: b.customer.user.name,
        customerPhone: b.customer.user.phone,
        branch: branchName,
        invoiceDate: b.startAt.toISOString(),
        totalAmount: invoiceTotal,
        isInterState: false,
      };
    });

    // Net GST Liability = Total Output GST − Total Input GST (Input = 0).
    const totalInputGST = 0;
    const netLiability = totalGST - totalInputGST;

    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        dateRange: {
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
        },
        branch: branchPublicId ?? "All Branches",
        gstType: inputOnly ? "Input Only" : gstTypeNorm === "output" || gstTypeNorm === "output only" ? "Output Only" : "Both",
      },
      summary: {
        totalInvoices: outputRows.length,
        totalTaxableAmount,
        totalCGST,
        totalSGST,
        totalIGST,
        totalGST,
        totalInvoiceAmount,
        totalInputGST,
        netLiability,
        effectiveGSTRate:
          totalTaxableAmount > 0 ? (totalGST / totalTaxableAmount) * 100 : 0,
      },
      // Two-section structure (spec §4.9)
      sectionA_output: outputRows,
      sectionB_input: [] as any[],
      inputNote: "Input GST not configured",
      netLiability,
      monthlyBreakdown: Object.values(monthlyBreakdown).sort((a, b) =>
        a.month.localeCompare(b.month),
      ),
      branchBreakdown: Object.values(branchBreakdown).sort(
        (a, b) => b.totalGST - a.totalGST,
      ),
      // Backward-compatible: existing frontend table + Excel read `invoices`
      invoices: outputRows,
    };

    // ------------------------------------------------------------------
    // Exports
    // ------------------------------------------------------------------
    const filename = `gst-report-${csvDate(start)}-${csvDate(end)}`;

    if (exportFormat === "xlsx") {
      return await exportGSTToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      // Spec §4.9 column order, with Section + Document No, per-section summaries,
      // and a final Net GST Liability row.
      const columns = [
        "Section",
        "Date",
        "Document No",
        "Party Name",
        "GSTIN",
        "Taxable Amount",
        "CGST",
        "SGST",
        "IGST",
        "Total GST",
        "Invoice Total",
      ];

      const rows = outputRows.map((r) => ({
        Section: r.section,
        Date: csvDate(r.date),
        "Document No": r.documentNo,
        "Party Name": r.partyName,
        GSTIN: r.gstin,
        "Taxable Amount": csvCurrency(r.taxableAmount),
        CGST: csvCurrency(r.cgst),
        SGST: csvCurrency(r.sgst),
        IGST: csvCurrency(r.igst),
        "Total GST": csvCurrency(r.totalGST),
        "Invoice Total": csvCurrency(r.invoiceTotal),
      }));

      // Section A (Output) summary row
      const outputSummary = summaryRow(columns, "Output GST Total", {
        "Taxable Amount": csvCurrency(totalTaxableAmount),
        CGST: csvCurrency(totalCGST),
        SGST: csvCurrency(totalSGST),
        IGST: csvCurrency(totalIGST),
        "Total GST": csvCurrency(totalGST),
        "Invoice Total": csvCurrency(totalInvoiceAmount),
      });

      // Section B (Input) — deferred, empty
      const inputSummary = summaryRow(columns, "Input GST Total (not configured)", {
        "Taxable Amount": csvCurrency(0),
        CGST: csvCurrency(0),
        SGST: csvCurrency(0),
        IGST: csvCurrency(0),
        "Total GST": csvCurrency(0),
        "Invoice Total": csvCurrency(0),
      });

      const netRow = summaryRow(columns, "Net GST Liability", {
        "Total GST": csvCurrency(netLiability),
      });

      return exportRowsToCSV(res, {
        columns,
        rows,
        summaryRows: [outputSummary, inputSummary, netRow],
        filename,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "GST report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get GST Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate GST report",
    });
  }
};
