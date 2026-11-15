/**
 * Branch manager: move a vehicle of the own branch to another branch, and the
 * vehicle's transfer history (Nov 14 2026). Rules + side effects:
 * services/vehicle-transfer.
 *
 *   POST /api/branchManager/dashboard/vehicle/:vehicleId/transfer   { toBranchId, reason, odometer? }
 *   GET  /api/branchManager/dashboard/vehicle/:vehicleId/transfers
 *
 * History: own branch's vehicles only (transfers carry branch names, reasons and
 * who moved the car — no customer data).
 */
import { Request, Response } from "express";
import { prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { VehicleTransferError, parseTransferBody } from "../../services/vehicle-transfer/vehicle-transfer-rules.js";
import { listVehicleTransfers, transferVehicle } from "../../services/vehicle-transfer/vehicle-transfer.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";

export const TransferBranchVehicle = async (req: Request, res: Response) => {
  try {
    const body = parseTransferBody(req.body);
    if (body instanceof VehicleTransferError) return res.status(body.status).json(body.toJSON());

    const manager = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true },
    });
    const vehicleId = String(req.params.vehicleId ?? "");
    const result = await transferVehicle(vehicleId, body, {
      role: Role.MANAGER,
      branchId: req.branch_Id,
      userId: manager?.id ?? null,
      name: manager?.name ?? "Branch manager",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.VEHICLE,
      entityRef: vehicleId,
      description: `Vehicle ${result.vehicle.regNo} transferred from ${result.transfer.fromBranchName} to ${result.transfer.toBranchName}`,
      metadata: { reason: body.reason, odometer: body.odometer },
    });

    return res.status(StatusCode.OK).json({ success: true, message: "Vehicle transferred successfully", data: result });
  } catch (error) {
    if (error instanceof VehicleTransferError) return res.status(error.status).json(error.toJSON());
    console.error("BM TransferVehicle Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const GetBranchVehicleTransfers = async (req: Request, res: Response) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: String(req.params.vehicleId ?? "") },
      select: { id: true, branchId: true, branch: { select: { publicId: true, name: true } } },
    });
    if (!vehicle || vehicle.branchId !== req.branch_Id) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Vehicle not found or access denied" });
    }
    return res.status(StatusCode.OK).json({ data: await listVehicleTransfers(vehicle.id), currentBranch: vehicle.branch });
  } catch (error) {
    console.error("BM GetVehicleTransfers Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
