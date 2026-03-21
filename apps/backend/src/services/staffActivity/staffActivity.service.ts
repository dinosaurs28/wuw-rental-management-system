import { Request } from "express";
import { prisma, StaffActionType, StaffEntityType } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import type { CreateStaffActivityInput } from "./staffActivity.types.js";

export { StaffActionType, StaffEntityType };

type PrismaTx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

class StaffActivityService {
  async log(input: CreateStaffActivityInput, tx?: PrismaTx): Promise<void> {
    const db = tx ?? prisma;
    await db.staffActivityLog.create({
      data: {
        publicId: createID(),
        actorPublicId: input.actorPublicId,
        actorName: input.actorName,
        actorRole: input.actorRole,
        branchId: input.branchId,
        branchName: input.branchName,
        actionType: input.actionType,
        entityType: input.entityType,
        entityRef: input.entityRef,
        description: input.description,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async logFromRequest(
    req: Request,
    input: Omit<CreateStaffActivityInput, "actorPublicId" | "actorName" | "actorRole" | "branchId" | "branchName">,
    tx?: PrismaTx,
  ): Promise<void> {
    try {
      const actor = await prisma.user.findUnique({
        where: { publicId: req.public_Id },
        select: {
          name: true,
          role: true,
          branch: { select: { name: true } },
        },
      });

      if (!actor) return;

      await this.log(
        {
          actorPublicId: req.public_Id,
          actorName: actor.name,
          actorRole: actor.role,
          branchId: req.branch_Id,
          branchName: actor.branch?.name ?? "Unknown Branch",
          ...input,
        },
        tx,
      );
    } catch (err) {
      console.error("[StaffActivityService] logFromRequest failed:", err);
    }
  }
}

export const staffActivityService = new StaffActivityService();
