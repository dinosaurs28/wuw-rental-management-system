/**
 * Admin fleet reports (spec 4.1–4.4, 5.1, 5.2, 6.1) + the vehicle expense entry
 * the profitability / damage reports read. Report endpoints are READ-ONLY; each
 * returns JSON, or CSV with ?export=csv (same filters). Rules: fleet.service.ts.
 *
 *   GET /api/admin/dashboard/reports/fleet/utilization
 *   GET /api/admin/dashboard/reports/fleet/idle?idleDays=7
 *   GET /api/admin/dashboard/reports/fleet/profitability
 *   GET /api/admin/dashboard/reports/fleet/km?view=trips|vehicles
 *   GET /api/admin/dashboard/reports/fleet/damage
 *   GET /api/admin/dashboard/reports/fleet/downtime?view=vehicles|episodes
 *   GET /api/admin/dashboard/reports/fleet/document-expiry?withinDays=30&docType=&status=
 *   GET/POST /api/admin/dashboard/fleet/expenses, PATCH/DELETE /api/admin/dashboard/fleet/expenses/:publicId
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@repo/database/client";
import {
  computeDelta,
  csvIstDateTime,
  handleReportError,
  parseReportFilters,
  streamCsv,
  ReportFilterError,
  type ReportFilters,
} from "../../utils/reporting/index.js";
import {
  DOC_LABELS,
  DOC_STATUS_LABELS,
  computeDamage,
  computeDowntime,
  computeIdle,
  computeKm,
  computeProfitability,
  computeUtilization,
  getDocumentExpiry,
  type FleetScope,
} from "../../services/reporting/fleet/fleet.service.js";
import type { DocType } from "../../services/reporting/fleet/fleet-math.js";
import { createID } from "../../utils/nanoID.js";

const scopeOf = (f: ReportFilters, range?: { start: Date; end: Date }): FleetScope => ({
  from: (range ?? f).start,
  to: (range ?? f).end,
  branchPublicId: f.branchPublicId,
  categoryPublicIds: f.categoryPublicIds,
  vehiclePublicId: f.vehiclePublicId,
});

const filtersEcho = (f: ReportFilters) => ({
  from: f.from,
  to: f.to,
  preset: f.preset,
  branchId: f.branchPublicId,
  categories: f.categoryPublicIds,
  vehicleId: f.vehiclePublicId,
});

const previousEcho = (f: ReportFilters) => ({
  from: f.previous.from,
  to: f.previous.to,
  label: f.previous.label,
  currentLabel: f.previous.currentLabel,
});

const DOWNTIME_LABELS: Record<string, string> = {
  MAINTENANCE: "Maintenance",
  MANAGER_REPORTED: "Damage review",
  INACTIVE: "Inactive",
  BOOKING_LOCK: "Booking lock",
};

const fname = (base: string, f?: ReportFilters) => (f ? `${base}-${f.from}-to-${f.to}` : base);

// ── 4.1 Utilization ───────────────────────────────────────────────────────

export const GetFleetUtilization = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const cur = await computeUtilization(scopeOf(f));
    if (f.exportCsv) {
      return streamCsv(res, {
        filename: fname("vehicle-utilization", f),
        columns: [
          { header: "Reg No", value: (r) => r.regNo },
          { header: "Vehicle", value: (r) => r.name },
          { header: "Branch", value: (r) => r.branchName },
          { header: "Category", value: (r) => r.categoryName },
          { header: "Current Status", value: (r) => r.status },
          { header: "Days In Range", value: (r) => r.rangeDays, type: "number" },
          { header: "Downtime Days", value: (r) => r.downtimeDays, type: "number" },
          { header: "Available Days", value: (r) => r.availableDays, type: "number" },
          { header: "Rented Days", value: (r) => r.rentedDays, type: "number" },
          { header: "Utilization %", value: (r) => r.utilizationPct, type: "number" },
          { header: "Rentals", value: (r) => r.rentals, type: "number" },
          { header: "Untracked Status Days", value: (r) => r.untrackedDays, type: "number" },
        ],
        rows: cur.vehicles,
        summaryRows: [
          {
            "Reg No": "TOTAL",
            "Days In Range": cur.totals.rangeDays,
            "Downtime Days": cur.totals.downtimeDays,
            "Available Days": cur.totals.availableDays,
            "Rented Days": cur.totals.rentedDays,
            "Utilization %": cur.totals.utilizationPct ?? "",
            "Untracked Status Days": cur.totals.untrackedDays,
          },
        ],
      });
    }
    const prev = f.compare ? await computeUtilization(scopeOf(f, f.previous)) : null;
    res.json({
      success: true,
      filters: filtersEcho(f),
      previous: prev ? previousEcho(f) : null,
      ...cur,
      previousTotals: prev?.totals ?? null,
      deltas: prev
        ? {
            utilizationPct: computeDelta(cur.totals.utilizationPct, prev.totals.utilizationPct),
            rentedDays: computeDelta(cur.totals.rentedDays, prev.totals.rentedDays),
            availableDays: computeDelta(cur.totals.availableDays, prev.totals.availableDays),
            downtimeDays: computeDelta(cur.totals.downtimeDays, prev.totals.downtimeDays),
          }
        : null,
      previousByCategory: prev?.byCategory ?? null,
    });
  } catch (err) {
    handleReportError(res, err, "vehicle utilization report");
  }
};

// ── 5.2 Downtime ──────────────────────────────────────────────────────────

export const GetFleetDowntime = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const cur = await computeDowntime(scopeOf(f));
    if (f.exportCsv) {
      if (String(req.query.view ?? "") === "episodes") {
        return streamCsv(res, {
          filename: fname("vehicle-downtime-periods", f),
          columns: [
            { header: "Reg No", value: (r) => r.regNo },
            { header: "Branch", value: (r) => r.branchName },
            { header: "Category", value: (r) => r.categoryName },
            { header: "Cause", value: (r) => DOWNTIME_LABELS[r.kind] ?? r.kind },
            { header: "From", value: (r) => r.start, type: "datetime" },
            { header: "To", value: (r) => (r.end ? csvIstDateTime(r.end) : "ongoing") },
            { header: "Days", value: (r) => r.days, type: "number" },
            { header: "Reason", value: (r) => r.reason ?? "" },
          ],
          rows: cur.episodes,
        });
      }
      return streamCsv(res, {
        filename: fname("vehicle-downtime", f),
        columns: [
          { header: "Reg No", value: (r) => r.regNo },
          { header: "Vehicle", value: (r) => r.name },
          { header: "Branch", value: (r) => r.branchName },
          { header: "Category", value: (r) => r.categoryName },
          { header: "Current Status", value: (r) => r.status },
          { header: "Days In Range", value: (r) => r.rangeDays, type: "number" },
          { header: "Maintenance Days", value: (r) => r.downtimeByKind.MAINTENANCE, type: "number" },
          { header: "Damage Review Days", value: (r) => r.downtimeByKind.MANAGER_REPORTED, type: "number" },
          { header: "Inactive Days", value: (r) => r.downtimeByKind.INACTIVE, type: "number" },
          { header: "Booking Lock Days", value: (r) => r.downtimeByKind.BOOKING_LOCK, type: "number" },
          { header: "Total Downtime Days", value: (r) => r.downtimeDays, type: "number" },
          { header: "Utilization % (excl. downtime)", value: (r) => r.utilizationPct, type: "number" },
          { header: "Utilization % (if downtime counted)", value: (r) => r.utilizationInclDowntimePct, type: "number" },
          { header: "Untracked Status Days", value: (r) => r.untrackedDays, type: "number" },
        ],
        rows: cur.vehicles,
        summaryRows: [
          {
            "Reg No": "TOTAL",
            "Days In Range": cur.totals.rangeDays,
            "Maintenance Days": cur.totals.byKind.MAINTENANCE,
            "Damage Review Days": cur.totals.byKind.MANAGER_REPORTED,
            "Inactive Days": cur.totals.byKind.INACTIVE,
            "Booking Lock Days": cur.totals.byKind.BOOKING_LOCK,
            "Total Downtime Days": cur.totals.downtimeDays,
            "Utilization % (excl. downtime)": cur.totals.utilizationPct ?? "",
            "Utilization % (if downtime counted)": cur.totals.utilizationInclDowntimePct ?? "",
            "Untracked Status Days": cur.totals.untrackedDays,
          },
        ],
      });
    }
    const prev = f.compare ? await computeDowntime(scopeOf(f, f.previous)) : null;
    res.json({
      success: true,
      filters: filtersEcho(f),
      previous: prev ? previousEcho(f) : null,
      ...cur,
      previousTotals: prev?.totals ?? null,
      deltas: prev
        ? {
            downtimeDays: computeDelta(cur.totals.downtimeDays, prev.totals.downtimeDays),
            vehiclesWithDowntime: computeDelta(cur.totals.vehiclesWithDowntime, prev.totals.vehiclesWithDowntime),
            utilizationPct: computeDelta(cur.totals.utilizationPct, prev.totals.utilizationPct),
          }
        : null,
    });
  } catch (err) {
    handleReportError(res, err, "vehicle downtime report");
  }
};

// ── 4.2 Idle ──────────────────────────────────────────────────────────────

const idleDaysSchema = z.coerce.number().int().min(1).max(365);

export const GetFleetIdle = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const rawN = req.query.idleDays;
    const parsedN = rawN === undefined || rawN === "" ? { success: true as const, data: 7 } : idleDaysSchema.safeParse(rawN);
    if (!parsedN.success) throw new ReportFilterError("idleDays must be a whole number from 1 to 365.");
    const result = await computeIdle({
      branchPublicId: f.branchPublicId,
      categoryPublicIds: f.categoryPublicIds,
      vehiclePublicId: f.vehiclePublicId,
      idleDays: parsedN.data,
    });
    if (f.exportCsv) {
      return streamCsv(res, {
        filename: `idle-vehicles-${parsedN.data}d`,
        columns: [
          { header: "Reg No", value: (r) => r.regNo },
          { header: "Vehicle", value: (r) => r.name },
          { header: "Branch", value: (r) => r.branchName },
          { header: "Category", value: (r) => r.categoryName },
          { header: "Current Status", value: (r) => r.status },
          { header: "Last Rental Ended", value: (r) => (r.lastRentalEnd ? csvIstDateTime(r.lastRentalEnd) : "Never rented") },
          { header: "Days Idle", value: (r) => r.daysIdle, type: "number" },
          { header: "Revenue Last 90 Days", value: (r) => r.revenue90d, type: "money" },
          { header: "Bookings Last 90 Days", value: (r) => r.bookings90d, type: "number" },
          { header: "Next Booking", value: (r) => r.nextBookingAt, type: "datetime" },
          { header: "Odometer", value: (r) => r.odometer, type: "number" },
        ],
        rows: result.rows,
      });
    }
    res.json({ success: true, filters: { ...filtersEcho(f), idleDays: parsedN.data }, ...result });
  } catch (err) {
    handleReportError(res, err, "idle vehicles report");
  }
};

// ── 4.3 Profitability ─────────────────────────────────────────────────────

export const GetFleetProfitability = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const result = await computeProfitability(scopeOf(f), f.compare && !f.exportCsv ? f.previous : undefined);
    if (f.exportCsv) {
      return streamCsv(res, {
        filename: fname("vehicle-profitability", f),
        columns: [
          { header: "Reg No", value: (r) => r.regNo },
          { header: "Vehicle", value: (r) => r.name },
          { header: "Branch", value: (r) => r.branchName },
          { header: "Category", value: (r) => r.categoryName },
          { header: "Bookings", value: (r) => r.bookings, type: "number" },
          { header: "Revenue", value: (r) => r.revenue, type: "money" },
          { header: "Maintenance Cost", value: (r) => r.maintenance, type: "money" },
          { header: "Repair Cost", value: (r) => r.repair, type: "money" },
          { header: "Other Cost", value: (r) => r.other, type: "money" },
          { header: "Total Recorded Cost", value: (r) => r.totalCost, type: "money" },
          { header: "Profit", value: (r) => r.profit, type: "money" },
          { header: "Margin %", value: (r) => r.marginPct, type: "number" },
          { header: "Costs Captured", value: (r) => (r.costsCaptured ? "Yes" : "No - costs not captured") },
        ],
        rows: result.rows,
        summaryRows: [
          {
            "Reg No": "TOTAL",
            Revenue: result.totals.revenue,
            "Maintenance Cost": result.totals.maintenance,
            "Repair Cost": result.totals.repair,
            "Other Cost": result.totals.other,
            "Total Recorded Cost": result.totals.totalCost,
            Profit: result.totals.profit,
            "Margin %": result.totals.marginPct ?? "",
          },
        ],
      });
    }
    const p = result.previousTotals;
    res.json({
      success: true,
      filters: filtersEcho(f),
      previous: p ? previousEcho(f) : null,
      ...result,
      deltas: p
        ? {
            revenue: computeDelta(result.totals.revenue, p.revenue),
            totalCost: computeDelta(result.totals.totalCost, p.totalCost),
            profit: computeDelta(result.totals.profit, p.profit),
          }
        : null,
    });
  } catch (err) {
    handleReportError(res, err, "vehicle profitability report");
  }
};

// ── 4.4 Km & mileage ──────────────────────────────────────────────────────

export const GetFleetKm = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const result = await computeKm(scopeOf(f), f.compare && !f.exportCsv ? f.previous : undefined);
    if (f.exportCsv) {
      if (String(req.query.view ?? "") === "vehicles") {
        return streamCsv(res, {
          filename: fname("km-by-vehicle", f),
          columns: [
            { header: "Reg No", value: (r) => r.regNo },
            { header: "Vehicle", value: (r) => r.name },
            { header: "Branch", value: (r) => r.branchName },
            { header: "Category", value: (r) => r.categoryName },
            { header: "Trips", value: (r) => r.trips, type: "number" },
            { header: "Km Driven", value: (r) => r.km, type: "number" },
            { header: "Trips With Unknown Km", value: (r) => r.unknownKmTrips, type: "number" },
            { header: "Avg Km Per Trip", value: (r) => r.avgKmPerTrip, type: "number" },
            { header: "Extra Km", value: (r) => r.extraKm, type: "number" },
            { header: "Extra Km Charged", value: (r) => r.extraKmCharged, type: "money" },
            { header: "Extra Km Collected", value: (r) => r.extraKmCollected, type: "money" },
            { header: "Current Odometer", value: (r) => r.odometer, type: "number" },
          ],
          rows: result.vehicles,
        });
      }
      return streamCsv(res, {
        filename: fname("km-by-trip", f),
        columns: [
          { header: "Booking", value: (r) => r.bookingPublicId },
          { header: "Customer", value: (r) => r.customerName },
          { header: "Branch", value: (r) => r.branchName },
          { header: "Vehicle(s)", value: (r) => r.vehicles },
          { header: "Start", value: (r) => r.startAt, type: "datetime" },
          { header: "Returned", value: (r) => r.returnedAt, type: "datetime" },
          { header: "Start Odometer", value: (r) => r.startOdometer, type: "number" },
          { header: "End Odometer", value: (r) => r.endOdometer, type: "number" },
          { header: "Swaps", value: (r) => r.swaps, type: "number" },
          { header: "Km Driven", value: (r) => r.totalKm, type: "number" },
          { header: "Free Km", value: (r) => r.freeKm, type: "number" },
          { header: "Extra Km", value: (r) => r.extraKm, type: "number" },
          { header: "Extra Km Charged", value: (r) => r.extraKmCharged, type: "money" },
          { header: "Extra Km Collected (pro-rata)", value: (r) => r.extraKmCollected, type: "money" },
          { header: "Extra Km Outstanding", value: (r) => r.extraKmOutstanding, type: "money" },
        ],
        rows: result.trips,
        summaryRows: [
          {
            Booking: "TOTAL",
            "Km Driven": result.totals.totalKm,
            "Extra Km": result.totals.extraKm,
            "Extra Km Charged": result.totals.extraKmCharged,
            "Extra Km Collected (pro-rata)": result.totals.extraKmCollected,
            "Extra Km Outstanding": result.totals.extraKmOutstanding,
          },
        ],
      });
    }
    const p = result.previousTotals;
    res.json({
      success: true,
      filters: filtersEcho(f),
      previous: p ? previousEcho(f) : null,
      ...result,
      deltas: p
        ? {
            totalKm: computeDelta(result.totals.totalKm, p.totalKm),
            trips: computeDelta(result.totals.trips, p.trips),
            avgKmPerTrip: computeDelta(result.totals.avgKmPerTrip, p.avgKmPerTrip),
            extraKmCharged: computeDelta(result.totals.extraKmCharged, p.extraKmCharged),
          }
        : null,
    });
  } catch (err) {
    handleReportError(res, err, "km and mileage report");
  }
};

// ── 5.1 Damage ────────────────────────────────────────────────────────────

export const GetFleetDamage = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const result = await computeDamage(scopeOf(f), f.compare && !f.exportCsv ? f.previous : undefined);
    if (f.exportCsv) {
      return streamCsv(res, {
        filename: fname("damage-report", f),
        columns: [
          { header: "Logged", value: (r) => r.loggedAt, type: "datetime" },
          { header: "Damage Report", value: (r) => r.publicId },
          { header: "Booking", value: (r) => r.bookingPublicId },
          { header: "Customer", value: (r) => r.customerName },
          { header: "Reg No", value: (r) => r.regNo },
          { header: "Branch", value: (r) => r.branchName },
          { header: "Category", value: (r) => r.categoryName },
          { header: "Severity", value: (r) => r.severity },
          { header: "Type", value: (r) => r.chargeType },
          { header: "Status", value: (r) => r.status },
          { header: "Charged At Drop", value: (r) => r.chargedAtDrop, type: "bool" },
          { header: "Estimated Cost", value: (r) => r.estimatedCost, type: "money" },
          { header: "Charged To Customer", value: (r) => r.chargedToCustomer, type: "money" },
          { header: "Recovered", value: (r) => r.recovered, type: "money" },
          { header: "Unrecovered", value: (r) => r.unrecovered, type: "money" },
          { header: "Repair Cost", value: (r) => (r.repairCost == null ? "not recorded" : r.repairCost), type: "text" },
          { header: "Repair Cost - Recovered", value: (r) => (r.difference == null ? "" : r.difference), type: "text" },
        ],
        rows: result.rows,
        summaryRows: [
          {
            Logged: "TOTAL",
            "Charged To Customer": result.totals.chargedToCustomer,
            Recovered: result.totals.recovered,
            Unrecovered: result.totals.unrecovered,
            "Repair Cost": result.totals.repairCost,
            "Repair Cost - Recovered": result.totals.difference,
          },
        ],
      });
    }
    const p = result.previousTotals;
    res.json({
      success: true,
      filters: filtersEcho(f),
      previous: p ? previousEcho(f) : null,
      ...result,
      deltas: p
        ? {
            damages: computeDelta(result.totals.damages, p.damages),
            chargedToCustomer: computeDelta(result.totals.chargedToCustomer, p.chargedToCustomer),
            recovered: computeDelta(result.totals.recovered, p.recovered),
            repairCost: computeDelta(result.totals.repairCost, p.repairCost),
          }
        : null,
    });
  } catch (err) {
    handleReportError(res, err, "damage report");
  }
};

// ── 6.1 Document expiry ───────────────────────────────────────────────────

const DOC_TYPES: DocType[] = ["INSURANCE", "RC", "PERMIT", "PUC", "FITNESS"];

export const GetFleetDocumentExpiry = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const within = req.query.withinDays === undefined || req.query.withinDays === "" ? 30 : Number(req.query.withinDays);
    if (!Number.isInteger(within) || within < 0 || within > 365) {
      throw new ReportFilterError("withinDays must be a whole number from 0 to 365.");
    }
    const docTypes = String(req.query.docType ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is DocType => (DOC_TYPES as string[]).includes(s));
    const statusFilter = String(req.query.status ?? "").toUpperCase();
    const result = await getDocumentExpiry({
      branchPublicId: f.branchPublicId,
      categoryPublicIds: f.categoryPublicIds,
      vehiclePublicId: f.vehiclePublicId,
      withinDays: within,
      docTypes,
    });
    const rows = ["EXPIRED", "EXPIRING_7", "EXPIRING_30"].includes(statusFilter)
      ? result.rows.filter((r) => r.status === statusFilter)
      : result.rows;
    if (f.exportCsv) {
      return streamCsv(res, {
        filename: "vehicle-document-expiry",
        columns: [
          { header: "Reg No", value: (r) => r.regNo },
          { header: "Vehicle", value: (r) => `${r.make} ${r.model}` },
          { header: "Branch", value: (r) => r.branchName },
          { header: "Category", value: (r) => r.categoryName },
          { header: "Document", value: (r) => DOC_LABELS[r.docType] },
          { header: "Expiry Date", value: (r) => r.expiryDate, type: "date" },
          { header: "Days Left", value: (r) => r.daysLeft, type: "number" },
          { header: "Status", value: (r) => DOC_STATUS_LABELS[r.status] },
        ],
        rows,
      });
    }
    res.json({
      success: true,
      filters: { branchId: f.branchPublicId, categories: f.categoryPublicIds, vehicleId: f.vehiclePublicId, withinDays: within, docType: docTypes, status: statusFilter || null },
      ...result,
      rows,
      notes: [
        "Shows documents already expired plus those expiring within the window, for active vehicles. Days left counts IST calendar days (0 = expires today).",
        "Insurance = the latest insurance record's valid-till date (else the vehicle's insurance expiry). RC, Permit, PUC and Fitness expiry dates are entered on the vehicle form; vehicles without a date are counted as 'not recorded', never as valid.",
      ],
    });
  } catch (err) {
    handleReportError(res, err, "document expiry report");
  }
};

// ── Vehicle expenses (admin entry) ────────────────────────────────────────

const expenseBody = z.object({
  vehicleId: z.string().min(1, "Pick a vehicle"),
  category: z.enum(["MAINTENANCE", "REPAIR", "OTHER"]),
  amount: z.coerce.number().positive("Amount must be more than 0").max(10_000_000),
  incurredAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Pick a valid date"),
  note: z.string().trim().max(500).optional().nullable(),
  damageReportId: z.string().trim().optional().nullable(),
});

const expenseSelect = {
  publicId: true,
  category: true,
  amount: true,
  incurredAt: true,
  note: true,
  createdAt: true,
  vehicle: { select: { publicId: true, regNo: true, make: true, model: true, branch: { select: { name: true } } } },
  damageReport: { select: { publicId: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.VehicleExpenseSelect;

const viewExpense = (e: Prisma.VehicleExpenseGetPayload<{ select: typeof expenseSelect }>) => ({
  publicId: e.publicId,
  category: e.category,
  amount: Number(e.amount),
  incurredAt: e.incurredAt,
  note: e.note,
  createdAt: e.createdAt,
  createdBy: e.createdBy?.name ?? null,
  vehicle: {
    publicId: e.vehicle.publicId,
    regNo: e.vehicle.regNo,
    name: `${e.vehicle.make} ${e.vehicle.model}`,
    branchName: e.vehicle.branch.name,
  },
  damageReportId: e.damageReport?.publicId ?? null,
});

async function resolveExpenseRefs(body: z.infer<typeof expenseBody>) {
  const vehicle = await prisma.vehicle.findUnique({ where: { publicId: body.vehicleId }, select: { id: true } });
  if (!vehicle) return { error: "Vehicle not found" } as const;
  let damageReportId: number | null = null;
  if (body.damageReportId) {
    const dr = await prisma.damageReport.findUnique({
      where: { publicId: body.damageReportId },
      select: { id: true, vehicleId: true },
    });
    if (!dr) return { error: "Damage report not found" } as const;
    if (dr.vehicleId !== vehicle.id) return { error: "That damage report belongs to a different vehicle" } as const;
    damageReportId = dr.id;
  }
  return { vehicleId: vehicle.id, damageReportId } as const;
}

export const ListVehicleExpenses = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>);
    const where: Prisma.VehicleExpenseWhereInput = {
      deletedAt: null,
      incurredAt: { gte: f.start, lte: f.end },
      vehicle: {
        ...(f.branchPublicId && { branch: { publicId: f.branchPublicId } }),
        ...(f.categoryPublicIds.length > 0 && { category: { publicId: { in: f.categoryPublicIds } } }),
        ...(f.vehiclePublicId && { publicId: f.vehiclePublicId }),
      },
    };
    const rows = await prisma.vehicleExpense.findMany({
      where,
      select: expenseSelect,
      orderBy: [{ incurredAt: "desc" }, { id: "desc" }],
      take: 2000,
    });
    const items = rows.map(viewExpense);
    if (f.exportCsv) {
      return streamCsv(res, {
        filename: fname("vehicle-expenses", f),
        columns: [
          { header: "Date", value: (r) => r.incurredAt, type: "date" },
          { header: "Reg No", value: (r) => r.vehicle.regNo },
          { header: "Vehicle", value: (r) => r.vehicle.name },
          { header: "Branch", value: (r) => r.vehicle.branchName },
          { header: "Category", value: (r) => r.category },
          { header: "Amount", value: (r) => r.amount, type: "money" },
          { header: "Damage Report", value: (r) => r.damageReportId ?? "" },
          { header: "Note", value: (r) => r.note ?? "" },
          { header: "Entered By", value: (r) => r.createdBy ?? "" },
        ],
        rows: items,
      });
    }
    res.json({
      success: true,
      filters: filtersEcho(f),
      total: Math.round(items.reduce((s, e) => s + e.amount, 0) * 100) / 100,
      items,
    });
  } catch (err) {
    handleReportError(res, err, "vehicle expenses");
  }
};

export const CreateVehicleExpense = async (req: Request, res: Response) => {
  try {
    const parsed = expenseBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid expense" });
    }
    const refs = await resolveExpenseRefs(parsed.data);
    if ("error" in refs) return res.status(400).json({ message: refs.error });
    const actor = req.public_Id
      ? await prisma.user.findUnique({ where: { publicId: req.public_Id }, select: { id: true } })
      : null;
    const created = await prisma.vehicleExpense.create({
      data: {
        publicId: createID(),
        vehicleId: refs.vehicleId,
        category: parsed.data.category,
        amount: new Prisma.Decimal(parsed.data.amount).toDecimalPlaces(2),
        incurredAt: new Date(parsed.data.incurredAt),
        note: parsed.data.note || null,
        damageReportId: refs.damageReportId,
        createdById: actor?.id ?? null,
      },
      select: expenseSelect,
    });
    res.status(201).json({ success: true, expense: viewExpense(created) });
  } catch (err) {
    console.error("[fleet] create expense:", err);
    res.status(500).json({ message: "Failed to save the expense" });
  }
};

export const UpdateVehicleExpense = async (req: Request, res: Response) => {
  try {
    const existing = await prisma.vehicleExpense.findFirst({
      where: { publicId: String(req.params.publicId), deletedAt: null },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ message: "Expense not found" });
    const parsed = expenseBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid expense" });
    }
    const refs = await resolveExpenseRefs(parsed.data);
    if ("error" in refs) return res.status(400).json({ message: refs.error });
    const updated = await prisma.vehicleExpense.update({
      where: { id: existing.id },
      data: {
        vehicleId: refs.vehicleId,
        category: parsed.data.category,
        amount: new Prisma.Decimal(parsed.data.amount).toDecimalPlaces(2),
        incurredAt: new Date(parsed.data.incurredAt),
        note: parsed.data.note || null,
        damageReportId: refs.damageReportId,
      },
      select: expenseSelect,
    });
    res.json({ success: true, expense: viewExpense(updated) });
  } catch (err) {
    console.error("[fleet] update expense:", err);
    res.status(500).json({ message: "Failed to update the expense" });
  }
};

/** Soft delete (deletedAt) — the row stays for audit. */
export const DeleteVehicleExpense = async (req: Request, res: Response) => {
  try {
    const { count } = await prisma.vehicleExpense.updateMany({
      where: { publicId: String(req.params.publicId), deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) return res.status(404).json({ message: "Expense not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[fleet] delete expense:", err);
    res.status(500).json({ message: "Failed to delete the expense" });
  }
};
