import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { AdvanceDepositService } from "../../services/booking/advance-deposit.service.js";

const advanceDepositService = new AdvanceDepositService();

export const GetActiveBookings = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const { date } = req.query;

  let dateFilter: any = {};
  let dateKey: string | undefined = "all";

  if (date) {
    const targetDateDt = TimezoneService.parseISO(date as string);
    if (targetDateDt.isValid) {
      const startOfDayDt = TimezoneService.startOfDay(targetDateDt);
      const endOfDayDt = TimezoneService.endOfDay(targetDateDt);

      dateFilter = {
        startAt: {
          gte: TimezoneService.toPrisma(startOfDayDt),
          lte: TimezoneService.toPrisma(endOfDayDt),
        },
      };
      dateKey = targetDateDt.toFormat("yyyy-MM-dd");
    }
  }

  try {
    const cacheKey = `branch:${branchId}:active_bookings:${dateKey}:${page}:${limit}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      return res.status(StatusCode.OK).json({
        message: "Active bookings fetched successfully (cached)",
        data: JSON.parse(cachedData),
      });
    }

    const totalCount = await prisma.booking.count({
      where: {
        branchId: branchId,
        status: BookingStatus.CONFIRMED,
        ...dateFilter,
      },
    });

    const bookings = await prisma.booking.findMany({
      where: {
        branchId: branchId,
        status: BookingStatus.CONFIRMED,
        ...dateFilter,
      },
      select: {
        id: true,
        publicId: true,
        startAt: true,
        endAt: true,
        totalFinal: true,
        status: true,
        customer: {
          select: {
            id: true,
            publicId: true,
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        items: {
          select: {
            vehicle: {
              select: {
                make: true,
                model: true,
                regNo: true,
                images: {
                  where: {
                    isThumbnail: true,
                  },
                  take: 1,
                  select: {
                    file: {
                      select: {
                        url: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        startAt: "asc",
      },
      take: limit,
      skip: skip,
    });

    const responseData = {
      bookings,
      pagination: {
        total: totalCount,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    };

    await redis.setex(cacheKey, 60, JSON.stringify(responseData));

    return res.status(StatusCode.OK).json({
      message: "Active bookings fetched successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Active Bookings Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching active bookings",
    });
  }
};

export const GetPendingApprovals = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const { date } = req.query;

  let dateFilter: any = {};
  let dateKey: string | undefined = "all";

  if (date) {
    const targetDateDt = TimezoneService.parseISO(date as string);
    if (targetDateDt.isValid) {
      const startOfDayDt = TimezoneService.startOfDay(targetDateDt);
      const endOfDayDt = TimezoneService.endOfDay(targetDateDt);

      dateFilter = {
        startAt: {
          gte: TimezoneService.toPrisma(startOfDayDt),
          lte: TimezoneService.toPrisma(endOfDayDt),
        },
      };
      dateKey = targetDateDt.toFormat("yyyy-MM-dd");
    }
  }

  try {
    const cacheKey = `branch:${branchId}:pending_approvals:${dateKey}:${page}:${limit}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      return res.status(StatusCode.OK).json({
        message: "Pending approvals fetched successfully (cached)",
        data: JSON.parse(cachedData),
      });
    }

    const totalCount = await prisma.booking.count({
      where: {
        branchId: branchId,
        status: BookingStatus.PICKED_UP,
        ...dateFilter,
      },
    });

    const bookings = await prisma.booking.findMany({
      where: {
        branchId: branchId,
        status: BookingStatus.PICKED_UP,
        ...dateFilter,
      },
      select: {
        id: true,
        publicId: true,
        startAt: true,
        endAt: true,
        totalFinal: true,
        status: true,
        customer: {
          select: {
            id: true,
            publicId: true,
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        items: {
          select: {
            vehicle: {
              select: {
                make: true,
                model: true,
                regNo: true,
                images: {
                  where: {
                    isThumbnail: true,
                  },
                  take: 1,
                  select: {
                    file: {
                      select: {
                        url: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        startAt: "asc",
      },
      take: limit,
      skip: skip,
    });

    const responseData = {
      bookings,
      pagination: {
        total: totalCount,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    };

    await redis.setex(cacheKey, 60, JSON.stringify(responseData));

    return res.status(StatusCode.OK).json({
      message: "Pending approvals fetched successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Pending Approvals Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching pending approvals",
    });
  }
};

export const CollectSafetyDeposit = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { amount, method } = req.body;
  const userId = (req as any).user_Id;
  
  try {
    const result = await advanceDepositService.recordSafetyDeposit(
      Number(bookingId),
      Number(amount),
      method,
      userId
    );
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Safety deposit collected successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("Collect Safety Deposit Error:", error);
    if (error.message.includes("not found")) return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message.includes("must be CONFIRMED")) return res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const CancelNoShow = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { reason = "No Show" } = req.body;
  const userId = (req as any).user_Id;

  try {
    const result = await advanceDepositService.handleNoShowCancellation(
      Number(bookingId),
      userId,
      reason
    );
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Booking cancelled as no-show",
      data: result,
    });
  } catch (error: any) {
    console.error("Cancel No Show Error:", error);
    if (error.message.includes("not found")) return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message.includes("cannot be cancelled")) return res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const CalculateFinalBilling = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { totalBillAmount, setOffDeposit } = req.body;

  try {
    const result = await advanceDepositService.processFinalBilling(
      Number(bookingId),
      Number(totalBillAmount),
      Boolean(setOffDeposit)
    );
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Final billing calculated",
      data: result,
    });
  } catch (error: any) {
    console.error("Calculate Final Billing Error:", error);
    if (error.message.includes("not found")) return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message.includes("must be RETURNED")) return res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const RefundDeposit = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { amount, method } = req.body;
  const userId = (req as any).user_Id;

  try {
    const result = await advanceDepositService.refundSafetyDeposit(
      Number(bookingId),
      Number(amount),
      method,
      userId
    );
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Safety deposit refunded",
      data: result,
    });
  } catch (error: any) {
    console.error("Refund Deposit Error:", error);
    if (error.message.includes("not found")) return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message.includes("already refunded")) return res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
