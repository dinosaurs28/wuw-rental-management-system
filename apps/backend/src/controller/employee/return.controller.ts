import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { BookingStatus, prisma } from "@repo/database/client";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import {
  parseBookingListType,
  bookingTypeWhere,
  bookingListTypeOf,
  INVALID_BOOKING_TYPE,
} from "../../utils/booking/bookingTypeFilter.js";
import { displayEmail } from "../../utils/customer/identity.js";

// Return queue. The day is the IST business day (a return due 00:00–05:29 IST
// belongs to that day, not the previous UTC one). `?type=DAILY|MONTHLY` splits
// it into tabs (#17): Daily keeps the per-day scope, Monthly lists every
// PICKED_UP monthly booking whatever the date. No cache — a returned booking
// must leave the queue on the next fetch.
export const returnController = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { date } = req.query;

    const parsedType = parseBookingListType(req.query.type);
    if (!parsedType.ok) {
      return res.status(StatusCode.BAD_REQUEST).json(INVALID_BOOKING_TYPE);
    }
    const type = parsedType.type;

    let dayDt = TimezoneService.getCurrentTime();
    if (date) {
      const parsedDateDt = TimezoneService.parseISO(String(date));
      if (parsedDateDt.isValid) {
        dayDt = parsedDateDt;
      }
    }
    const startOfDay = TimezoneService.toPrisma(TimezoneService.startOfDay(dayDt));
    const endOfDay = TimezoneService.toPrisma(TimezoneService.endOfDay(dayDt));

    const dayWhere = {
      branchId: branchId,
      endAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: {
        in: [BookingStatus.PICKED_UP],
      },
    };
    const dailyWhere = { ...dayWhere, ...bookingTypeWhere("DAILY") };
    const monthlyWhere = {
      branchId: branchId,
      status: BookingStatus.PICKED_UP,
      ...bookingTypeWhere("MONTHLY"),
    };
    const listWhere = type === "MONTHLY" ? monthlyWhere : type === "DAILY" ? dailyWhere : dayWhere;

    const [dailyCount, monthlyCount] = await Promise.all([
      prisma.booking.count({ where: dailyWhere }),
      prisma.booking.count({ where: monthlyWhere }),
    ]);

    const rows = await prisma.booking.findMany({
      where: listWhere,
      select: {
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        rentalPeriodType: true,
        dlStatus: true,
        dlDepositNote: true,
        days: true,
        totalFinal: true,
        customer: {
          select: {
            user: {
              select: {
                publicId: true,
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
                publicId: true,
                make: true,
                model: true,
                regNo: true,
                status: true,
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
        endAt: "asc",
      },
    });
    const bookings = rows.map((row) => ({
      ...row,
      // Walk-in placeholder emails never leave the server (#1): null instead.
      customer: {
        ...row.customer,
        user: { ...row.customer.user, email: displayEmail(row.customer.user.email) },
      },
      bookingType: bookingListTypeOf(row.rentalPeriodType),
    }));
    const counts = { daily: dailyCount, monthly: monthlyCount };

    // Old app builds (no ?type) treat 404 as an empty queue; tabbed clients get 200 + [].
    if (bookings.length === 0 && !type) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "No Returns Scheduled for this Date",
        counts,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Return bookings fetched successfully",
      data: bookings,
      type: type ?? null,
      counts,
    });
  } catch (error) {
    console.error("Error fetching return bookings:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error While Fetching Returns",
    });
  }
};
