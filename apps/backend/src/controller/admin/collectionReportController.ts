import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, Role } from "@repo/database/client";
import {
  resolveReportRange,
  getCollections,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvDate,
  type CollectionTxn,
  type SpecPaymentMode,
} from "../../utils/reporting/index.js";

/**
 * Collection Report — cash-flow report anchored on payment date (spec §4.3).
 * GET /api/admin/dashboard/reports/collection
 *
 * Source: PaymentTransaction (collected revenue txns) via the shared
 * `getCollections` core — payment-date anchored, sorted desc.
 *
 * Filters: branch (publicId), date range, Payment Mode (All/Cash/UPI/Gateway/Credit),
 * Staff/Executive (collectedById — resolved from a staff User publicId).
 *
 * Per-row columns (spec §4.3 order): Date, Booking ID, Customer Name,
 * Vehicle Reg No, Payment Mode, Amount Collected, Collected By, Branch, Reference No.
 *
 * Total Collected = Cash + UPI + Gateway (Credit/outstanding shown for visibility
 * but EXCLUDED). Summary block: Total Cash | UPI | Gateway | Credit | Grand Total.
 *
 * INVARIANT (spec §5.4): Collection Grand Total == Receipt Σ(Amount Received) for
 * the same date + payment-mode filters — both consume the identical collected-txn set.
 */

type ReportMode = SpecPaymentMode; // "Cash" | "UPI" | "Gateway" | "Credit"

const STAFF_ROLES: Role[] = [Role.STAFF, Role.MANAGER, Role.ADMIN];

/**
 * Per-row dominant payment mode for a collected txn. A txn may be split
 * (cash + online); classify by which component is largest, preferring
 * cash, then gateway, then upi. Collected txns always have total > 0, so
 * "Credit" never applies to a collection row (credit = uncollected).
 */
export const dominantMode = (t: CollectionTxn): ReportMode => {
  const entries: [ReportMode, number][] = [
    ["Cash", t.cash],
    ["Gateway", t.gateway],
    ["UPI", t.upi],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]![1] > 0 ? entries[0]![0] : "Cash";
};

/**
 * Normalise an incoming payment-mode param to a spec mode. Accepts both the
 * spec vocabulary (Cash/UPI/Gateway/Credit) and the legacy frontend vocabulary
 * (CASH/UPI/ONLINE). ONLINE maps to "Online" (matches both UPI and Gateway).
 */
const parseModeFilter = (
  raw: unknown,
): ReportMode | "Online" | undefined => {
  if (!raw || String(raw) === "all") return undefined;
  const v = String(raw).toUpperCase();
  if (v === "CASH") return "Cash";
  if (v === "UPI") return "UPI";
  if (v === "GATEWAY") return "Gateway";
  if (v === "CREDIT") return "Credit";
  if (v === "ONLINE") return "Online";
  return undefined;
};

const modeMatches = (
  rowMode: ReportMode,
  filter: ReportMode | "Online",
): boolean => {
  if (filter === "Online") return rowMode === "UPI" || rowMode === "Gateway";
  return rowMode === filter;
};

