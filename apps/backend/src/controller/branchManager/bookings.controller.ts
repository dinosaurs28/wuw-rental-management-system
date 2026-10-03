import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, VehicleStatus, PaymentStatus } from "@repo/database/client";
import { managerConfirmPickupSchema } from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";
import { redis } from "../../lib/redisconfig.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { AdvanceDepositService } from "../../services/booking/advance-deposit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { financialStateService, branchPaymentConfigService, refundService } from "../../services/payment/index.js";
import type { PaymentMethod } from "@repo/database/client";
import { runNoShowAutoCancel } from "../../jobs/noShowAutoCancel.worker.js";
import { vehicleStatusAfterDrop } from "../../services/damage/drop-damage.service.js";
import { getBookingQrPhotoFields } from "../../services/qr-photo/customer-qr-photo.service.js";
import { readDepositHandling } from "../../services/payment/safety-deposit.service.js";
import type { Prisma } from "@repo/database/client";
import {
  parseBookingListType,
  bookingTypeWhere,
  bookingListTypeOf,
  INVALID_BOOKING_TYPE,
  type BookingListType,
} from "../../utils/booking/bookingTypeFilter.js";
import { listOverdueReturns, parseOverduePaging } from "../../services/booking/overdue-returns.service.js";
import { notifyEvents } from "../../services/notification/notification.events.js";
import { displayEmail } from "../../utils/customer/identity.js";
import {
  assertDlFree,
  lockAndAssertDlFreeForPickup,
  DlInUseError,
} from "../../services/booking/dl-in-use.service.js";

const advanceDepositService = new AdvanceDepositService();

/** A selected customer with a walk-in placeholder email hidden (#1): `email: null`. */
function withCustomerDisplayEmail<C extends { user: { email: string } }>(customer: C) {
  return { ...customer, user: { ...customer.user, email: displayEmail(customer.user.email) } };
}

/**
 * Where-clauses for a BM list split into Daily / Monthly tabs (#17). Daily keeps
 * the optional per-day (IST) filter; Monthly ignores the date and lists every
 * booking of that status. No type = the old, unsplit list.
 */
const managerTabWheres = (
  branchId: number,
  status: BookingStatus,
  dateFilter: Prisma.BookingWhereInput,
  type: BookingListType | undefined,
) => {
  const dailyWhere: Prisma.BookingWhereInput = { branchId, status, ...dateFilter, ...bookingTypeWhere("DAILY") };
  const monthlyWhere: Prisma.BookingWhereInput = { branchId, status, ...bookingTypeWhere("MONTHLY") };
  const listWhere: Prisma.BookingWhereInput =
    type === "MONTHLY" ? monthlyWhere : type === "DAILY" ? dailyWhere : { branchId, status, ...dateFilter };
  return { dailyWhere, monthlyWhere, listWhere };
};

