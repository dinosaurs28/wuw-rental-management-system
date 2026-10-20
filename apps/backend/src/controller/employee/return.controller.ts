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
import { draftSummaryLookup } from "../../services/booking/operation-draft.service.js";
import { listCompletedQueue } from "../../services/booking/operation-completion.service.js";
import { parseFleetQuery } from "../../utils/booking/fleetSearch.js";
import { parseIncludeCompleted, pendingOnlyWhere } from "../../utils/booking/completedQueue.js";
import {
  buildQueueFilterWhere,
  completedDayFor,
  hasTimeFilter,
  INVALID_QUEUE_FILTER,
  parseQueueFilters,
  paymentWhere,
  queueFilterOptions,
  queueVehicleIds,
} from "../../utils/booking/queueFilters.js";

// Return queue. The day is the IST business day (a return due 00:00–05:29 IST
// belongs to that day, not the previous UTC one). `?type=DAILY|MONTHLY` splits
// it into tabs (#17): Daily keeps the per-day scope, Monthly lists every
// PICKED_UP monthly booking whatever the date. No cache — a returned booking
// must leave the queue on the next fetch.
// `?includeCompleted=1` (client item 1, new clients only) adds the day's done
// returns in `completed`; the waiting list and counts then leave out drops sent
// to a manager (they are listed as completed, "Awaiting manager").
// `?q=` (new clients only) keeps the bookings whose vehicle matches the search
// (registration number, spaces / hyphens ignored, or make / model words) in the
// list, the counts and `completed`.
// Search-bar filters (Oct 20 2026, new clients only; utils/booking/queueFilters.ts):
// `typeClass`, `category`, `groupKey`, `tripType`, `when=today|tomorrow|overdue`,
// `from` / `to`, `payment=balance_due|paid` narrow the list, the counts and
// `completed` too. A time filter replaces the day (`date`) scope — `overdue`
// lists every rental still out past its return time.
export const returnController = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { date } = req.query;

    const parsedType = parseBookingListType(req.query.type);
    if (!parsedType.ok) {
      return res.status(StatusCode.BAD_REQUEST).json(INVALID_BOOKING_TYPE);
    }
    const type = parsedType.type;
    const includeCompleted = parseIncludeCompleted(req.query.includeCompleted);
    const pendingOnly = pendingOnlyWhere(includeCompleted);
    const parsedFilters = parseQueueFilters(req.query as Record<string, unknown>);
    if (!parsedFilters.ok) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ success: false, code: INVALID_QUEUE_FILTER, message: parsedFilters.message });
    }
    const filters = parsedFilters.filters;
    const timeFiltered = hasTimeFilter(filters);
    const search = parseFleetQuery(req.query.q);
    const searchVehicleIds = await queueVehicleIds(branchId, search, filters);
    const nowDt = TimezoneService.getCurrentTime();
    const filterWhere = buildQueueFilterWhere("RETURN", filters, { now: nowDt, vehicleIds: searchVehicleIds });
    // No search / filters: the exact old query
    const withFilters = <W extends object>(where: W) =>
      Object.keys(filterWhere).length ? { AND: [where, filterWhere] } : where;

    let dayDt = nowDt;
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
      // A time filter replaces the day scope
      ...(!timeFiltered && {
        endAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      }),
      status: {
        in: [BookingStatus.PICKED_UP],
      },
      ...pendingOnly,
    };
    const dailyWhere = withFilters({ ...dayWhere, ...bookingTypeWhere("DAILY") });
    const monthlyWhere = withFilters({
      branchId: branchId,
      status: BookingStatus.PICKED_UP,
      ...bookingTypeWhere("MONTHLY"),
      ...pendingOnly,
    });
    const listWhere = type === "MONTHLY" ? monthlyWhere : type === "DAILY" ? dailyWhere : withFilters(dayWhere);

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
    // A drop paused half-way (client item 2) shows as "Paused" on its card.
    const draftOf = await draftSummaryLookup(rows.map((row) => row.publicId), "RETURN");
    const bookings = rows.map((row) => ({
      ...row,
      // Walk-in placeholder emails never leave the server (#1): null instead.
      customer: {
        ...row.customer,
        user: { ...row.customer.user, email: displayEmail(row.customer.user.email) },
      },
      bookingType: bookingListTypeOf(row.rentalPeriodType),
      draft: draftOf(row.publicId),
    }));
    const counts = { daily: dailyCount, monthly: monthlyCount };
    // Done (or sent to a manager) for the day — additive, new clients only
    // A time filter sets the days covered ("overdue" alone: none — nothing done is overdue)
    const completedRange = completedDayFor(filters, nowDt, { gte: startOfDay, lte: endOfDay });
    const completed = includeCompleted
      ? completedRange
        ? await listCompletedQueue("RETURN", {
            branchId,
            type,
            day: completedRange,
            vehicleIds: searchVehicleIds,
            extraWhere: paymentWhere(filters),
          })
        : []
      : null;

    // Old app builds (no ?type) treat 404 as an empty queue; tabbed clients get 200 + [].
    if (bookings.length === 0 && !type && !includeCompleted) {
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
      ...(completed && { completed }),
    });
  } catch (error) {
    console.error("Error fetching return bookings:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error While Fetching Returns",
    });
  }
};

// Search-bar filter options of the Fleet queues (Oct 20 2026): the type
// classes, categories, models (make + model) and trip types of the branch's
// fleet with vehicle counts, plus the time and payment choices labelled for the
// queue (`?phase=PICKUP|RETURN`, default PICKUP).
export const queueFilterOptionsController = async (req: Request, res: Response) => {
  try {
    const rawPhase = typeof req.query.phase === "string" ? req.query.phase.trim().toUpperCase() : "";
    if (rawPhase && rawPhase !== "PICKUP" && rawPhase !== "RETURN") {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: INVALID_QUEUE_FILTER,
        message: "phase must be PICKUP or RETURN.",
      });
    }
    const data = await queueFilterOptions(req.branch_Id, rawPhase === "RETURN" ? "RETURN" : "PICKUP");
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching queue filter options:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error While Fetching Filter Options",
    });
  }
};
