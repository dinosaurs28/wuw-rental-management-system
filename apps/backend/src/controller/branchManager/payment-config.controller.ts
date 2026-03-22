import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { updateBranchPaymentConfigSchema } from "@repo/schemas";
import { branchPaymentConfigService } from "../../services/payment/index.js";

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branch: { select: { name: true } } },
  });
  if (!user) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: req.branch_Id,
    actorPublicId: req.public_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

export const GetMyBranchPaymentConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await branchPaymentConfigService.getConfig(req.branch_Id);
    res.status(StatusCode.OK).json({ data: config });
  } catch (error) {
    console.error("GetMyBranchPaymentConfig Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const UpdateMyBranchPaymentConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = updateBranchPaymentConfigSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const config = await branchPaymentConfigService.upsertConfig(req.branch_Id, validation.data, actor);
    res.status(StatusCode.OK).json({ message: "Payment config updated", data: config });
  } catch (error) {
    console.error("UpdateMyBranchPaymentConfig Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