// Upcoming pickups (CONFIRMED). `?type=DAILY|MONTHLY` splits the list into tabs.
// No cache — a picked-up or cancelled booking must leave the list on the next fetch.
export const GetActiveBookings = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const { date } = req.query;

  const parsedType = parseBookingListType(req.query.type);
  if (!parsedType.ok) {
    return res.status(StatusCode.BAD_REQUEST).json(INVALID_BOOKING_TYPE);
  }
  const type = parsedType.type;

  let dateFilter: any = {};

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
    }
  }

  try {
    const { dailyWhere, monthlyWhere, listWhere } = managerTabWheres(
      branchId,
      BookingStatus.CONFIRMED,
      dateFilter,
      type,
    );

    const [totalCount, dailyCount, monthlyCount] = await Promise.all([
      prisma.booking.count({ where: listWhere }),
      prisma.booking.count({ where: dailyWhere }),
      prisma.booking.count({ where: monthlyWhere }),
    ]);

    const rows = await prisma.booking.findMany({
      where: listWhere,
      select: {
        id: true,
        publicId: true,
        startAt: true,
        endAt: true,
        rentalPeriodType: true,
        days: true,
        totalFinal: true,
        status: true,
        dlStatus: true,
        dlDepositNote: true,
        dlStatusUpdatedAt: true,
        isAdvancePayment: true,
        advanceAmount: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaidDuring: true,
        customer: {
          select: {
            id: true,
            publicId: true,
            alternatePhone: true,
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
    const bookings = rows.map((row) => ({
      ...row,
      customer: withCustomerDisplayEmail(row.customer),
      bookingType: bookingListTypeOf(row.rentalPeriodType),
    }));

    const responseData = {
      bookings,
      pagination: {
        total: totalCount,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalCount / limit),
      },
      type: type ?? null,
      counts: { daily: dailyCount, monthly: monthlyCount },
    };

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

// Vehicles out on the road (PICKED_UP) — feeds the BM Fleet page. `?type=DAILY|MONTHLY`
// splits the list into tabs. No cache — a returned booking must leave the list on
// the next fetch.
export const GetPendingApprovals = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const { date } = req.query;

  const parsedType = parseBookingListType(req.query.type);
  if (!parsedType.ok) {
    return res.status(StatusCode.BAD_REQUEST).json(INVALID_BOOKING_TYPE);
  }
  const type = parsedType.type;

  let dateFilter: any = {};

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
    }
  }

  try {
    const { dailyWhere, monthlyWhere, listWhere } = managerTabWheres(
      branchId,
      BookingStatus.PICKED_UP,
      dateFilter,
      type,
    );

    const [totalCount, dailyCount, monthlyCount] = await Promise.all([
      prisma.booking.count({ where: listWhere }),
      prisma.booking.count({ where: dailyWhere }),
      prisma.booking.count({ where: monthlyWhere }),
    ]);

    const rows = await prisma.booking.findMany({
      where: listWhere,
      select: {
        id: true,
        publicId: true,
        startAt: true,
        endAt: true,
        rentalPeriodType: true,
        days: true,
        totalFinal: true,
        status: true,
        dlStatus: true,
        dlDepositNote: true,
        dlStatusUpdatedAt: true,
        isAdvancePayment: true,
        advanceAmount: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaidDuring: true,
        customer: {
          select: {
            id: true,
            publicId: true,
            alternatePhone: true,
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
    const bookings = rows.map((row) => ({
      ...row,
      customer: withCustomerDisplayEmail(row.customer),
      bookingType: bookingListTypeOf(row.rentalPeriodType),
    }));

    const responseData = {
      bookings,
      pagination: {
        total: totalCount,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalCount / limit),
      },
      type: type ?? null,
      counts: { daily: dailyCount, monthly: monthlyCount },
    };

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

/**
 * GET /api/branchManager/dashboard/bookings/overdue?page&limit&type
 * Overdue / no-show returns for the manager's branch, most overdue first.
 * Same rows as the Fleet endpoint. Always 200 — empty list is `data: []`.
 */
export const GetOverdueReturns = async (req: Request, res: Response) => {
  try {
    const parsedType = parseBookingListType(req.query.type);
    if (!parsedType.ok) {
      return res.status(StatusCode.BAD_REQUEST).json(INVALID_BOOKING_TYPE);
    }

    const { page, limit } = parseOverduePaging(req.query.page, req.query.limit);
    const result = await listOverdueReturns(req.branch_Id, { page, limit, type: parsedType.type });

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Overdue returns fetched successfully",
      ...result,
    });
  } catch (error) {
    console.error("Overdue Returns Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal Server Error fetching overdue returns",
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

    // Collected just before the manager confirms the handover: refuse it up
    // front when that handover would be refused anyway because another
    // booking on the same driving licence is out (X3) — nothing recorded.
    if (booking.status === BookingStatus.CONFIRMED) {
      await assertDlFree({ customerId: booking.customerId, mode: "pickup", excludeBookingId: booking.id });
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
    if (error instanceof DlInUseError) {
      return res.status(error.status).json(error.toJSON("staff"));
    }
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
  const { reason = "No Show", refundCustomer = false, refundMethod, refundAmount } = req.body;
  const userId = req.public_Id as string;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: branchId },
    });
    if (!booking)
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    const result = await advanceDepositService.handleNoShowCancellation(
      booking.id,
      userId,
      reason,
    );

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CANCELLED,
      entityType: StaffEntityType.BOOKING,
      entityRef: booking.publicId,
      description: `Booking ${booking.publicId} cancelled due to no-show`,
      metadata: { reason, refundCustomer },
    });

    let refundData: { publicId: string; status: string; amount: unknown } | null = null;

    if (refundCustomer && refundMethod && refundAmount) {
      const actor = await prisma.user.findUnique({
        where: { publicId: userId },
        select: { id: true, name: true, role: true, branch: { select: { name: true } } },
      });
      if (actor) {
        const refund = await refundService.request(
          booking.publicId,
          Number(refundAmount),
          `No-show cancellation refund: ${reason}`,
          refundMethod as PaymentMethod,
          {
            actorId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
            actorBranchId: branchId,
            actorPublicId: userId,
            branchName: actor.branch?.name ?? "Unknown",
          },
        );
        refundData = { publicId: refund.publicId, status: refund.status, amount: refund.amount };

        staffActivityService.logFromRequest(req, {
          actionType: StaffActionType.REFUNDED,
          entityType: StaffEntityType.REFUND_REQUEST,
          entityRef: booking.publicId,
          description: `Refund request of ₹${refundAmount} created for cancelled no-show booking ${booking.publicId}`,
          metadata: { refundMethod, refundAmount },
        });
      }
    }

    return res.status(StatusCode.OK).json({
      success: true,
      message: refundData
        ? "Booking cancelled and refund request created"
        : "Booking cancelled as no-show",
      data: { ...result, refund: refundData },
    });
  } catch (error: any) {
    console.error("Cancel No Show Error:", error);
    if (error.message?.includes("not found"))
      return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message?.includes("cannot be cancelled"))
      return res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
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

    // A drop that recorded how the deposit goes back (#6) is refunded where that
    // choice is honoured — Settlements (legacy drop) or the drop bill — which
    // record a real refund. Flagging it here too would count it twice.
    const handling = readDepositHandling(booking.pricingSnapshot);
    if (handling) {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "DEPOSIT_REFUND_VIA_SETTLEMENT",
        message:
          handling.flow === "DROP_BILL"
            ? "This safety deposit is settled on the drop bill — it can't be refunded here."
            : `Staff recorded the safety deposit at the drop (${handling.mode === "REFUND_IN_FULL" ? "refund in full" : "set off against charges"}). Approve the return, then refund it from Payments → Settlements.`,
        safetyDepositHandling: handling.mode,
      });
    }

    // refundedBy is the user's numeric id (the audit looks the user up by it)
    const actingUser = await prisma.user.findUnique({ where: { publicId: userId }, select: { id: true } });
    if (!actingUser)
      return res.status(StatusCode.NOT_FOUND).json({ message: "User not found" });

    const result = await advanceDepositService.refundSafetyDeposit(
      booking.id,
      Number(amount),
      method,
      actingUser.id,
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

    // One vehicle per driving licence (X3): not while another booking on this
    // DL is out. Re-checked under a lock below.
    await assertDlFree({ customerId: booking.customerId, mode: "pickup", excludeBookingId: booking.id });

    const actingUser = await prisma.user.findUnique({
      where: { publicId: userId },
    });

    if (!actingUser) {
      return res
        .status(StatusCode.UNAUTHORIZED)
        .json({ message: "User not found" });
    }

    await prisma.$transaction(async (tx) => {
      await lockAndAssertDlFreeForPickup(booking.id, tx);

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

    void notifyEvents.pickupCompleted({ bookingId: booking.id, actorUserId: actingUser.id });
    void notifyEvents.approvalResolved({
      kind: "PICKUP",
      entity: "Booking",
      entityPublicId: booking.publicId,
      branchId,
      approved: true,
      bookingId: booking.id,
      actorUserId: actingUser.id,
    });

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Pickup confirmed successfully. Vehicle is now OUT_FOR_RENTAL.",
    });
  } catch (error: any) {
    if (error instanceof DlInUseError) {
      return res.status(error.status).json(error.toJSON("staff"));
    }
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
    const returnedStatuses = new Set<VehicleStatus>();

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
          // The drop recorded the actual return time; returns sent before that field existed get now
          returnedAt: booking.returnedAt ?? new Date(),
        },
      });

      // Damage recorded at drop holds that vehicle for the manager's disposition
      // (MANAGER_REPORTED); every other vehicle is back in the fleet.
      for (const vehicleId of vehicleIds) {
        const status = (await vehicleStatusAfterDrop(booking.id, vehicleId, tx as any)) ?? VehicleStatus.AVAILABLE;
        returnedStatuses.add(status);
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { status },
        });
      }

      await staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.CONFIRMED,
        entityType: StaffEntityType.BOOKING,
        entityRef: booking.publicId,
        description: `Manager confirmed vehicle return for booking ${booking.publicId}`,
      }, tx);
    });

    // Targeted availability cache invalidation (TASK-019)
    try {
      await invalidateVehicleAvailability(redis, vehicleIds);
    } catch (redisErr) {
      console.warn("[manager] Cache invalidation failed (non-fatal):", redisErr);
    }

    void notifyEvents.returnCompleted({ bookingId: booking.id, actorUserId: actingUser.id });
    void notifyEvents.approvalResolved({
      kind: "RETURN",
      entity: "Booking",
      entityPublicId: booking.publicId,
      branchId,
      approved: true,
      bookingId: booking.id,
      actorUserId: actingUser.id,
    });

    return res.status(StatusCode.OK).json({
      success: true,
      message: returnedStatuses.has(VehicleStatus.MANAGER_REPORTED)
        ? "Return confirmed successfully. Vehicle is held for the damage review."
        : `Return confirmed successfully. Vehicle is now ${[...returnedStatuses].join(", ") || VehicleStatus.AVAILABLE}.`,
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
        dlStatus: true,
        dlDepositNote: true,
        dlStatusUpdatedAt: true,
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
      data: bookings.map((b) => ({ ...b, customer: withCustomerDisplayEmail(b.customer) })),
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
        safetyDepositRefunded: true,
        // Read for the drop's deposit choice only (not sent)
        pricingSnapshot: true,
        dlStatus: true,
        dlDepositNote: true,
        dlStatusUpdatedAt: true,
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
            type: true,
            captureLabel: true,
            file: {
              select: {
                url: true,
                mime: true,
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

    // Customer QR code photo (#4): booking snapshot, else the customer's current one.
    const qrPhotoFields = await getBookingQrPhotoFields({ publicId: bookingId as string, branchId });

    // A pickup confirmation (booking still CONFIRMED) shows the handover photos
    // only; a return confirmation keeps every photo (pickup, return, damage),
    // each carrying its type / captureLabel so the dialog can label it.
    const { pricingSnapshot, ...bookingFields } = booking;
    const photos =
      booking.status === BookingStatus.CONFIRMED
        ? booking.photos.filter((photo) => photo.type === "PRE_DELIVERY")
        : booking.photos;

    // How staff chose to return the safety deposit at the drop (#6): SET_OFF /
    // REFUND_IN_FULL, refunded through Settlements (LEGACY) or on the drop bill
    const depositHandling = readDepositHandling(pricingSnapshot);

    return res.status(StatusCode.OK).json({
      success: true,
      data: {
        ...bookingFields,
        photos,
        ...qrPhotoFields,
        safetyDepositHandling: depositHandling?.mode ?? null,
        safetyDepositHandlingFlow: depositHandling?.flow ?? null,
      },
    });
  } catch (error: any) {
    console.error("Manager Confirmation details error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const GetNoShowEligibleBookings = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  // Configurable grace period in hours — bookings are only flaggable for
  // no-show after this many hours have elapsed past their scheduled startAt.
  const graceHours = parseInt(req.query.graceHours as string) || 0;
  const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000);

  try {
    const where = {
      branchId,
      status: BookingStatus.CONFIRMED,
      paymentStatus: PaymentStatus.SUCCESS,
      startAt: { lt: cutoff },
    };

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        select: {
          publicId: true,
          startAt: true,
          endAt: true,
          totalFinal: true,
          isAdvancePayment: true,
          advanceAmount: true,
          remainingBalance: true,
          depositMethod: true,
          createdAt: true,
          customer: {
            select: {
              publicId: true,
              user: {
                select: { name: true, phone: true, email: true },
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
                    where: { isThumbnail: true },
                    take: 1,
                    select: { file: { select: { url: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: { startAt: "asc" }, // most overdue first
        take: limit,
        skip,
      }),
    ]);

    return res.status(StatusCode.OK).json({
      success: true,
      data: bookings.map((b) => ({ ...b, customer: withCustomerDisplayEmail(b.customer) })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      graceHours,
    });
  } catch (error) {
    console.error("[GetNoShowEligibleBookings] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

// ── Cancellation Dashboard ────────────────────────────────────────────────────

export const GetCancellationStats = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;

  try {
    const now = TimezoneService.getCurrentTime();
    const startOfToday = TimezoneService.toPrisma(TimezoneService.startOfDay(now));
    const startOf7Days = TimezoneService.toPrisma(now.minus({ days: 7 }));
    const startOf30Days = TimezoneService.toPrisma(now.minus({ days: 30 }));

    const [todayCancelledCount, last7DaysCancelledCount, last30DaysCancelledCount, totalCancelledCount, autoCancelledCount] = await Promise.all([
      prisma.booking.count({ where: { branchId, status: BookingStatus.CANCELLED, cancelledAt: { gte: startOfToday } } }),
      prisma.booking.count({ where: { branchId, status: BookingStatus.CANCELLED, cancelledAt: { gte: startOf7Days } } }),
      prisma.booking.count({ where: { branchId, status: BookingStatus.CANCELLED, cancelledAt: { gte: startOf30Days } } }),
      prisma.booking.count({ where: { branchId, status: BookingStatus.CANCELLED } }),
      prisma.booking.count({
        where: {
          branchId,
          status: BookingStatus.CANCELLED,
          cancellationReason: { contains: "Auto-cancelled", mode: "insensitive" },
        },
      }),
    ]);

    return res.status(StatusCode.OK).json({
      success: true,
      data: {
        todayCancelledCount,
        last7DaysCancelledCount,
        last30DaysCancelledCount,
        totalCancelledCount,
        autoCancelledCount,
        manualCancelledCount: totalCancelledCount - autoCancelledCount,
      },
    });
  } catch (error) {
    console.error("[GetCancellationStats] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const GetCancellationHistory = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;
  const { startDate, endDate } = req.query;

  try {
    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = TimezoneService.toPrisma(
        TimezoneService.startOfDay(TimezoneService.parseISO(startDate as string))
      );
    }
    if (endDate) {
      dateFilter.lte = TimezoneService.toPrisma(
        TimezoneService.endOfDay(TimezoneService.parseISO(endDate as string))
      );
    }

    const where: any = { branchId, status: BookingStatus.CANCELLED };
    if (Object.keys(dateFilter).length > 0) {
      where.cancelledAt = dateFilter;
    }

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        select: {
          publicId: true,
          startAt: true,
          endAt: true,
          cancelledAt: true,
          cancellationReason: true,
          totalFinal: true,
          advanceAmount: true,
          customer: {
            select: {
              user: { select: { name: true, phone: true, email: true } },
            },
          },
          items: {
            select: {
              vehicle: { select: { make: true, model: true, regNo: true } },
            },
            take: 1,
          },
          cancellationInvoice: {
            select: { advanceAmount: true, cancellationFee: true },
          },
        },
        orderBy: { cancelledAt: "desc" },
        take: limit,
        skip,
      }),
    ]);

    return res.status(StatusCode.OK).json({
      success: true,
      data: bookings.map((b) => ({ ...b, customer: withCustomerDisplayEmail(b.customer) })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[GetCancellationHistory] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const TriggerNoShowAutoCancelManual = async (req: Request, res: Response) => {
  try {
    const result = await runNoShowAutoCancel();
    return res.status(StatusCode.OK).json({
      success: true,
      message: `Auto-cancellation run complete. ${result.cancelledCount} booking(s) cancelled.`,
      data: result,
    });
  } catch (error) {
    console.error("[TriggerNoShowAutoCancelManual] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Failed to run auto-cancellation" });
  }
};
