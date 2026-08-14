import { Request, Response } from "express";
import { differenceInCalendarDays } from "date-fns";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus } from "@repo/database/client";
import {
  resolveReportRange,
  parseCategoryIds,
  buildBookingWhere,
  getCollections,
  getPaidByBooking,
  REVENUE_BOOKING_STATUSES,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvDate,
} from "../../utils/reporting/index.js";

/**
 * Daily Summary Report — multi-day operational + cash-flow rollup (spec §4.2).
 *
 * Rebuilt from a single-day snapshot into a DATE RANGE report: one row per
 * calendar day in the selected range, including days with zero activity.
 *
 * Per-day columns (spec §4.2 exact order):
 *   Date, New Bookings, Active Trips, Completed, Revenue,
 *   Cash Collected, UPI Collected, Outstanding, Cancellations.
 *
 * Efficient fetch strategy (no N-queries-per-day):
 *   1. Revenue-status bookings with startAt in range  -> New Bookings, Revenue, Outstanding
 *   2. PICKED_UP bookings overlapping the range        -> Active Trips
 *   3. RETURNED bookings whose ReturnReceipt.createdAt -> Completed
 *   4. CANCELLED bookings with cancelledAt in range    -> Cancellations
 *   5. getCollections (payment-date anchored)          -> Cash / UPI Collected
 *   + getPaidByBooking over set (1) ids                -> Outstanding
 *
 * All per-day bucketing uses differenceInCalendarDays against the range start
 * (the SAME local calendar resolveReportRange uses to build start/end), so every
 * in-range anchor lands in exactly one bucket.
 *
 * INVARIANT: Σ(per-day Revenue) over the range == aggregate of
 * buildBookingWhere(REVENUE_BOOKING_STATUSES, startAt range) — same status set,
 * same startAt anchor — matching the Sales Report and dashboard for identical
 * branch/date/category filters.
 */

interface DayRow {
  date: string; // DD-MM-YYYY
  newBookings: number;
  activeTrips: number;
  completed: number;
  revenue: number;
  cashCollected: number;
  upiCollected: number;
  outstanding: number;
  cancellations: number;
}

