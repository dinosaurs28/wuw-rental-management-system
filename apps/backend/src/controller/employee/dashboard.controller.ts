import type { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { BookingStatus } from "@repo/database/client";
import { startOfDay, endOfDay } from "date-fns";

/**
 * Get statistics for the employee dashboard
 * - Today's Pickups (Confirmed bookings starting today)
 * - Today's Returns (Picked up bookings ending today)
 * - Active Rentals (Total currently picked up)
 */
export const GetEmployeeDashboardStats = async (req: Request, res: Response) => {
  try {
    const branchId = (req as any).branch_Id;

    if (!branchId) {
      return res.status(403).json({ message: "Employee branch not found" });
    }

    const today = new Date();

    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);

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

    return res.status(200).json({
      todaysPickups,
      todaysReturns,
      activeRentals,
    });
  } catch (error) {
    console.error("Error fetching employee dashboard stats:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
