import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";

/**
 * Insurance Expiry Report Controller
 * GET /api/dashboard/reports/insurance-permit-expiry
 *
 * Query Parameters:
 * - daysThreshold: number (optional) - Default: 90 (show vehicles expiring in next X days)
 * - branchId: string (optional) - Filter by branch
 * - export: 'xlsx' | 'csv' (optional)
 *
 * Note: Currently tracks only insurance expiry. Permit tracking can be added when schema is updated.
 */
export const GetInsurancePermitExpiry = async (req: Request, res: Response) => {
  try {
    const { daysThreshold = "90", branchId, export: exportFormat } = req.query;

    const threshold = parseInt(daysThreshold as string);
    const currentDate = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + threshold);

    // Build filter conditions
    const vehicleFilter: any = {
      deletedAt: null,
      status: {
        not: "INACTIVE",
      },
      insuranceExpiry: {
        lte: futureDate,
        gte: currentDate,
      },
    };

    if (branchId && branchId !== "all") {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
      });
      if (branch) {
        vehicleFilter.branchId = branch.id;
      }
    }

    // ========================================================================
    // Fetch vehicles with upcoming insurance expiry
    // ========================================================================

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleFilter,
      include: {
        category: {
          select: {
            name: true,
          },
        },
        branch: {
          select: {
            name: true,
            publicId: true,
          },
        },
        insuranceRecords: {
          orderBy: {
            validTill: "desc",
          },
          take: 1,
        },
      },
      orderBy: [{ insuranceExpiry: "asc" }],
    });

    // ========================================================================
    // Process vehicles and calculate days remaining
    // ========================================================================

    const processedVehicles = vehicles.map((vehicle) => {
      const insuranceDaysRemaining = Math.ceil(
        (vehicle.insuranceExpiry.getTime() - currentDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      // Determine alert severity
      const getAlertLevel = (days: number) => {
        if (days < 0) return "EXPIRED";
        if (days <= 7) return "CRITICAL";
        if (days <= 30) return "HIGH";
        if (days <= 60) return "MEDIUM";
        return "LOW";
      };

      const insuranceAlert = getAlertLevel(insuranceDaysRemaining);
      const latestInsuranceRecord = vehicle.insuranceRecords[0] || null;

      return {
        vehicleId: vehicle.publicId,
        regNo: vehicle.regNo,
        make: vehicle.make,
        model: vehicle.model,
        category: vehicle.category.name,
        branch: vehicle.branch.name,
        status: vehicle.status,
        insurance: {
          expiryDate: vehicle.insuranceExpiry.toISOString(),
          daysRemaining: insuranceDaysRemaining,
          alertLevel: insuranceAlert,
          policyNumber: latestInsuranceRecord?.policyNumber || null,
          provider: latestInsuranceRecord?.provider || null,
        },
        permit: {
          expiryDate: null,
          daysRemaining: null,
          alertLevel: null,
          permitNumber: null,
        },
        overallAlertLevel: insuranceAlert,
      };
    });

    // ========================================================================
    // Calculate summary metrics
    // ========================================================================

    const totalVehicles = processedVehicles.length;

    const criticalAlerts = processedVehicles.filter(
      (v) =>
        v.overallAlertLevel === "CRITICAL" || v.overallAlertLevel === "EXPIRED",
    ).length;

    const highPriorityAlerts = processedVehicles.filter(
      (v) =>
        v.overallAlertLevel === "HIGH" ||
        v.overallAlertLevel === "CRITICAL" ||
        v.overallAlertLevel === "EXPIRED",
    ).length;

    const insuranceExpiring = processedVehicles.filter(
      (v) => v.insurance.daysRemaining <= threshold,
    ).length;

    const expiredInsurance = processedVehicles.filter(
      (v) => v.insurance.daysRemaining < 0,
    ).length;

    // Alert distribution by severity
    const alertDistribution = {
      expired: processedVehicles.filter(
        (v) => v.overallAlertLevel === "EXPIRED",
      ).length,
      critical: processedVehicles.filter(
        (v) => v.overallAlertLevel === "CRITICAL",
      ).length,
      high: processedVehicles.filter((v) => v.overallAlertLevel === "HIGH")
        .length,
      medium: processedVehicles.filter((v) => v.overallAlertLevel === "MEDIUM")
        .length,
      low: processedVehicles.filter((v) => v.overallAlertLevel === "LOW")
        .length,
    };

    // Branch-wise breakdown
    const branchBreakdown: Record<string, any> = {};
    processedVehicles.forEach((vehicle) => {
      if (!branchBreakdown[vehicle.branch]) {
        branchBreakdown[vehicle.branch] = {
          branch: vehicle.branch,
          total: 0,
          critical: 0,
          high: 0,
          insuranceExpiring: 0,
          permitExpiring: 0,
        };
      }

      branchBreakdown[vehicle.branch].total++;
      if (
        vehicle.overallAlertLevel === "CRITICAL" ||
        vehicle.overallAlertLevel === "EXPIRED"
      ) {
        branchBreakdown[vehicle.branch].critical++;
      }
      if (
        vehicle.overallAlertLevel === "HIGH" ||
        vehicle.overallAlertLevel === "CRITICAL" ||
        vehicle.overallAlertLevel === "EXPIRED"
      ) {
        branchBreakdown[vehicle.branch].high++;
      }
      if (vehicle.insurance.daysRemaining <= threshold) {
        branchBreakdown[vehicle.branch].insuranceExpiring++;
      }
    });

    // ========================================================================
    // Build response
    // ========================================================================

    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        daysThreshold: threshold,
        alertType: "insurance", // Only tracking insurance for now
        branch: branchId && branchId !== "all" ? branchId : "All Branches",
      },
      summary: {
        totalVehicles,
        criticalAlerts,
        highPriorityAlerts,
        insuranceExpiring,
        permitExpiring: 0, // Not tracking permits yet
        expiredInsurance,
        expiredPermit: 0, // Not tracking permits yet
        alertDistribution,
      },
      branchBreakdown: Object.values(branchBreakdown),
      vehicles: processedVehicles,
    };

    // ========================================================================
    // Handle export if requested
    // ========================================================================

    if (exportFormat === "xlsx") {
      // TODO: Implement Excel export
      // const filename = `insurance-expiry-${new Date().toISOString().split('T')[0]}`;
      // return await exportInsurancePermitToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      // TODO: Implement CSV export
      // const filename = `insurance-expiry-${new Date().toISOString().split('T')[0]}`;
      // return exportInsurancePermitToCSV(res, reportData, filename);
    }

    // Return JSON response
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
