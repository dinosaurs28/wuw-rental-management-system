import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { exportGSTToExcel } from "../../utils/exportToExcel.js";
import { exportGSTToCSV } from "../../utils/exportToCSV.js";

/**
 * GST Report Controller
 * GET /api/dashboard/reports/gst
 *
 * Generates GST/Tax compliance report with CGST, SGST, IGST breakdown
 *
 * Query Parameters:
 * - startDate: string (required) - Format: YYYY-MM-DD
 * - endDate: string (required) - Format: YYYY-MM-DD
 * - branchId: string (optional) - Filter by branch
 * - export: 'xlsx' | 'csv' (optional)
 */
export const GetGSTReport = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, branchId, export: exportFormat } = req.query;

    if (!startDate || !endDate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Start date and end date are required",
      });
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Build filter for branch
    let branchFilter: any = {};
    if (branchId && branchId !== "all") {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
      });
      if (branch) {
        branchFilter = { branchId: branch.id };
      }
    }

    // ========================================================================
    // Fetch invoices with GST details
    // ========================================================================

    const invoices = await prisma.invoice.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
        status: { in: ["FINALIZED", "PAID"] },
        booking: branchFilter.branchId
          ? { branchId: branchFilter.branchId }
          : undefined,
      },
      include: {
        booking: {
          include: {
            customer: {
              include: {
                user: {
                  select: {
                    name: true,
                    phone: true,
                  },
                },
              },
            },
            branch: {
              select: {
                name: true,
                publicId: true,
                gstRule: {
                  select: {
                    gstNumber: true,
                    cgstRate: true,
                    sgstRate: true,
                    igstRate: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // ========================================================================
    // Calculate GST breakdown
    // For simplicity, assuming all transactions are intra-state (CGST + SGST)
    // In real implementation, you'd determine IGST based on state comparison
    // ========================================================================

    let totalTaxableAmount = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalIGST = 0;
    let totalGST = 0;
    let totalInvoiceAmount = 0;

    const gstBreakdown = invoices.map((invoice: any) => {
      const taxableAmount = Number(invoice.subtotal);
      const gstAmount = Number(invoice.tax);
      const gstRule = invoice.booking.branch.gstRule;

      const cgstRate = Number(gstRule?.cgstRate ?? 9);
      const sgstRate = Number(gstRule?.sgstRate ?? 9);
      const totalRate = cgstRate + sgstRate;

      // All assumed intra-state (CGST + SGST)
      const cgst = totalRate > 0 ? (gstAmount * cgstRate) / totalRate : gstAmount / 2;
      const sgst = totalRate > 0 ? (gstAmount * sgstRate) / totalRate : gstAmount / 2;
      const igst = 0;

      totalTaxableAmount += taxableAmount;
      totalCGST += cgst;
      totalSGST += sgst;
      totalGST += gstAmount;
      totalInvoiceAmount += Number(invoice.total);

      return {
        invoiceId: invoice.publicId,
        invoiceNumber: invoice.invoiceNumber || invoice.publicId,
        bookingId: invoice.booking.publicId,
        customerName: invoice.booking.customer.user.name,
        customerPhone: invoice.booking.customer.user.phone,
        gstin: gstRule?.gstNumber || "-",
        branch: invoice.booking.branch.name,
        invoiceDate: invoice.createdAt.toISOString(),
        taxableAmount,
        cgst,
        sgst,
        igst,
        totalGST: gstAmount,
        totalAmount: Number(invoice.total),
        gstRate: totalRate,
        isInterState: false,
      };
    });

    // ========================================================================
    // Monthly breakdown
    // ========================================================================

    const monthlyBreakdown: Record<string, any> = {};

    invoices.forEach((invoice: any) => {
      const monthKey = invoice.createdAt.toISOString().substring(0, 7); // YYYY-MM

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

      const taxableAmount = Number(invoice.subtotal);
      const gstAmount = Number(invoice.tax);
      const gstRule = invoice.booking.branch.gstRule;
      const cgstRate = Number(gstRule?.cgstRate ?? 9);
      const sgstRate = Number(gstRule?.sgstRate ?? 9);
      const totalRate = cgstRate + sgstRate;

      monthlyBreakdown[monthKey].invoiceCount += 1;
      monthlyBreakdown[monthKey].taxableAmount += taxableAmount;
      monthlyBreakdown[monthKey].totalGST += gstAmount;
      monthlyBreakdown[monthKey].totalAmount += Number(invoice.total);
      monthlyBreakdown[monthKey].cgst += totalRate > 0 ? (gstAmount * cgstRate) / totalRate : gstAmount / 2;
      monthlyBreakdown[monthKey].sgst += totalRate > 0 ? (gstAmount * sgstRate) / totalRate : gstAmount / 2;
    });

    // ========================================================================
    // Branch-wise GST breakdown
    // ========================================================================

    const branchBreakdown: Record<string, any> = {};

    invoices.forEach((invoice: any) => {
      const branchName = invoice.booking.branch.name;

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

      const taxableAmount = Number(invoice.subtotal);
      const gstAmount = Number(invoice.tax);
      const gstRule = invoice.booking.branch.gstRule;
      const cgstRate = Number(gstRule?.cgstRate ?? 9);
      const sgstRate = Number(gstRule?.sgstRate ?? 9);
      const totalRate = cgstRate + sgstRate;

      branchBreakdown[branchName].invoiceCount += 1;
      branchBreakdown[branchName].taxableAmount += taxableAmount;
      branchBreakdown[branchName].totalGST += gstAmount;
      branchBreakdown[branchName].totalAmount += Number(invoice.total);
      branchBreakdown[branchName].cgst += totalRate > 0 ? (gstAmount * cgstRate) / totalRate : gstAmount / 2;
      branchBreakdown[branchName].sgst += totalRate > 0 ? (gstAmount * sgstRate) / totalRate : gstAmount / 2;
    });

    // ========================================================================
    // Build response
    // ========================================================================

    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        dateRange: {
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
        },
        branch: branchId && branchId !== "all" ? branchId : "All Branches",
      },
      summary: {
        totalInvoices: invoices.length,
        totalTaxableAmount,
        totalCGST,
        totalSGST,
        totalIGST,
        totalGST,
        totalInvoiceAmount,
        effectiveGSTRate:
          totalTaxableAmount > 0 ? (totalGST / totalTaxableAmount) * 100 : 0,
      },
      monthlyBreakdown: Object.values(monthlyBreakdown).sort((a, b) =>
        a.month.localeCompare(b.month),
      ),
      branchBreakdown: Object.values(branchBreakdown).sort(
        (a, b) => b.totalGST - a.totalGST,
      ),
      invoices: gstBreakdown,
    };

    // ========================================================================
    // Handle export if requested
    // ========================================================================

    if (exportFormat === "xlsx") {
      const filename = `gst-report-${start.toISOString().split("T")[0]}-${end.toISOString().split("T")[0]}`;
      return await exportGSTToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      const filename = `gst-report-${start.toISOString().split("T")[0]}-${end.toISOString().split("T")[0]}`;
      return exportGSTToCSV(res, reportData, filename);
    }

    // Return JSON response
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
