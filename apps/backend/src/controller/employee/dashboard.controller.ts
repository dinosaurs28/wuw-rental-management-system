import type { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { BookingStatus } from "@repo/database/client";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import {
  countOverdueReturns,
  listOverdueReturns,
  parseOverduePaging,
} from "../../services/booking/overdue-returns.service.js";
import { parseBookingListType, INVALID_BOOKING_TYPE } from "../../utils/booking/bookingTypeFilter.js";

/**
 * Get statistics for the employee dashboard
 * - Today's Pickups (Confirmed bookings starting today)
 * - Today's Returns (Picked up bookings ending today)
 * - Active Rentals (Total currently picked up)
 * - Overdue Returns (picked up, past endAt, vehicle not back yet)
 * "Today" is the IST business day, whatever the server's own timezone.
 */
export const GetEmployeeDashboardStats = async (req: Request, res: Response) => {
  try {
    const branchId = (req as any).branch_Id;

    if (!branchId) {
      return res.status(403).json({ message: "Employee branch not found" });
    }

    const todayStart = TimezoneService.toPrisma(TimezoneService.startOfDay());
    const todayEnd = TimezoneService.toPrisma(TimezoneService.endOfDay());

    // 1. Today's Pickups: CONFIRMED bookings with startAt today
    const todaysPickups = await prisma.booking.count({
      where: {
        branchId,
        status: BookingStatus.CONFIRMED,
        startAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    });

    // 2. Today's Returns: PICKED_UP bookings with endAt today
    const todaysReturns = await prisma.booking.count({
      where: {
        branchId,
        status: BookingStatus.PICKED_UP,
        endAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    });

    // 3. Active Rentals: All currently PICKED_UP bookings
    const activeRentals = await prisma.booking.count({
      where: {
        branchId,
        status: BookingStatus.PICKED_UP,
      },
    });

    // 4. Overdue Returns: PICKED_UP past endAt, excluding vehicles already back
    //    (awaiting manager confirmation / return payment in progress)
    const overdueReturns = await countOverdueReturns(branchId);

    return res.status(200).json({
      todaysPickups,
      todaysReturns,
      activeRentals,
      overdueReturns,
    });
  } catch (error) {
    console.error("Error fetching employee dashboard stats:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/employee/dashboard/overdue-returns?page&limit&type
 * Overdue / no-show returns for the staff member's own branch, most overdue
 * first. Always 200 — an empty list is `data: []`, never 404.
 */
export const GetEmployeeOverdueReturns = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    if (!branchId) {
      return res.status(403).json({
        success: false,
        code: "BRANCH_NOT_FOUND",
        message: "Employee branch not found",
      });
    }

    const parsedType = parseBookingListType(req.query.type);
    if (!parsedType.ok) {
      return res.status(400).json(INVALID_BOOKING_TYPE);
    }

    const { page, limit } = parseOverduePaging(req.query.page, req.query.limit);
    const result = await listOverdueReturns(branchId, { page, limit, type: parsedType.type });

    return res.status(200).json({
      success: true,
      message: "Overdue returns fetched successfully",
      ...result,
    });
  } catch (error) {
    console.error("Error fetching overdue returns:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching overdue returns",
    });
  }
};
