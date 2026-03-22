import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createDurationSlabSchema, updateDurationSlabSchema } from "@repo/schemas";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";

export const GetDurationSlabs = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const slabs = await prisma.durationDiscountSlab.findMany({
      where: { branchId },
      orderBy: { minDays: "asc" },
    });
    return res.status(StatusCode.OK).json({ data: slabs });
  } catch (error) {
    console.error("GetDurationSlabs Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const CreateDurationSlab = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const validation = createDurationSlabSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }
    const { minDays, maxDays, discountType, value, label } = validation.data;

    // Check overlap with existing slabs
    const overlap = await prisma.durationDiscountSlab.findFirst({
      where: {
        branchId,
        OR: [
          // New slab's minDays falls inside an existing slab
          {
            minDays: { lte: minDays },
            OR: [{ maxDays: null }, { maxDays: { gte: minDays } }],
          },
          // New slab's maxDays falls inside an existing slab (if maxDays given)
          ...(maxDays
            ? [{
                minDays: { lte: maxDays },
                OR: [{ maxDays: null }, { maxDays: { gte: maxDays } }],
              }]
            : []),
        ],
      },
    });
    if (overlap) {
      return res.status(StatusCode.CONFLICT).json({ message: "Day range overlaps with an existing slab." });
    }

    const slab = await prisma.durationDiscountSlab.create({
      data: { branchId, minDays, maxDays: maxDays ?? null, discountType, value, label: label ?? null },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slab.id),
      description: `Duration discount slab created: ${minDays}–${maxDays ?? "∞"} days, ${value}${discountType === "PERCENTAGE" ? "%" : "₹"} off`,
      metadata: { minDays, maxDays, discountType, value },
    });

    return res.status(StatusCode.CREATED).json({ message: "Duration slab created", data: slab });
  } catch (error) {
    console.error("CreateDurationSlab Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const UpdateDurationSlab = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const slabId = parseInt(req.params.id!);
    if (isNaN(slabId)) return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid slab ID" });

    const existing = await prisma.durationDiscountSlab.findUnique({ where: { id: slabId } });
    if (!existing || existing.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Slab not found" });
    }

    const validation = updateDurationSlabSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }

    const updated = await prisma.durationDiscountSlab.update({
      where: { id: slabId },
      data: {
        ...(validation.data.minDays != null && { minDays: validation.data.minDays }),
        ...(validation.data.maxDays !== undefined && { maxDays: validation.data.maxDays ?? null }),
        ...(validation.data.discountType && { discountType: validation.data.discountType }),
        ...(validation.data.value != null && { value: validation.data.value }),
        ...(validation.data.label !== undefined && { label: validation.data.label ?? null }),
      },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slabId),
      description: `Duration discount slab ${slabId} updated`,
    });

    return res.status(StatusCode.OK).json({ message: "Duration slab updated", data: updated });
  } catch (error) {
    console.error("UpdateDurationSlab Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const DeleteDurationSlab = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const slabId = parseInt(req.params.id!);
    if (isNaN(slabId)) return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid slab ID" });

    const existing = await prisma.durationDiscountSlab.findUnique({ where: { id: slabId } });
    if (!existing || existing.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Slab not found" });
    }

    await prisma.durationDiscountSlab.delete({ where: { id: slabId } });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.DELETED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slabId),
      description: `Duration discount slab ${slabId} deleted`,
    });

    return res.status(StatusCode.OK).json({ message: "Duration slab deleted" });
  } catch (error) {
    console.error("DeleteDurationSlab Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
