import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus } from "@repo/database/client";
import {
  resolveReportRange,
  istDayIndex,
  parseCategoryIds,
  buildBookingWhere,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvIstDate,
} from "../../utils/reporting/index.js";
import { loadRevenueRows, sumRevenue } from "../../services/reporting/finance/revenue.js";
import { loadCollectionRows, summariseCollections, type CollectionRow } from "../../services/reporting/finance/collections.js";
import { getDuesByBooking } from "../../services/reporting/finance/booking-finance.js";

/**
 * Daily Summary Report — multi-day operational + cash-flow rollup (spec §4.2):
 * one row per IST calendar day in the range, including days with no activity.
 *
 * Nov 2026: every money/count column now comes from the SAME shared helpers as
 * the 2.x finance reports, so for the same day + branch (+ categories) the cards
 * equal those pages exactly:
 *   New Bookings / Revenue  = 2.1 Revenue Summary (loadRevenueRows: CONFIRMED,
 *       PICKED_UP, RETURNED by rental START date; revenue = rent (totalFinal −
 *       refundable deposit) + drop/pickup extras − goodwill). bookingValue keeps
 *       the old Σ totalFinal (incl. deposits) for reference.
 *   Cash / UPI / Card / Bank / Gateway Collected = 2.2 Payments & Collections
 *       mode split (loadCollectionRows + summariseCollections: money IN by payment
 *       date, COLLECTED + CONFIRMED, every purpose incl. security deposits;
 *       refunds paid out shown apart). The deposit and awaiting-confirmation parts
 *       are reported too so the page can say what the figure includes.
 *   Outstanding = 2.3 dues rule (dueOf: max(0, owed − confirmed money in net of
 *       refunds), as of now) for the bookings that START on that day; confirmed
 *       bookings still to start are "not yet due" and reported apart.
 *   Active Trips (PICKED_UP overlapping the day), Completed (return receipt date)
 *   and Cancellations (cancelledAt) are unchanged.
 * All bucketing uses istDayIndex against the IST range start (resolveReportRange
 * cuts at IST midnight whatever the server TZ).
 */

