import { Request, Response } from "express";
import { prisma, BookingStatus, VehicleTypeClass, BookingRestrictionMode } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.HOLD,
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
];

/**
 * GET /employee/customer/:customerPublicId/booking-limits?start=ISO&end=ISO
 *
 * Employee-side variant. Uses the employee's own branch (from JWT) to resolve
 * the restriction mode and scope ANY_VEHICLE checks.
 */
export const getEmployeeCustomerBookingLimits = async (
  req: Request,
  res: Response,
) => {
  try {
    const { customerPublicId } = req.params;

    const userData = await prisma.user.findUnique({
      where: { publicId: customerPublicId },
      select: { customerProfile: { select: { id: true } } },
    });

    if (!userData?.customerProfile) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Customer not found" });
    }

    const customerId = userData.customerProfile.id;
    const now = new Date();

    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (req.query.start && req.query.end) {
      const startDt = TimezoneService.parseISO(req.query.start as string);
      const endDt = TimezoneService.parseISO(req.query.end as string);
      if (startDt.isValid && endDt.isValid) {
        startDate = TimezoneService.toPrisma(startDt);
        endDate = TimezoneService.toPrisma(endDt);
      }
    }

    // Resolve branch restriction mode from the employee's branch
    const branchId: number | undefined = (req as any).branch_Id ?? undefined;
    let restrictionMode: BookingRestrictionMode = BookingRestrictionMode.SAME_CATEGORY;

    if (branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { bookingRestrictionMode: true },
      });
      if (branch) restrictionMode = branch.bookingRestrictionMode;
    }

    // NONE
    if (restrictionMode === BookingRestrictionMode.NONE) {
      return res.status(StatusCode.OK).json({
        restrictionMode,
        usedTypeClasses: {},
        blockedAll: false,
      });
    }

    // ANY_VEHICLE
    if (restrictionMode === BookingRestrictionMode.ANY_VEHICLE && branchId && startDate && endDate) {
      const conflictItem = await prisma.bookingItem.findFirst({
        where: {
          booking: {
            customerId,
            branchId,
            status: { in: ACTIVE_STATUSES },
            startAt: { lt: endDate },
            endAt: { gt: startDate },
            OR: [
              { status: { not: BookingStatus.HOLD } },
              { holdExpiresAt: { gt: now } },
            ],
          },
        },
        select: {
          vehicle: { select: { make: true, model: true } },
          booking: {
            select: {
              publicId: true,
              startAt: true,
              endAt: true,
              status: true,
              holdExpiresAt: true,
            },
          },
        },
      });

      return res.status(StatusCode.OK).json({
        restrictionMode,
        usedTypeClasses: {},
        blockedAll: !!conflictItem,
        anyVehicleConflict: conflictItem
          ? {
              bookingPublicId: conflictItem.booking.publicId,
              vehicleMake: conflictItem.vehicle.make,
              vehicleModel: conflictItem.vehicle.model,
              startAt: conflictItem.booking.startAt,
              endAt: conflictItem.booking.endAt,
              status: conflictItem.booking.status,
              holdExpiresAt: conflictItem.booking.holdExpiresAt,
            }
          : null,
      });
    }

    // SAME_CATEGORY
    const items = await prisma.bookingItem.findMany({
      where: {
        booking: {
          customerId,
          status: { in: ACTIVE_STATUSES },
          ...(startDate && endDate
            ? { startAt: { lt: endDate }, endAt: { gt: startDate } }
            : {}),
          OR: [
            { status: { not: BookingStatus.HOLD } },
            { holdExpiresAt: { gt: now } },
          ],
        },
        vehicle: {
          category: {
            typeClass: {
              in: [VehicleTypeClass.TWO_WHEELER, VehicleTypeClass.FOUR_WHEELER],
            },
          },
        },
      },
      select: {
        vehicle: {
          select: {
            make: true,
            model: true,
            category: { select: { typeClass: true } },
          },
        },
        booking: {
          select: {
            publicId: true,
            startAt: true,
            endAt: true,
            status: true,
            holdExpiresAt: true,
          },
        },
      },
    });

    type SlotInfo = {
      bookingPublicId: string;
      vehicleMake: string;
      vehicleModel: string;
      startAt: Date;
      endAt: Date;
      status: BookingStatus;
      holdExpiresAt: Date | null;
    };

    const usedTypeClasses: Partial<Record<VehicleTypeClass, SlotInfo>> = {};

    for (const item of items) {
      const tc = item.vehicle.category.typeClass;
      if (!usedTypeClasses[tc]) {
        usedTypeClasses[tc] = {
          bookingPublicId: item.booking.publicId,
          vehicleMake: item.vehicle.make,
          vehicleModel: item.vehicle.model,
          startAt: item.booking.startAt,
          endAt: item.booking.endAt,
          status: item.booking.status,
          holdExpiresAt: item.booking.holdExpiresAt,
        };
      }
    }

    return res.status(StatusCode.OK).json({
      restrictionMode,
      usedTypeClasses,
      blockedAll: false,
    });
  } catch (error) {
    console.error("[getEmployeeCustomerBookingLimits] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
