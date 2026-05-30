import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, Prisma } from "@repo/database/client";
import {
  resolveReportRange,
  parseCategoryIds,
  buildBookingWhere,
  buildBookingSnapshotWhere,
  getPaidByBooking,
  REVENUE_BOOKING_STATUSES,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvDate,
} from "../../utils/reporting/index.js";

/**
 * Customer Report Controller (spec §4.11)
 * GET /api/admin/dashboard/reports/customers
 *
 * Conformed to spec:
 * - Date range anchored on booking.startAt (booking_start_date) via buildBookingWhere.
 * - Only customers with bookings in range; sorted by Revenue in Range desc.
 * - Filters: branch, date, category, Customer Type (All / New / Returning).
 * - Per customer: all-time bookings count, in-range bookings, in-range revenue
 *   (SUM totalFinal over revenue statuses), Amount Paid (canonical
 *   getPaidByBooking — NOT the credit ledger), Outstanding (Revenue − Paid),
 *   Last Booking Date (MAX startAt), Customer Type (New = first-ever revenue
 *   booking is within range; else Returning).
 * - CSV export in spec column order with a TOTAL summary row.
 *
 * Backward compatibility: preserves every JSON field the frontend reads
 * (customerId, name, phone, email, registeredAt, isProfileCompleted,
 * totalBookings, totalRevenue, totalOutstanding, lastBookingDate, plus the
 * summary keys). Note: totalBookings is now ALL-TIME (spec column meaning) and
 * totalOutstanding is now Revenue − Paid (spec-canonical, not the credit
 * ledger). New unambiguous fields are added alongside.
 */

type CustomerTypeFilter = "all" | "new" | "returning";

export const GetCustomerReport = async (req: Request, res: Response) => {
  try {
    const {
      branchId,
      branch,
      categories,
      categoryId,
      search,
      customerType,
      page = "1",
      limit = "50",
      export: exportFormat,
    } = req.query;

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;
    const categoryPublicIds = parseCategoryIds(categories ?? categoryId);

    const { start, end } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      from: req.query.from,
      to: req.query.to,
    });

    const typeFilter = (
      customerType && String(customerType) !== "all"
        ? String(customerType).toLowerCase()
        : "all"
    ) as CustomerTypeFilter;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));

    // --- In-range bookings (canonical: startAt anchor, revenue statuses) ---
    const inRangeWhere = buildBookingWhere({
      branchPublicId,
      categoryPublicIds,
      from: start,
      to: end,
      statuses: REVENUE_BOOKING_STATUSES,
    });

    const inRangeBookings = await prisma.booking.findMany({
      where: inRangeWhere,
      select: {
        id: true,
        customerId: true,
        totalFinal: true,
        startAt: true,
      },
    });

    if (inRangeBookings.length === 0) {
      const empty = {
        message: "Customer report generated successfully",
        data: {
          metadata: {
            generatedAt: new Date().toISOString(),
            period: { start: start.toISOString(), end: end.toISOString() },
            dateRange: {
              startDate: start.toISOString().split("T")[0] ?? null,
              endDate: end.toISOString().split("T")[0] ?? null,
            },
            filters: {
              branch: branchPublicId ?? "All Branches",
              customerType: typeFilter,
            },
          },
          summary: {
            totalCustomers: 0,
            totalRevenue: 0,
            totalOutstanding: 0,
            totalBookings: 0,
          },
          data: [],
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalRecords: 0,
            hasNext: false,
            hasPrev: false,
          },
        },
      };
      if (exportFormat === "csv") {
        return exportCustomerCSV(res, [], start, end);
      }
      return res.status(StatusCode.OK).json(empty);
    }

    // Aggregate in-range revenue + booking count + last booking per customer.
    const inRangeByCustomer = new Map<
      number,
      { revenue: number; bookings: number; bookingIds: number[]; lastStartAt: Date }
    >();
    for (const b of inRangeBookings) {
      const entry = inRangeByCustomer.get(b.customerId) ?? {
        revenue: 0,
        bookings: 0,
        bookingIds: [],
        lastStartAt: b.startAt,
      };
      entry.revenue += Number(b.totalFinal);
      entry.bookings += 1;
      entry.bookingIds.push(b.id);
      if (b.startAt.getTime() > entry.lastStartAt.getTime()) {
        entry.lastStartAt = b.startAt;
      }
      inRangeByCustomer.set(b.customerId, entry);
    }

    const customerIds = Array.from(inRangeByCustomer.keys());

    // --- All-time stats per customer (revenue statuses, no date anchor) ---
    // _min.startAt is the first-ever revenue booking; _count is all-time bookings.
    const allTimeGroups = await prisma.booking.groupBy({
      by: ["customerId"],
      where: {
        ...buildBookingSnapshotWhere({
          branchPublicId,
          categoryPublicIds,
          statuses: REVENUE_BOOKING_STATUSES,
        }),
        customerId: { in: customerIds },
      },
      _count: { _all: true },
      _min: { startAt: true },
    });
    const allTimeByCustomer = new Map(
      allTimeGroups.map((g) => [
        g.customerId,
        { count: g._count._all, firstStartAt: g._min.startAt },
      ]),
    );

    // --- Canonical paid amounts for all in-range bookings ---
    const allBookingIds = inRangeBookings.map((b) => b.id);
    const paidMap = await getPaidByBooking(allBookingIds);

    // --- Customer profile + user details ---
    const searchStr = search ? String(search).trim() : "";
    const customerWhere: Prisma.CustomerWhereInput = {
      id: { in: customerIds },
      deletedAt: null,
    };
    if (searchStr) {
      customerWhere.user = {
        OR: [
          { name: { contains: searchStr, mode: "insensitive" } },
          { phone: { contains: searchStr, mode: "insensitive" } },
          { email: { contains: searchStr, mode: "insensitive" } },
        ],
      };
    }
    const customers = await prisma.customer.findMany({
      where: customerWhere,
      select: {
        id: true,
        publicId: true,
        isProfileCompleted: true,
        user: {
          select: { name: true, phone: true, email: true, createdAt: true },
        },
      },
    });

    // --- Build rows ---
    let rows = customers.map((c) => {
      const inRange = inRangeByCustomer.get(c.id)!;
      const allTime = allTimeByCustomer.get(c.id);
      const amountPaid = inRange.bookingIds.reduce(
        (s, id) => s + (paidMap.get(id)?.total ?? 0),
        0,
      );
      const revenueInRange = inRange.revenue;
      const outstanding = Math.max(0, revenueInRange - amountPaid);
      const firstStartAt = allTime?.firstStartAt ?? inRange.lastStartAt;
      const isNew = firstStartAt.getTime() >= start.getTime();

      return {
        customerId: c.publicId,
        name: c.user.name,
        phone: c.user.phone,
        email: c.user.email,
        registeredAt: c.user.createdAt.toISOString(),
        isProfileCompleted: c.isProfileCompleted,
        // Spec column "Total Bookings" = all-time count.
        totalBookings: allTime?.count ?? inRange.bookings,
        totalBookingsAllTime: allTime?.count ?? inRange.bookings,
        bookingsInRange: inRange.bookings,
        // Preserve totalRevenue (== in-range revenue) + explicit alias.
        totalRevenue: revenueInRange,
        revenueInRange,
        amountPaid,
        // totalOutstanding now spec-canonical (Revenue − Paid), not credit ledger.
        totalOutstanding: outstanding,
        outstanding,
        lastBookingDate: inRange.lastStartAt.toISOString(),
        customerType: isNew ? "New" : "Returning",
      };
    });

    // --- Customer Type filter ---
    if (typeFilter === "new") {
      rows = rows.filter((r) => r.customerType === "New");
    } else if (typeFilter === "returning") {
      rows = rows.filter((r) => r.customerType === "Returning");
    }

    // Sort by Revenue in Range desc (spec default).
    rows.sort((a, b) => b.revenueInRange - a.revenueInRange);

    // --- Summary (over the full filtered set, before pagination) ---
    const summary = {
      totalCustomers: rows.length,
      totalRevenue: rows.reduce((s, r) => s + r.revenueInRange, 0),
      totalOutstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      totalBookings: rows.reduce((s, r) => s + r.bookingsInRange, 0),
    };

    // --- CSV export (all rows) ---
    if (exportFormat === "csv") {
      return exportCustomerCSV(res, rows, start, end);
    }

    // --- Pagination ---
    const totalRecords = rows.length;
    const totalPages = Math.ceil(totalRecords / limitNum) || 1;
    const pageRows = rows.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    return res.status(StatusCode.OK).json({
      message: "Customer report generated successfully",
      data: {
        metadata: {
          generatedAt: new Date().toISOString(),
          period: { start: start.toISOString(), end: end.toISOString() },
          dateRange: {
            startDate: start.toISOString().split("T")[0] ?? null,
            endDate: end.toISOString().split("T")[0] ?? null,
          },
          filters: {
            branch: branchPublicId ?? "All Branches",
            customerType: typeFilter,
          },
        },
        summary,
        data: pageRows,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalRecords,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
        },
      },
    });
  } catch (error) {
    console.error("Customer Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate customer report",
    });
  }
};