interface DayRow {
  date: string; // DD-MM-YYYY
  newBookings: number;
  activeTrips: number;
  completed: number;
  /** 2.1 revenue (rent + extras − goodwill; deposits excluded) */
  revenue: number;
  /** cash part of money in (2.2 mode split, incl. deposits + awaiting confirmation) */
  cashCollected: number;
  /** UPI part of money in (2.2 mode split) */
  upiCollected: number;
  /** counter Credit Card money (Nov 2026) */
  cardCollected: number;
  /** dues as of now on bookings starting this day (2.3 rule) */
  outstanding: number;
  cancellations: number;
  // ── additive (Nov 2026) ──
  rent: number;
  extras: number;
  goodwill: number;
  /** refundable deposits inside the bookings' totalFinal — not revenue */
  deposits: number;
  /** Σ totalFinal (the old "Revenue" figure: includes deposits, no extras) */
  bookingValue: number;
  bankCollected: number;
  gatewayCollected: number;
  /** all money in (2.2 "Collected") */
  collected: number;
  confirmed: number;
  awaitingConfirmation: number;
  rentalCollections: number;
  securityDeposits: number;
  refundsPaidOut: number;
  /** cash + UPI part of security-deposit payments (inside cash/upiCollected) */
  cashUpiDeposits: number;
  /** cash + UPI still awaiting the manager's confirmation (inside cash/upiCollected) */
  cashUpiAwaiting: number;
  payments: number;
  /** confirmed bookings starting later with an unpaid balance (not in outstanding) */
  outstandingNotYetDue: number;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const emptyDay = (date: string): DayRow => ({
  date,
  newBookings: 0,
  activeTrips: 0,
  completed: 0,
  revenue: 0,
  cashCollected: 0,
  upiCollected: 0,
  cardCollected: 0,
  outstanding: 0,
  cancellations: 0,
  rent: 0,
  extras: 0,
  goodwill: 0,
  deposits: 0,
  bookingValue: 0,
  bankCollected: 0,
  gatewayCollected: 0,
  collected: 0,
  confirmed: 0,
  awaitingConfirmation: 0,
  rentalCollections: 0,
  securityDeposits: 0,
  refundsPaidOut: 0,
  cashUpiDeposits: 0,
  cashUpiAwaiting: 0,
  payments: 0,
  outstandingNotYetDue: 0,
});

/** Fill the 2.2 money columns of `row` from that day's payment rows. */
const applyCollections = (row: DayRow, list: CollectionRow[]) => {
  const c = summariseCollections(list);
  row.cashCollected = c.modes.CASH;
  row.upiCollected = c.modes.UPI;
  row.cardCollected = c.modes.CARD;
  row.bankCollected = c.modes.BANK_TRANSFER;
  row.gatewayCollected = c.modes.GATEWAY;
  row.collected = c.collected;
  row.confirmed = c.confirmed;
  row.awaitingConfirmation = c.awaitingConfirmation;
  row.rentalCollections = c.rentalCollections;
  row.securityDeposits = c.securityDeposits;
  row.refundsPaidOut = c.refundsPaidOut;
  row.payments = c.transactions;
  let dep = 0;
  let awaiting = 0;
  for (const r of list) {
    if (!r.counted || r.direction !== "IN") continue;
    const cu = r.modes.CASH + r.modes.UPI;
    if (r.purpose === "SAFETY_DEPOSIT") dep += cu;
    if (r.status === "COLLECTED") awaiting += cu;
  }
  row.cashUpiDeposits = r2(dep);
  row.cashUpiAwaiting = r2(awaiting);
};

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
      const idx = istDayIndex(d, start);
      return idx >= 0 && idx < days ? idx : -1;
    };

    const baseFilter = { branchPublicId, categoryPublicIds, from: start, to: end };

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

    const scope = { branchPublicId: branchPublicId ?? null, categoryPublicIds, vehiclePublicId: null };
    const [revenueRows, activeBookings, completedBookings, cancelledBookings, paymentRows] =
      await Promise.all([
        // (1) 2.1 Revenue Summary rows — New Bookings + Revenue + Outstanding.
        loadRevenueRows({ ...scope, start, end }),
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
        // (5) 2.2 Payments & Collections rows — by payment date.
        loadCollectionRows(scope, { start, end }),
      ]);

    // Dues (2.3 rule, as of now) for the bookings starting in the range.
    const dues = await getDuesByBooking(revenueRows.map((r) => r.bookingId));

    // ── Bucket per calendar day ──────────────────────────────────────────────
    const rows: DayRow[] = Array.from({ length: days }, (_, i) =>
      // IST has no DST: day i starts exactly i×24h after the IST range start.
      emptyDay(csvIstDate(new Date(start.getTime() + i * 86_400_000))),
    );

    // (1) New Bookings + Revenue + Outstanding — anchored on startAt (2.1).
    const revenueByDay: Array<typeof revenueRows> = rows.map(() => []);
    for (const r of revenueRows) {
      const i = dayIndex(r.startAt);
      if (i < 0) continue;
      revenueByDay[i]!.push(r);
      const due = dues.get(r.bookingId);
      if (due?.counted) rows[i]!.outstanding += due.due;
      else if (due?.notYetDue) rows[i]!.outstandingNotYetDue += due.due;
    }
    rows.forEach((row, i) => {
      const t = sumRevenue(revenueByDay[i]!);
      row.newBookings = t.bookings;
      row.revenue = t.total;
      row.rent = t.rent;
      row.extras = t.extras;
      row.goodwill = t.goodwill;
      row.deposits = t.deposit;
      row.bookingValue = t.bookingValue;
      row.outstanding = r2(row.outstanding);
      row.outstandingNotYetDue = r2(row.outstandingNotYetDue);
    });

    // (2) Active Trips — a PICKED_UP booking is active on every day its interval covers.
    for (const b of activeBookings) {
      const firstIdx = Math.max(0, istDayIndex(b.startAt, start));
      const lastIdx = Math.min(days - 1, istDayIndex(b.endAt, start));
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

    // (5) Money in by mode — payment-date anchored (collectedAt, fallback createdAt), 2.2 rows.
    const paymentsByDay: CollectionRow[][] = rows.map(() => []);
    for (const p of paymentRows) {
      const i = dayIndex(p.paidAt);
      if (i >= 0) paymentsByDay[i]!.push(p);
    }
    rows.forEach((row, i) => applyCollections(row, paymentsByDay[i]!));

    // ── Totals ────────────────────────────────────────────────────────────────
    // Computed over the whole range with the same helpers (not by adding rounded
    // day figures), so they equal 2.1 / 2.2 for the same range to the paisa.
    const totalsRow = emptyDay("TOTAL");
    const revTotals = sumRevenue(revenueRows);
    totalsRow.newBookings = revTotals.bookings;
    totalsRow.revenue = revTotals.total;
    totalsRow.rent = revTotals.rent;
    totalsRow.extras = revTotals.extras;
    totalsRow.goodwill = revTotals.goodwill;
    totalsRow.deposits = revTotals.deposit;
    totalsRow.bookingValue = revTotals.bookingValue;
    applyCollections(totalsRow, paymentsByDay.flat());
    totalsRow.outstanding = r2(rows.reduce((s, r) => s + r.outstanding, 0));
    totalsRow.outstandingNotYetDue = r2(rows.reduce((s, r) => s + r.outstandingNotYetDue, 0));
    totalsRow.completed = rows.reduce((s, r) => s + r.completed, 0);
    totalsRow.cancellations = rows.reduce((s, r) => s + r.cancellations, 0);
    // Active Trips is a per-day snapshot, not a flow — its column total is the
    // sum of daily snapshots (matches the per-day rows being summed in CSV).
    const totalActiveTrips = rows.reduce((s, r) => s + r.activeTrips, 0);
    const { date: _omit, ...totals } = totalsRow;

    const reportData = {
      metadata: {
        period: { start: start.toISOString(), end: end.toISOString() },
        days,
        branch: branchName,
        generatedAt: new Date().toISOString(),
      },
      days: rows,
      totals: { ...totals, activeTrips: totalActiveTrips },
      definitions: {
        newBookings: "Confirmed, active and completed bookings by rental start date (same as Revenue Summary); cancelled and held bookings are not counted.",
        revenue: "Rent (booking total less the refundable deposit) + drop / pickup extras − goodwill refunds, by rental start date (same as Revenue Summary).",
        cashUpi: "Cash + UPI money received by payment date, including security deposits and money awaiting the manager's confirmation (same as Payments & Collections). Card, bank transfer and Razorpay are shown apart; refunds paid out are not subtracted.",
        outstanding: "Unpaid balance as of now on the bookings that start in the period (Outstanding Dues rule: confirmed money only; bookings still to start are not yet due).",
      },
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
        "Card Collected",
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
        "Card Collected": csvCurrency(r.cardCollected),
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
        "Card Collected": csvCurrency(totals.cardCollected),
        Outstanding: csvCurrency(totals.outstanding),
        Cancellations: totals.cancellations,
      });
      return exportRowsToCSV(res, {
        columns,
        rows: csvRows,
        summaryRows: [total],
        filename: `daily-summary-${csvIstDate(start)}-${csvIstDate(end)}`,
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
