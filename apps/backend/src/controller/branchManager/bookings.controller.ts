import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, VehicleStatus } from "@repo/database/client";
import { managerConfirmPickupSchema } from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";
import { redis } from "../../lib/redisconfig.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { AdvanceDepositService } from "../../services/booking/advance-deposit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { financialStateService, branchPaymentConfigService } from "../../services/payment/index.js";

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
        isAdvancePayment: true,
        advanceAmount: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaidDuring: true,
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
        isAdvancePayment: true,
        advanceAmount: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaidDuring: true,
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
  const userId = req.public_Id;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: branchId },
    });

    if (!booking) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });
    }

    const result = await advanceDepositService.recordSafetyDeposit(
      booking.id,
      Number(amount),
      method,
      userId,
    );
    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.DEPOSIT,
      entityRef: booking.publicId,
      description: `Safety deposit of ₹${amount} collected for booking ${booking.publicId}`,
      metadata: { amount, method },
    });
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Safety deposit collected successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("Collect Safety Deposit Error:", error);
    if (error.message.includes("not found"))
      return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message.includes("must be CONFIRMED"))
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: error.message });
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const CancelNoShow = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { reason = "No Show" } = req.body;
  const userId = req.public_Id as string;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: branchId },
    });
    if (!booking)
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });

    const result = await advanceDepositService.handleNoShowCancellation(
      booking.id,
      userId as any,
      reason,
    );
    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CANCELLED,
      entityType: StaffEntityType.BOOKING,
      entityRef: booking.publicId,
      description: `Booking ${booking.publicId} cancelled due to no-show`,
      metadata: { reason },
    });
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Booking cancelled as no-show",
      data: result,
    });
  } catch (error: any) {
    console.error("Cancel No Show Error:", error);
    if (error.message.includes("not found"))
      return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message.includes("cannot be cancelled"))
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: error.message });
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const CalculateFinalBilling = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { totalBillAmount, setOffDeposit } = req.body;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: branchId },
    });
    if (!booking)
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });

    const result = await advanceDepositService.processFinalBilling(
      booking.id,
      Number(totalBillAmount),
      Boolean(setOffDeposit),
    );
    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.ASSESSED,
      entityType: StaffEntityType.PAYMENT,
      entityRef: booking.publicId,
      description: `Final billing ₹${totalBillAmount} calculated for booking ${booking.publicId}`,
      metadata: { totalBillAmount, setOffDeposit },
    });
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Final billing calculated",
      data: result,
    });
  } catch (error: any) {
    console.error("Calculate Final Billing Error:", error);
    if (error.message.includes("not found"))
      return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message.includes("must be RETURNED"))
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: error.message });
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const RefundDeposit = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { amount, method } = req.body;
  const userId = req.public_Id as string;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: branchId },
    });
    if (!booking)
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });

    const result = await advanceDepositService.refundSafetyDeposit(
      booking.id,
      Number(amount),
      method,
      userId as any,
    );
    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.REFUNDED,
      entityType: StaffEntityType.DEPOSIT,
      entityRef: booking.publicId,
      description: `Safety deposit of ₹${amount} refunded for booking ${booking.publicId}`,
      metadata: { amount, method },
    });
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Safety deposit refunded",
      data: result,
    });
  } catch (error: any) {
    console.error("Refund Deposit Error:", error);
    if (error.message.includes("not found"))
      return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message.includes("already refunded"))
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: error.message });
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const ConfirmPickupWithDeposit = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;
  const userId = req.public_Id as string;

  try {
    const { requireManagerConfirmation } = req.body;

    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingId,
        branchId: branchId,
      },
      include: {
        items: {
          select: {
            vehicleId: true,
          },
        },
      },
    });

    if (!booking) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });
    }

    if (
      booking.status !== BookingStatus.CONFIRMED ||
      !booking.requiresManagerConfirmation
    ) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({
          message:
            "Booking does not require manager confirmation or is not in CONFIRMED state",
        });
    }

    if (requireManagerConfirmation !== false) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({
          message: "Payload must have requireManagerConfirmation: false",
        });
    }

    // Extension gate: block pickup if a pending extension exists
    if (booking.activeExtensionId !== null) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "A pending extension must be completed or cancelled before vehicle pickup",
      });
    }

    // Payment gate: verify booking is financially cleared before allowing pickup
    const [financialState, paymentConfig] = await Promise.all([
      financialStateService.getState(booking.id),
      branchPaymentConfigService.getConfig(branchId),
    ]);
    const strictMode = paymentConfig.cashConfirmationEnabled && paymentConfig.blockProgressionUntilConfirmed;
    const allowedStates = strictMode
      ? ["FULLY_PAID"]
      : ["FULLY_PAID", "PAID_PENDING_CONFIRMATION"];
    if (!allowedStates.includes(financialState.lifecycleState)) {
      return res.status(StatusCode.PAYMENT_REQUIRED).json({
        message: "Payment must be collected and confirmed before vehicle pickup",
        financialState: {
          lifecycleState: financialState.lifecycleState,
          amountDue: financialState.amountDue,
        },
      });
    }

    const vehicleIds = booking.items.map((item) => item.vehicleId);

    const actingUser = await prisma.user.findUnique({
      where: { publicId: userId },
    });

    if (!actingUser) {
      return res
        .status(StatusCode.UNAUTHORIZED)
        .json({ message: "User not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.PICKED_UP,
          requiresManagerConfirmation: false,
        },
      });

      await tx.vehicle.updateMany({
        where: { id: { in: vehicleIds } },
        data: {
          status: VehicleStatus.OUT_FOR_RENTAL,
        },
      });

      await staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.CONFIRMED,
        entityType: StaffEntityType.BOOKING,
        entityRef: booking.publicId,
        description: `Manager confirmed vehicle pickup for booking ${booking.publicId}`,
      }, tx);
    });

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Pickup confirmed successfully. Vehicle is now OUT_FOR_RENTAL.",
    });
  } catch (error: any) {
    console.error("Manager Confirm Pickup Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const ConfirmReturnByManager = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;
  const userId = req.public_Id as string;

  try {
    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingId,
        branchId: branchId,
      },
      include: {
        items: {
          select: {
            vehicleId: true,
          },
        },
      },
    });

    if (!booking) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });
    }

    if (
      booking.status !== BookingStatus.PICKED_UP ||
      !booking.requiresManagerConfirmation
    ) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({
          message:
            "Booking does not require manager confirmation or is not in PICKED_UP state",
        });
    }

    const vehicleIds = booking.items.map((item) => item.vehicleId);

    const actingUser = await prisma.user.findUnique({
      where: { publicId: userId },
    });

    if (!actingUser) {
      return res
        .status(StatusCode.UNAUTHORIZED)
        .json({ message: "User not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.RETURNED,
          requiresManagerConfirmation: false,
        },
      });

      await tx.vehicle.updateMany({
        where: { id: { in: vehicleIds } },
        data: {
          status: VehicleStatus.AVAILABLE,
        },
      });

      await staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.CONFIRMED,
        entityType: StaffEntityType.BOOKING,
        entityRef: booking.publicId,
        description: `Manager confirmed vehicle return for booking ${booking.publicId}`,
      }, tx);
    });

    // Invalidate public vehicle cache
    let cursor = "0";
    do {
      const reply = await redis.scan(
        cursor,
        "MATCH",
        "public:vehicles:*",
        "COUNT",
        100,
      );
      cursor = reply[0];
      const keys = reply[1];
      if (keys.length > 0) {
        await redis.del(keys);
      }
    } while (cursor !== "0");

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Return confirmed successfully. Vehicle is now AVAILABLE.",
    });
  } catch (error: any) {
    console.error("Manager Confirm Return Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const GetManagerConfirmations = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;

  try {
    const bookings = await prisma.booking.findMany({
      where: {
        branchId: branchId,
        requiresManagerConfirmation: true,
      },
      select: {
        id: true,
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        totalFinal: true,
        requiresManagerConfirmation: true,
        safetyDeposit: true,
        customer: {
          select: {
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
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
                odo: true,
                fuelLevel: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.status(StatusCode.OK).json({
      success: true,
      data: bookings,
    });
  } catch (error: any) {
    console.error("Manager Confirmations fetch error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching confirmations",
    });
  }
};

export const GetBookingVehicleDetails = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: branchId },
      select: {
        items: {
          select: {
            vehicle: {
              select: {
                make: true,
                model: true,
                regNo: true,
                images: {
                  where: { isThumbnail: true },
                  take: 1,
                  select: { file: { select: { url: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });
    }

    const vehicle = booking.items[0]?.vehicle ?? null;

    return res.status(StatusCode.OK).json({
      success: true,
      data: vehicle
        ? {
            make: vehicle.make,
            model: vehicle.model,
            regNo: vehicle.regNo,
            image: vehicle.images[0]?.file?.url ?? null,
          }
        : null,
    });
  } catch (error: any) {
    console.error("GetBookingVehicleDetails error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const GetConfirmationDetails = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingId,
        branchId: branchId,
      },
      select: {
        status: true,
        totalFinal: true,
        isAdvancePayment: true,
        advanceAmount: true,
        advancePaidAt: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaymentMode: true,
        remainingPaidDuring: true,
        safetyDeposit: true,
        safetyDepositMethod: true,
        customer: {
          select: {
            user: {
              select: {
                name: true,
                phone: true,
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
                odo: true,
                fuelLevel: true,
              },
            },
          },
        },
        photos: {
          select: {
            id: true,
            file: {
              select: {
                url: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!booking) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });
    }

    return res.status(StatusCode.OK).json({
      success: true,
      data: booking,
    });
  } catch (error: any) {
    console.error("Manager Confirmation details error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};
