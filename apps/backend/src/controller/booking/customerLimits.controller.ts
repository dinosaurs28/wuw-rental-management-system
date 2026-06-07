import { Request, Response } from "express";
import { prisma, BookingStatus, VehicleTypeClass } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.HOLD,
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
];

/**
 * GET /public/customer/booking-limits?start=ISO&end=ISO
 *
 * Returns the customer's currently active bookings grouped by vehicle typeClass,
 * filtered to those that overlap [start, end). Omitting start/end returns all
 * currently active bookings (status IN HOLD | CONFIRMED | PICKED_UP).
 *
 * Used by the frontend to proactively disable restricted vehicle type cards
 * on the listing page before the customer enters the booking flow.
 */
export const getCustomerBookingLimits = async (req: Request, res: Response) => {
  try {
    const userData = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { customerProfile: { select: { id: true } } },
    });

    if (!userData?.customerProfile) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Customer profile not found" });
    }

    const customerId = userData.customerProfile.id;
    const now = new Date();

    // Parse optional date range filter
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

    const items = await prisma.bookingItem.findMany({
      where: {
        booking: {
          customerId,
          status: { in: ACTIVE_STATUSES },
          ...(startDate && endDate
            ? { startAt: { lt: endDate }, endAt: { gt: startDate } }
            : {}),
          // Exclude expired HOLDs not yet cleaned up
          OR: [
            { status: { not: BookingStatus.HOLD } },
            { holdExpiresAt: { gt: now } },
          ],
        },
        vehicle: {
          category: {
            typeClass: { in: [VehicleTypeClass.TWO_WHEELER, VehicleTypeClass.FOUR_WHEELER] },
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

    // Build usedTypeClasses map — one entry per typeClass (first conflict wins)
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

    return res.status(StatusCode.OK).json({ usedTypeClasses });
  } catch (error) {
    console.error("[getCustomerBookingLimits] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
