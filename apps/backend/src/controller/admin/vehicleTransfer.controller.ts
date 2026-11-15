/**
 * Admin: move any vehicle to another branch, and a vehicle's transfer history
 * (Nov 14 2026). Rules + side effects: services/vehicle-transfer.
 *
 *   POST /api/admin/dashboard/vehicle-transfer/:vehiclePublicId   { toBranchId, reason, odometer? }
 *   GET  /api/admin/dashboard/vehicle-transfer/:vehiclePublicId/history
 */
import { Request, Response } from "express";
import { prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { VehicleTransferError, parseTransferBody } from "../../services/vehicle-transfer/vehicle-transfer-rules.js";
import { listVehicleTransfers, transferVehicle } from "../../services/vehicle-transfer/vehicle-transfer.service.js";

export const TransferVehicle = async (req: Request, res: Response) => {
  try {
    const body = parseTransferBody(req.body);
    if (body instanceof VehicleTransferError) return res.status(body.status).json(body.toJSON());

    const admin = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true },
    });
    const result = await transferVehicle(String(req.params.vehiclePublicId ?? ""), body, {
      role: Role.ADMIN,
      branchId: null,
      userId: admin?.id ?? null,
      name: admin?.name ?? "Admin",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return res.status(StatusCode.OK).json({ success: true, message: "Vehicle transferred successfully", data: result });
  } catch (error) {
    if (error instanceof VehicleTransferError) return res.status(error.status).json(error.toJSON());
    console.error("Admin TransferVehicle Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const GetVehicleTransfers = async (req: Request, res: Response) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: String(req.params.vehiclePublicId ?? "") },
      select: { id: true, branch: { select: { publicId: true, name: true } } },
    });
    if (!vehicle) return res.status(StatusCode.NOT_FOUND).json({ message: "Vehicle not found" });
    return res.status(StatusCode.OK).json({ data: await listVehicleTransfers(vehicle.id), currentBranch: vehicle.branch });
  } catch (error) {
    console.error("Admin GetVehicleTransfers Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