export const GetCollectionReport = async (req: Request, res: Response) => {
  try {
    const {
      branchId,
      branch,
      paymentMethod,
      paymentMode,
      staff,
      staffId,
      collectedBy,
      export: exportFormat,
    } = req.query;

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;

    const { start, end } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      from: req.query.from,
      to: req.query.to,
    });

    const modeFilter = parseModeFilter(paymentMode ?? paymentMethod);

    // --- Resolve staff publicId -> User.id (STAFF/MANAGER/ADMIN) ---
    const staffPublicId =
      staff && String(staff) !== "all"
        ? String(staff)
        : staffId && String(staffId) !== "all"
          ? String(staffId)
          : collectedBy && String(collectedBy) !== "all"
            ? String(collectedBy)
            : undefined;

    let collectedById: number | undefined;
    if (staffPublicId) {
      const staffUser = await prisma.user.findFirst({
        where: { publicId: staffPublicId, role: { in: STAFF_ROLES } },
        select: { id: true },
      });
      if (staffUser) collectedById = staffUser.id;
      else {
        // Unknown staff filter -> no matching collections.
        return res.status(StatusCode.OK).json({
          message: "Collection report generated successfully",
          data: emptyReport(start, end, branchPublicId, modeFilter, staffPublicId),
        });
      }
    }

    // --- Collected revenue txns (payment-date anchored, sorted desc) ---
    const txns = await getCollections({
      branchPublicId,
      from: start,
      to: end,
      collectedById,
    });

    const withMode = txns.map((t) => ({ txn: t, mode: dominantMode(t) }));
    const matched = modeFilter
      ? withMode.filter((r) => modeMatches(r.mode, modeFilter))
      : withMode;

    // --- Enrich with booking/customer/vehicle/branch/staff names ---
    const bookingIds = [...new Set(matched.map((r) => r.txn.bookingId))];
    const staffIds = [
      ...new Set(
        matched
          .map((r) => r.txn.collectedById)
          .filter((id): id is number => id !== null),
      ),
    ];

    const [bookings, staffUsers] = await Promise.all([
      bookingIds.length
        ? prisma.booking.findMany({
            where: { id: { in: bookingIds } },
            select: {
              id: true,
              publicId: true,
              customer: { select: { user: { select: { name: true } } } },
              branch: { select: { name: true } },
              items: {
                take: 1,
                select: { vehicle: { select: { regNo: true } } },
              },
            },
          })
        : Promise.resolve([]),
      staffIds.length
        ? prisma.user.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const staffNameById = new Map(staffUsers.map((u) => [u.id, u.name]));

    // --- Per-row output (spec §4.3 order), already payment-date desc ---
    const rows = matched.map(({ txn, mode }) => {
      const b = bookingById.get(txn.bookingId);
      return {
        date: txn.collectedAt.toISOString(),
        bookingId: b?.publicId ?? "N/A",
        customerName: b?.customer.user.name ?? "N/A",
        vehicleRegNo: b?.items[0]?.vehicle?.regNo ?? "N/A",
        paymentMode: mode,
        amountCollected: txn.total,
        collectedBy:
          txn.collectedById !== null
            ? (staffNameById.get(txn.collectedById) ?? "Unknown")
            : "—",
        branch: b?.branch.name ?? "N/A",
        referenceNo: txn.onlineTransactionRef ?? "",
      };
    });

    // --- Summary block (Credit excluded from Grand Total) ---
    const totalCash = matched.reduce((s, r) => s + r.txn.cash, 0);
    const totalUpi = matched.reduce((s, r) => s + r.txn.upi, 0);
    const totalGateway = matched.reduce((s, r) => s + r.txn.gateway, 0);
    const grandTotalCollected = totalCash + totalUpi + totalGateway;
    // Credit (outstanding) is not derivable from collected txns. Shown as 0
    // for visibility; excluded from Grand Total. See report data-gap note.
    const totalCredit = 0;

    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        dateRange: {
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
        },
        branch: branchPublicId ?? "All Branches",
        paymentMode: modeFilter ?? "All",
        staff: staffPublicId ?? "All",
      },
      summary: {
        totalCash,
        totalUpi,
        totalGateway,
        totalCredit,
        grandTotalCollected,
        totalTransactions: rows.length,
      },
      data: rows,
    };

    if (exportFormat === "csv") {
      const columns = [
        "Date",
        "Booking ID",
        "Customer Name",
        "Vehicle Reg No",
        "Payment Mode",
        "Amount Collected",
        "Collected By",
        "Branch",
        "Reference No",
      ];
      const csvRows = rows.map((r) => ({
        Date: csvDate(r.date),
        "Booking ID": r.bookingId,
        "Customer Name": r.customerName,
        "Vehicle Reg No": r.vehicleRegNo,
        "Payment Mode": r.paymentMode,
        "Amount Collected": csvCurrency(r.amountCollected),
        "Collected By": r.collectedBy,
        Branch: r.branch,
        "Reference No": r.referenceNo,
      }));
      const summaryRows = [
        summaryRow(columns, "Total Cash", {
          "Amount Collected": csvCurrency(totalCash),
        }),
        summaryRow(columns, "Total UPI", {
          "Amount Collected": csvCurrency(totalUpi),
        }),
        summaryRow(columns, "Total Gateway", {
          "Amount Collected": csvCurrency(totalGateway),
        }),
        summaryRow(columns, "Total Credit", {
          "Amount Collected": csvCurrency(totalCredit),
        }),
        summaryRow(columns, "Grand Total Collected", {
          "Amount Collected": csvCurrency(grandTotalCollected),
        }),
      ];
      return exportRowsToCSV(res, {
        columns,
        rows: csvRows,
        summaryRows,
        filename: `collection-report-${csvDate(start)}-${csvDate(end)}`,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Collection report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Collection Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate collection report",
    });
  }
};

const emptyReport = (
  start: Date,
  end: Date,
  branchPublicId: string | undefined,
  modeFilter: ReportMode | "Online" | undefined,
  staffPublicId: string | undefined,
) => ({
  metadata: {
    generatedAt: new Date().toISOString(),
    dateRange: {
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
    },
    branch: branchPublicId ?? "All Branches",
    paymentMode: modeFilter ?? "All",
    staff: staffPublicId ?? "All",
  },
  summary: {
    totalCash: 0,
    totalUpi: 0,
    totalGateway: 0,
    totalCredit: 0,
    grandTotalCollected: 0,
    totalTransactions: 0,
  },
  data: [],
});