// CSV export in spec §4.11 column order with a TOTAL summary row.
const exportCustomerCSV = (
  res: Response,
  rows: Array<{
    name: string;
    phone: string;
    email: string;
    registeredAt: string;
    totalBookings: number;
    bookingsInRange: number;
    revenueInRange: number;
    amountPaid: number;
    outstanding: number;
    lastBookingDate: string | null;
    customerType: string;
  }>,
  start: Date,
  end: Date,
) => {
  const columns = [
    "Customer Name",
    "Phone",
    "Email",
    "Registered On",
    "Total Bookings",
    "Bookings in Range",
    "Revenue in Range",
    "Amount Paid",
    "Outstanding",
    "Last Booking Date",
    "Customer Type",
  ];
  const csvRows = rows.map((r) => ({
    "Customer Name": r.name,
    Phone: r.phone,
    Email: r.email,
    "Registered On": csvDate(r.registeredAt),
    "Total Bookings": r.totalBookings,
    "Bookings in Range": r.bookingsInRange,
    "Revenue in Range": csvCurrency(r.revenueInRange),
    "Amount Paid": csvCurrency(r.amountPaid),
    Outstanding: csvCurrency(r.outstanding),
    "Last Booking Date": csvDate(r.lastBookingDate),
    "Customer Type": r.customerType,
  }));
  const totals = rows.reduce(
    (acc, r) => {
      acc.revenue += r.revenueInRange;
      acc.paid += r.amountPaid;
      acc.outstanding += r.outstanding;
      return acc;
    },
    { revenue: 0, paid: 0, outstanding: 0 },
  );
  const summary = summaryRow(columns, "TOTAL", {
    "Total Bookings": rows.reduce((s, r) => s + r.totalBookings, 0),
    "Bookings in Range": rows.reduce((s, r) => s + r.bookingsInRange, 0),
    "Revenue in Range": csvCurrency(totals.revenue),
    "Amount Paid": csvCurrency(totals.paid),
    Outstanding: csvCurrency(totals.outstanding),
  });
  return exportRowsToCSV(res, {
    columns,
    rows: csvRows,
    summaryRows: [summary],
    filename: `customer-report-${csvDate(start)}-${csvDate(end)}`,
  });
};
