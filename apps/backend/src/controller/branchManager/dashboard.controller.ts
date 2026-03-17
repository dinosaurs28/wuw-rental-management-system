import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  prisma,
  VehicleStatus,
  Role,
  DamageReportStatus,
} from "@repo/database/client";

export const GetDashboardStats = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;

  try {
    const [
      activeVehicles,
      inactiveVehicles,
      maintenanceVehicles,
      openDamageReports,
      staffCount,
    ] = await prisma.$transaction([
      // Active Vehicles: Available or Rented? Usually "Active" means operational.
      // The previous dashboard logic used "Active Bookings" for "Active".
      // The user request says: "Vehicle Count Active, Inactive and Maintaince".
      // So these refer to Vehicle Status.
      prisma.vehicle.count({
        where: { branchId, status: VehicleStatus.AVAILABLE, deletedAt: null },
      }),
      prisma.vehicle.count({
        where: { branchId, status: VehicleStatus.INACTIVE, deletedAt: null },
      }),
      prisma.vehicle.count({
        where: { branchId, status: VehicleStatus.MAINTENANCE, deletedAt: null },
      }),
      prisma.damageReport.count({
        where: {
          booking: { branchId },
          status: DamageReportStatus.PENDING,
        },
      }),
      prisma.user.count({
        where: { branchId, role: Role.STAFF, deletedAt: null },
      }),
    ]);

    return res.status(StatusCode.OK).json({
      data: {
        vehicles: {
          active: activeVehicles,
          available: activeVehicles,
          inactive: inactiveVehicles,
          maintenance: maintenanceVehicles,
        },
        damageReports: {
          open: openDamageReports,
        },
        staff: {
          total: staffCount,
        },
      },
    });
  } catch (error) {
    console.error("GetDashboardStats Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching dashboard stats",
    });
  }
};
