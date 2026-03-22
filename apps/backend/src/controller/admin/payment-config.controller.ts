import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { updateBranchPaymentConfigAdminSchema } from "@repo/schemas";
import { branchPaymentConfigService } from "../../services/payment/index.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true, branch: { select: { name: true } } },
  });
  if (!user) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: user.branchId ?? undefined,
    actorPublicId: req.public_Id,
    branchName: user.branch?.name ?? "HQ",
  };
};

export const GetBranchPaymentConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const branchId = parseInt(req.params.branchId!);
    if (isNaN(branchId)) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid branch ID" });
      return;
    }
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
      return;
    }
    const config = await branchPaymentConfigService.getConfig(branchId);
    res.status(StatusCode.OK).json({ data: config });
  } catch (error) {
    console.error("GetBranchPaymentConfig Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const AdminUpdateBranchPaymentConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const branchId = parseInt(req.params.branchId!);
    if (isNaN(branchId)) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid branch ID" });
      return;
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } });
    if (!branch) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
      return;
    }

    const validation = updateBranchPaymentConfigAdminSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }

    const actor = await buildActorContext(req);
    const config = await branchPaymentConfigService.upsertConfig(branchId, validation.data, {
      ...actor,
      actorBranchId: actor.actorBranchId,
      branchName: actor.branchName,
    });

    res.status(StatusCode.OK).json({ message: "Payment config updated", data: config });
  } catch (error) {
    console.error("AdminUpdateBranchPaymentConfig Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
