import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { pricingDiscountSlabSchema } from "@repo/schemas";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
// Schema for creation/update

export const GetDiscounts = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;

  try {
    const slabs = await prisma.pricingDiscountSlab.findMany({
      where: { branchId: branchId },
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ categoryId: "asc" }, { days: "asc" }],
    });

    return res.status(StatusCode.OK).json({
      data: slabs,
    });
  } catch (error) {
    console.error("GetDiscounts Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching discounts",
    });
  }
};

export const CreateDiscount = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;

  try {
    const validation = pricingDiscountSlabSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const { categoryId, days, multiplier } = validation.data;

    // Check for existing slab for same category + days in this branch
    const existing = await prisma.pricingDiscountSlab.findFirst({
      where: {
        branchId,
        categoryId,
        days,
      },
    });

    if (existing) {
      return res.status(StatusCode.CONFLICT).json({
        message: `A discount for ${days} days already exists for this category.`,
      });
    }

    const slab = await prisma.pricingDiscountSlab.create({
      data: {
        branchId,
        categoryId,
        days,
        multiplier,
      },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slab.id),
      description: `Pricing rule created for ${days} days`,
      metadata: { categoryId, days, multiplier },
    });

    return res.status(StatusCode.CREATED).json({
      message: "Discount slab created successfully",
      data: slab,
    });
  } catch (error) {
    console.error("CreateDiscount Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error creating discount",
    });
  }
};

export const UpdateDiscount = async (req: Request, res: Response) => {
  // @ts-ignore
  const branchId = req.branch_Id;
  const { id } = req.params;

  try {
    if (!id) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "ID is required" });
    }
    const slabId = parseInt(id);
    if (isNaN(slabId)) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid ID" });
    }

    const validation = pricingDiscountSlabSchema.partial().safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const { categoryId, days, multiplier } = validation.data;

    // Verify ownership
    const currentSlab = await prisma.pricingDiscountSlab.findUnique({
      where: { id: slabId },
    });

    if (!currentSlab || currentSlab.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Discount slab not found",
      });
    }

    // Validate uniqueness if changing days or category
    if (
      (days && days !== currentSlab.days) ||
      (categoryId && categoryId !== currentSlab.categoryId)
    ) {
      const checkCategory = categoryId || currentSlab.categoryId;
      const checkDays = days || currentSlab.days;

      // The only way checkCategory or checkDays can be null is if they were null in DB, but simple schema validation prevents that for now assuming strict mode?
      // Schema allows nulls in prisma? "categoryId Int?" -> Yes it's optional in prisma but my Zod requires it for creation.
      // For update, partial makes it optional.
      // However, `currentSlab` might have nulls if legacy data?
      // Assuming not for now.

      if (checkCategory && checkDays) {
        const existing = await prisma.pricingDiscountSlab.findFirst({
          where: {
            branchId,
            categoryId: checkCategory,
            days: checkDays,
            NOT: {
              id: slabId,
            },
          },
        });
        if (existing) {
          return res.status(StatusCode.CONFLICT).json({
            message: `A discount for ${checkDays} days already exists for this category.`,
          });
        }
      }
    }

    const updated = await prisma.pricingDiscountSlab.update({
      where: { id: slabId },
      data: {
        ...(categoryId && { categoryId }),
        ...(days && { days }),
        ...(multiplier !== undefined && { multiplier }),
      },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slabId),
      description: `Pricing rule ${slabId} updated`,
    });

    return res.status(StatusCode.OK).json({
      message: "Discount updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("UpdateDiscount Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error updating discount",
    });
  }
};

export const DeleteDiscount = async (req: Request, res: Response) => {
  // @ts-ignore
  const branchId = req.branch_Id;
  const { id } = req.params;

  try {
    if (!id) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "ID is required" });
    }
    const slabId = parseInt(id);
    // Verify ownership
    const currentSlab = await prisma.pricingDiscountSlab.findUnique({
      where: { id: slabId },
    });

    if (!currentSlab || currentSlab.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Discount slab not found",
      });
    }

    await prisma.pricingDiscountSlab.delete({
      where: { id: slabId },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.DELETED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slabId),
      description: `Pricing rule ${slabId} deleted`,
    });

    return res.status(StatusCode.OK).json({
      message: "Discount deleted successfully",
    });
  } catch (error) {
    console.error("DeleteDiscount Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error deleting discount",
    });
  }
};
