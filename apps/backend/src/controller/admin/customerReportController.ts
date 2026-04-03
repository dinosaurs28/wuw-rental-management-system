import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { BookingStatus } from "@repo/database/client";

/**
 * Customer Report Controller
 * GET /api/admin/dashboard/reports/customers
 *
 * Query Parameters:
 * - startDate: YYYY-MM-DD (optional)
 * - endDate: YYYY-MM-DD (optional)
 * - branchId: string (optional)
 * - search: string (optional) — name / phone
 * - page: number (optional, default: 1)
 * - limit: number (optional, default: 50)
 */
export const GetCustomerReport = async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      branchId,
      search,
      page = "1",
      limit = "50",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);

    // Branch filter on bookings
    let branchDbId: number | undefined;
    if (branchId && branchId !== "all") {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
        select: { id: true },
      });
      if (branch) branchDbId = branch.id;
    }

    const bookingDateFilter =
      start && end
        ? { createdAt: { gte: start, lte: end } }
        : start
        ? { createdAt: { gte: start } }
        : end
        ? { createdAt: { lte: end } }
        : {};

    const searchFilter = search
      ? {
          user: {
            OR: [
              { name: { contains: search as string, mode: "insensitive" as const } },
              { phone: { contains: search as string, mode: "insensitive" as const } },
              { email: { contains: search as string, mode: "insensitive" as const } },
            ],
          },
        }
      : {};

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where: {
          deletedAt: null,
          ...searchFilter,
        },
        include: {
          user: { select: { name: true, phone: true, email: true, createdAt: true } },
          bookings: {
            where: {
              deletedAt: null,
              ...(branchDbId ? { branchId: branchDbId } : {}),
              ...bookingDateFilter,
              status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP, BookingStatus.RETURNED] },
            },
            select: {
              totalFinal: true,
              status: true,
              startAt: true,
              endAt: true,
              creditEntry: {
                select: { pendingAmount: true, status: true },
              },
            },
          },
          creditEntries: {
            select: { pendingAmount: true, totalAmount: true, status: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.customer.count({
        where: {
          deletedAt: null,
          ...searchFilter,
        },
      }),
    ]);

    const data = customers.map((c) => {
      const totalRevenue = c.bookings.reduce((s, b) => s + Number(b.totalFinal), 0);
      const totalOutstanding = c.creditEntries.reduce((s, e) => s + Number(e.pendingAmount), 0);
      const lastBooking = c.bookings.length > 0
        ? c.bookings.sort((a, b) => b.startAt.getTime() - a.startAt.getTime())[0]
        : null;

      return {
        customerId: c.publicId,
        name: c.user.name,
        phone: c.user.phone,
        email: c.user.email,
        registeredAt: c.user.createdAt.toISOString(),
        isProfileCompleted: c.isProfileCompleted,
        totalBookings: c.bookings.length,
        totalRevenue,
        totalOutstanding,
        lastBookingDate: lastBooking?.startAt?.toISOString() ?? null,
      };
    });

    // Summary
    const totalRevenue = data.reduce((s, c) => s + c.totalRevenue, 0);
    const totalOutstanding = data.reduce((s, c) => s + c.totalOutstanding, 0);
    const totalBookings = data.reduce((s, c) => s + c.totalBookings, 0);

    return res.status(StatusCode.OK).json({
      message: "Customer report generated successfully",
      data: {
        metadata: {
          generatedAt: new Date().toISOString(),
          dateRange: {
            startDate: start?.toISOString().split("T")[0] ?? null,
            endDate: end?.toISOString().split("T")[0] ?? null,
          },
        },
        summary: {
          totalCustomers: total,
          totalRevenue,
          totalOutstanding,
          totalBookings,
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
    console.error("Customer Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate customer report",
    });
  }
};