export const GetDailySummary = async (req: Request, res: Response) => {
  try {
    const { branchId, branch, categories, categoryId, export: exportFormat } =
      req.query;

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;
    const categoryPublicIds = parseCategoryIds(categories ?? categoryId);

    const { start, end, days } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate ?? req.query.date,
      endDate: req.query.endDate ?? req.query.date,
      from: req.query.from,
      to: req.query.to,
    });

    let branchName = "All Branches";
    if (branchPublicId) {
      const b = await prisma.branch.findUnique({
        where: { publicId: branchPublicId },
        select: { name: true },
      });
      branchName = b?.name ?? branchPublicId;
    }

    // Index of a date into the per-day buckets (0 .. days-1), or -1 if outside.
    const dayIndex = (d: Date | null | undefined): number => {
      if (!d) return -1;
      const idx = differenceInCalendarDays(d, start);
      return idx >= 0 && idx < days ? idx : -1;
    };

    const baseFilter = { branchPublicId, categoryPublicIds, from: start, to: end };

    // (1) Revenue-status bookings starting in range — New Bookings + Revenue + Outstanding.
    //     Same where the dashboard/Sales use, so per-day revenue reconciles to the aggregate.
    const revenueWhere = buildBookingWhere({
      ...baseFilter,
      statuses: REVENUE_BOOKING_STATUSES,
    });

    // (2) Active trips: PICKED_UP bookings whose interval overlaps the range.
    //     startAt <= range end AND endAt >= range start. Category + branch + soft-delete applied.
    const activeWhere = {
      ...buildBookingWhere({
        ...baseFilter,
        statuses: [BookingStatus.PICKED_UP],
        // overlap is expressed below; we still want branch/category/soft-delete
        dateField: "startAt" as const,
      }),
      // override the startAt-in-range constraint with an overlap constraint
      startAt: { lte: end },
      endAt: { gte: start },
    };

    // (3) Completed: RETURNED bookings whose ReturnReceipt.createdAt is in range.
    const completedWhere = {
      ...buildBookingWhere({
        ...baseFilter,
        statuses: [BookingStatus.RETURNED],
        dateField: "startAt" as const,
      }),
      startAt: undefined as never, // drop the startAt-in-range constraint
      returnReceipt: { createdAt: { gte: start, lte: end } },
    };

    // (4) Cancellations: CANCELLED bookings with cancelledAt in range.
    const cancelledWhere = buildBookingWhere({
      ...baseFilter,
      statuses: [BookingStatus.CANCELLED],
      dateField: "cancelledAt",
    });

    const [revenueBookings, activeBookings, completedBookings, cancelledBookings, collections] =
      await Promise.all([
        prisma.booking.findMany({
          where: revenueWhere,
          select: { id: true, startAt: true, totalFinal: true },
        }),
        prisma.booking.findMany({
          where: activeWhere,
          select: { id: true, startAt: true, endAt: true },
        }),
        prisma.booking.findMany({
          where: completedWhere,
          select: { id: true, returnReceipt: { select: { createdAt: true } } },
        }),
        prisma.booking.findMany({
          where: cancelledWhere,
          select: { id: true, cancelledAt: true },
        }),
        getCollections({ branchPublicId, from: start, to: end }),
      ]);

    // Canonical paid amounts for the revenue-status set (for Outstanding).
    const paidMap = await getPaidByBooking(revenueBookings.map((b) => b.id));

    // ── Bucket per calendar day ──────────────────────────────────────────────
    const rows: DayRow[] = Array.from({ length: days }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return {
        date: csvDate(d),
        newBookings: 0,
        activeTrips: 0,
        completed: 0,
        revenue: 0,
        cashCollected: 0,
        upiCollected: 0,
        outstanding: 0,
        cancellations: 0,
      };
    });

    // (1) New Bookings + Revenue + Outstanding — anchored on startAt.
    for (const b of revenueBookings) {
      const i = dayIndex(b.startAt);
      if (i < 0) continue;
      const total = Number(b.totalFinal);
      const paid = paidMap.get(b.id)?.total ?? 0;
      rows[i]!.newBookings += 1;
      rows[i]!.revenue += total;
      rows[i]!.outstanding += Math.max(0, total - paid);
    }

    // (2) Active Trips — a PICKED_UP booking is active on every day its interval covers.
    for (const b of activeBookings) {
      const firstIdx = Math.max(0, differenceInCalendarDays(b.startAt, start));
      const lastIdx = Math.min(days - 1, differenceInCalendarDays(b.endAt, start));
      for (let i = firstIdx; i <= lastIdx; i++) rows[i]!.activeTrips += 1;
    }

    // (3) Completed — anchored on the return receipt date.
    for (const b of completedBookings) {
      const i = dayIndex(b.returnReceipt?.createdAt ?? null);
      if (i < 0) continue;
      rows[i]!.completed += 1;
    }

    // (4) Cancellations — anchored on cancelledAt.
    for (const b of cancelledBookings) {
      const i = dayIndex(b.cancelledAt);
      if (i < 0) continue;
      rows[i]!.cancellations += 1;
    }

    // (5) Cash / UPI Collected — payment-date anchored (collectedAt, fallback createdAt).
    for (const c of collections) {
      const i = dayIndex(c.collectedAt);
      if (i < 0) continue;
      rows[i]!.cashCollected += c.cash;
      rows[i]!.upiCollected += c.upi;
    }

    // ── Totals ────────────────────────────────────────────────────────────────
    const totals = rows.reduce(
      (acc, r) => {
        acc.newBookings += r.newBookings;
        acc.completed += r.completed;
        acc.revenue += r.revenue;
        acc.cashCollected += r.cashCollected;
        acc.upiCollected += r.upiCollected;
        acc.outstanding += r.outstanding;
        acc.cancellations += r.cancellations;
        return acc;
      },
      {
        newBookings: 0,
        completed: 0,
        revenue: 0,
        cashCollected: 0,
        upiCollected: 0,
        outstanding: 0,
        cancellations: 0,
      },
    );
    // Active Trips is a per-day snapshot, not a flow — its column total is the
    // sum of daily snapshots (matches the per-day rows being summed in CSV).
    const totalActiveTrips = rows.reduce((s, r) => s + r.activeTrips, 0);

    const reportData = {
      metadata: {
        period: { start: start.toISOString(), end: end.toISOString() },
        days,
        branch: branchName,
        generatedAt: new Date().toISOString(),
      },
      days: rows,
      totals: { ...totals, activeTrips: totalActiveTrips },
    };

    // ── CSV: one row per day, in spec column order, + TOTAL row ────────────────
    if (exportFormat === "csv") {
      const columns = [
        "Date",
        "New Bookings",
        "Active Trips",
        "Completed",
        "Revenue",
        "Cash Collected",
        "UPI Collected",
        "Outstanding",
        "Cancellations",
      ];
      const csvRows = rows.map((r) => ({
        Date: r.date,
        "New Bookings": r.newBookings,
        "Active Trips": r.activeTrips,
        Completed: r.completed,
        Revenue: csvCurrency(r.revenue),
        "Cash Collected": csvCurrency(r.cashCollected),
        "UPI Collected": csvCurrency(r.upiCollected),
        Outstanding: csvCurrency(r.outstanding),
        Cancellations: r.cancellations,
      }));
      const total = summaryRow(columns, "TOTAL", {
        "New Bookings": totals.newBookings,
        "Active Trips": totalActiveTrips,
        Completed: totals.completed,
        Revenue: csvCurrency(totals.revenue),
        "Cash Collected": csvCurrency(totals.cashCollected),
        "UPI Collected": csvCurrency(totals.upiCollected),
        Outstanding: csvCurrency(totals.outstanding),
        Cancellations: totals.cancellations,
      });
      return exportRowsToCSV(res, {
        columns,
        rows: csvRows,
        summaryRows: [total],
        filename: `daily-summary-${csvDate(start)}-${csvDate(end)}`,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Daily summary generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Daily Summary Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate daily summary",
    });
  }
};
