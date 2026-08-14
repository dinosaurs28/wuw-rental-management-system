import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import {
  parseCategoryIds,
  buildVehicleWhere,
  exportRowsToCSV,
  summaryRow,
  csvDate,
} from "../../utils/reporting/index.js";

/**
 * Insurance Expiry Report (spec §4.7) — compliance, no revenue.
 *
 * Conformed to spec:
 * - Vehicle filter via shared buildVehicleWhere: branch + category + EXCLUDE
 *   inactive. The previous date-window WHERE on insuranceExpiry is REMOVED so
 *   expired and far-future-valid vehicles are both included (the 3-level status
 *   cannot be derived if they are filtered out at the DB layer).
 * - 3-level status (replaces the old 5-level CRITICAL/HIGH/MEDIUM/LOW):
 *     Expired       = expiry <  today
 *     Expiring Soon = today <= expiry <= today+30
 *     Valid         = expiry >  today+30
 * - Expiry source = latest VehicleInsurance.validTill, fallback Vehicle.insuranceExpiry.
 * - Filters: branch, category, Expiry Status (All / Expiring Soon / Expired / Valid).
 * - Summary: X Expired, Y Expiring within 30 days, Z Valid. Sort: Days Until
 *   Expiry ascending. CSV implemented inline in spec column order.
 *
 * NOTE: the frontend still sends daysThreshold/alertType. daysThreshold is now
 * ignored (status is fixed-window 30 days); alertType is mapped where possible.
 * Insurance Start Date is not stored (VehicleInsurance has no validFrom) — the
 * column is present but always blank.
 *
 * GET /api/dashboard/reports/insurance-permit-expiry
 */

type InsuranceStatus = "Expired" | "Expiring Soon" | "Valid";

