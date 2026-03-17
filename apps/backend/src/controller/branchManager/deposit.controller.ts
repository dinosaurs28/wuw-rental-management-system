import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import {
  createDepositRuleSchema,
  updateDepositRuleSchema,
} from "@repo/schemas";

export const GetDepositRules = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  try {
    const rules = await prisma.categoryDepositSetting.findMany({
      where: { branchId },
      include: {
        category: true,
      },
    });
    return res.status(StatusCode.OK).json({
      message: "Deposit rules fetched successfully",
      data: rules,
    });
  } catch (error) {
    console.error("Get Deposit Rules Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

export const CreateDepositRule = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  try {
    const validation = createDepositRuleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid data",
        errors: validation.error.format(),
      });
    }

    const { categoryId, amount } = validation.data;

    // Check if rule already exists for this category in this branch
    const existingRule = await prisma.categoryDepositSetting.findUnique({
      where: {
        branchId_categoryId: {
          branchId,
          categoryId,
        },
      },
    });

    if (existingRule) {
      return res.status(StatusCode.CONFLICT).json({
        message:
          "A deposit rule already exists for this category. Please edit the existing rule.",
      });
    }

    const newRule = await prisma.categoryDepositSetting.create({
      data: {
        branchId,
        categoryId,
        amount,
      },
      include: {
        category: true,
      },
    });

    return res.status(StatusCode.CREATED).json({
      message: "Deposit rule created successfully",
      data: newRule,
    });
  } catch (error) {
    console.error("Create Deposit Rule Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

export const UpdateDepositRule = async (req: Request, res: Response) => {
  const { id } = req.params;
  const branchId = req.branch_Id;

  try {
    const validation = updateDepositRuleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid data",
        errors: validation.error.format(),
      });
    }
    const { amount } = validation.data;

    // Verify ownership
    const existingRule = await prisma.categoryDepositSetting.findUnique({
      where: { id: Number(id) },
    });

    if (!existingRule || existingRule.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Rule not found or access denied",
      });
    }

    const updatedRule = await prisma.categoryDepositSetting.update({
      where: { id: Number(id) },
      data: { amount },
      include: { category: true },
    });

    return res.status(StatusCode.OK).json({
      message: "Deposit rule updated successfully",
      data: updatedRule,
    });
  } catch (error) {
    console.error("Update Deposit Rule Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

export const DeleteDepositRule = async (req: Request, res: Response) => {
  const { id } = req.params;
  const branchId = req.branch_Id;

  try {
    const existingRule = await prisma.categoryDepositSetting.findUnique({
      where: { id: Number(id) },
    });

    if (!existingRule || existingRule.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Rule not found or access denied",
      });
    }

    await prisma.categoryDepositSetting.delete({
      where: { id: Number(id) },
    });

    return res.status(StatusCode.OK).json({
      message: "Deposit rule deleted successfully",
    });
  } catch (error) {
    console.error("Delete Deposit Rule Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
