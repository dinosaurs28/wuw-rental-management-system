import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";

/**
 * Receipt Report Controller
 * GET /api/admin/dashboard/reports/receipts
 *
 * Query Parameters:
 * - startDate: YYYY-MM-DD (required)
 * - endDate: YYYY-MM-DD (required)
 * - branchId: string (optional)
 * - page: number (optional, default: 1)
 * - limit: number (optional, default: 50)
 */
export const GetReceiptReport = async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      branchId,
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

    let branchFilter: any = {};
    if (branchId && branchId !== "all") {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
        select: { id: true },
      });
      if (branch) branchFilter = { branchId: branch.id };
    }

    const where = {
      createdAt: { gte: start, lte: end },
      booking: {
        deletedAt: null,
        ...branchFilter,
      },
    };

    const [receipts, total] = await Promise.all([
      prisma.returnReceipt.findMany({
        where,
        include: {
          booking: {
            include: {
              customer: { include: { user: { select: { name: true, phone: true } } } },
              branch: { select: { name: true } },
            },
          },
          creditNotes: {
            select: {
              publicId: true,
              creditNoteNumber: true,
              amount: true,
              reason: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.returnReceipt.count({ where }),
    ]);

    // Summary aggregates
    const allReceipts = await prisma.returnReceipt.findMany({
      where,
      select: {
        totalCharges: true,
        depositPaid: true,
        amountDue: true,
        refundAmount: true,
      },
    });

    const totalCharges = allReceipts.reduce((s, r) => s + Number(r.totalCharges), 0);
    const totalDue = allReceipts.reduce((s, r) => s + Number(r.amountDue), 0);
    const totalRefunded = allReceipts.reduce((s, r) => s + Number(r.refundAmount), 0);

    const data = receipts.map((r) => ({
      receiptId: r.publicId,
      receiptNumber: r.receiptNumber ?? `RCP-${r.publicId.slice(0, 8).toUpperCase()}`,
      bookingId: r.booking.publicId,
      customer: {
        name: r.booking.customer.user.name,
        phone: r.booking.customer.user.phone,
      },
      branch: r.booking.branch.name,
      totalCharges: Number(r.totalCharges),
      depositPaid: Number(r.depositPaid),
      amountDue: Number(r.amountDue),
      refundAmount: Number(r.refundAmount),
      lineItems: r.lineItems,
      creditNotes: r.creditNotes.map((cn) => ({
        publicId: cn.publicId,
        creditNoteNumber: cn.creditNoteNumber,
        amount: Number(cn.amount),
        reason: cn.reason,
        status: cn.status,
      })),
      generatedAt: r.generatedAt?.toISOString() ?? r.createdAt.toISOString(),
    }));

    return res.status(StatusCode.OK).json({
      message: "Receipt report generated successfully",
      data: {
        metadata: {
          generatedAt: new Date().toISOString(),
          dateRange: {
            startDate: start.toISOString().split("T")[0],
            endDate: end.toISOString().split("T")[0],
          },
        },
        summary: {
          totalReceipts: total,
          totalCharges,
          totalDue,
          totalRefunded,
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
    console.error("Receipt Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate receipt report",
    });
  }
};