export const GetInsurancePermitExpiry = async (req: Request, res: Response) => {
  try {
    const {
      branchId,
      branch,
      categoryId,
      categories,
      expiryStatus,
      export: exportFormat,
    } = req.query;

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;
    const categoryPublicIds = parseCategoryIds(categories ?? categoryId);

    // Normalize the Expiry Status filter (default All).
    const rawStatus = String(expiryStatus ?? "all").toLowerCase();
    let statusFilter: InsuranceStatus | "All" = "All";
    if (rawStatus === "expired") statusFilter = "Expired";
    else if (rawStatus === "expiring" || rawStatus === "expiring soon")
      statusFilter = "Expiring Soon";
    else if (rawStatus === "valid") statusFilter = "Valid";

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const soonCutoff = new Date(today);
    soonCutoff.setDate(soonCutoff.getDate() + 30);
    soonCutoff.setHours(23, 59, 59, 999);

    // Branch + category + exclude inactive. NO date WHERE — fetch all, classify in JS.
    const vehicleWhere = buildVehicleWhere({
      branchPublicId,
      categoryPublicIds,
      includeInactive: false,
    });

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      include: {
        category: { select: { name: true } },
        branch: { select: { name: true, publicId: true } },
        insuranceRecords: { orderBy: { validTill: "desc" }, take: 1 },
      },
    });

    const classify = (expiry: Date): InsuranceStatus => {
      if (expiry.getTime() < today.getTime()) return "Expired";
      if (expiry.getTime() <= soonCutoff.getTime()) return "Expiring Soon";
      return "Valid";
    };

    // 3-level -> legacy 5-level alert key, so old frontend chart keys stay populated.
    const legacyAlert = (status: InsuranceStatus): string => {
      if (status === "Expired") return "EXPIRED";
      if (status === "Expiring Soon") return "HIGH";
      return "LOW";
    };

    const processedVehicles = vehicles.map((vehicle) => {
      const latestRecord = vehicle.insuranceRecords[0] || null;
      // Expiry = latest VehicleInsurance.validTill, fallback Vehicle.insuranceExpiry.
      const expiry = latestRecord?.validTill ?? vehicle.insuranceExpiry;

      const daysUntilExpiry = Math.ceil(
        (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      const status = classify(expiry);
      const alert = legacyAlert(status);

      return {
        vehicleId: vehicle.publicId,
        regNo: vehicle.regNo,
        make: vehicle.make,
        model: vehicle.model,
        vehicleName: `${vehicle.make} ${vehicle.model}`,
        category: vehicle.category.name,
        branch: vehicle.branch.name,
        status: vehicle.status,
        // spec §4.7 fields
        insuranceStatus: status,
        provider: latestRecord?.provider ?? "",
        policyNumber: latestRecord?.policyNumber ?? "",
        insuranceStartDate: "", // not stored (no validFrom) — blank per spec
        insuranceExpiryDate: expiry.toISOString(),
        daysUntilExpiry,
        // backward-compatible nested shape used by the existing frontend
        insurance: {
          expiryDate: expiry.toISOString(),
          daysRemaining: daysUntilExpiry,
          alertLevel: alert,
          policyNumber: latestRecord?.policyNumber ?? null,
          provider: latestRecord?.provider ?? null,
        },
        permit: {
          expiryDate: null,
          daysRemaining: null,
          alertLevel: null,
          permitNumber: null,
        },
        overallAlertLevel: alert,
      };
    });

    // Apply the Expiry Status filter (post-classification).
    const filtered =
      statusFilter === "All"
        ? processedVehicles
        : processedVehicles.filter((v) => v.insuranceStatus === statusFilter);

    // Sort: Days Until Expiry ascending (most urgent first).
    filtered.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

    // ----- Summary (3-level) over the FILTERED set ----------------------------
    const expiredCount = filtered.filter(
      (v) => v.insuranceStatus === "Expired",
    ).length;
    const expiringSoonCount = filtered.filter(
      (v) => v.insuranceStatus === "Expiring Soon",
    ).length;
    const validCount = filtered.filter(
      (v) => v.insuranceStatus === "Valid",
    ).length;

    // Branch-wise breakdown (backward-compatible widget).
    const branchBreakdown: Record<string, any> = {};
    filtered.forEach((v) => {
      if (!branchBreakdown[v.branch]) {
        branchBreakdown[v.branch] = {
          branch: v.branch,
          total: 0,
          critical: 0, // Expired
          high: 0, // Expired + Expiring Soon
          insuranceExpiring: 0,
          permitExpiring: 0,
        };
      }
      branchBreakdown[v.branch].total++;
      if (v.insuranceStatus === "Expired") branchBreakdown[v.branch].critical++;
      if (v.insuranceStatus !== "Valid") {
        branchBreakdown[v.branch].high++;
        branchBreakdown[v.branch].insuranceExpiring++;
      }
    });

    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        expiryStatus: statusFilter,
        alertType: "insurance",
        branch: branchPublicId ?? "All Branches",
      },
      summary: {
        totalVehicles: filtered.length,
        expired: expiredCount,
        expiringSoon: expiringSoonCount,
        valid: validCount,
        // backward-compatible keys for the existing frontend cards/charts
        criticalAlerts: expiredCount,
        highPriorityAlerts: expiredCount + expiringSoonCount,
        insuranceExpiring: expiringSoonCount,
        permitExpiring: 0,
        expiredInsurance: expiredCount,
        expiredPermit: 0,
        alertDistribution: {
          expired: expiredCount,
          critical: 0,
          high: expiringSoonCount,
          medium: 0,
          low: validCount,
        },
      },
      branchBreakdown: Object.values(branchBreakdown),
      vehicles: filtered,
    };

    // ----- CSV export (spec §4.7 column order) --------------------------------
    if (exportFormat === "csv") {
      const columns = [
        "Vehicle Reg No",
        "Vehicle Name",
        "Category",
        "Branch",
        "Insurance Provider",
        "Policy Number",
        "Insurance Start Date",
        "Insurance Expiry Date",
        "Days Until Expiry",
        "Status",
      ];
      const rows = filtered.map((v) => ({
        "Vehicle Reg No": v.regNo,
        "Vehicle Name": v.vehicleName,
        Category: v.category,
        Branch: v.branch,
        "Insurance Provider": v.provider,
        "Policy Number": v.policyNumber,
        "Insurance Start Date": "", // not stored (no validFrom) — blank per spec
        "Insurance Expiry Date": csvDate(v.insuranceExpiryDate),
        "Days Until Expiry": v.daysUntilExpiry,
        Status: v.insuranceStatus,
      }));
      const summary = summaryRow(columns, "TOTAL", {
        "Days Until Expiry": `${expiredCount} Expired, ${expiringSoonCount} Expiring ≤30d, ${validCount} Valid`,
      });
      return exportRowsToCSV(res, {
        columns,
        rows,
        summaryRows: [summary],
        filename: `insurance-expiry-${csvDate(today)}`,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Insurance expiry report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Insurance Expiry Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate insurance expiry report",
    });
  }
};
