import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { InvoiceStatus } from "@repo/database/client";

/**
 * Invoice Report Controller
 * GET /api/admin/dashboard/reports/invoices
 *
 * Query Parameters:
 * - startDate: YYYY-MM-DD (required)
 * - endDate: YYYY-MM-DD (required)
 * - branchId: string (optional)
 * - status: InvoiceStatus (optional)
 * - page: number (optional, default: 1)
 * - limit: number (optional, default: 50)
 */
export const GetInvoiceReport = async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      branchId,
      status,
      page = "1",
      limit = "50",
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "startDate and endDate are required (format: YYYY-MM-DD)",
      });
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    // Resolve branchId → internal id
    let branchFilter: any = {};
    if (branchId && branchId !== "all") {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
        select: { id: true },
      });
      if (branch) branchFilter = { branchId: branch.id };
    }

    const statusFilter = status && status !== "all"
      ? { status: status as InvoiceStatus }
      : {};

    const where = {
      createdAt: { gte: start, lte: end },
      booking: {
        deletedAt: null,
        ...branchFilter,
      },
      ...statusFilter,
    };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          booking: {
            include: {
              customer: { include: { user: { select: { name: true, phone: true } } } },
              branch: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.invoice.count({ where }),
    ]);

    // Summary aggregates
    const allInvoices = await prisma.invoice.findMany({
      where,
      select: { total: true, status: true, discount: true, tax: true },
    });

    const totalBilled = allInvoices.reduce((s, i) => s + Number(i.total), 0);
    const totalDiscount = allInvoices.reduce((s, i) => s + Number(i.discount), 0);
    const totalTax = allInvoices.reduce((s, i) => s + Number(i.tax), 0);

    const paidCount = allInvoices.filter((i) => i.status === "PAID").length;
    const pendingCount = allInvoices.filter((i) => i.status !== "PAID").length;

    const data = invoices.map((inv) => ({
      invoiceId: inv.publicId,
      invoiceNumber: inv.invoiceNumber ?? `INV-${inv.publicId.slice(0, 8).toUpperCase()}`,
      bookingId: inv.booking.publicId,
      customer: {
        name: inv.booking.customer.user.name,
        phone: inv.booking.customer.user.phone,
      },
      branch: inv.booking.branch.name,
      subtotal: Number(inv.subtotal),
      discount: Number(inv.discount),
      tax: Number(inv.tax),
      damageCharges: Number(inv.damageCharges),
      total: Number(inv.total),
      status: inv.status,
      generatedAt: inv.generatedAt?.toISOString() ?? inv.createdAt.toISOString(),
    }));

    return res.status(StatusCode.OK).json({
      message: "Invoice report generated successfully",
      data: {
        metadata: {
          generatedAt: new Date().toISOString(),
          dateRange: {
            startDate: start.toISOString().split("T")[0],
            endDate: end.toISOString().split("T")[0],
          },
        },
        summary: {
          totalInvoices: total,
          totalBilled,
          totalDiscount,
          totalTax,
          paidCount,
          pendingCount,
        },
        data,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalRecords: total,
          hasNext: pageNum * limitNum < total,
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
