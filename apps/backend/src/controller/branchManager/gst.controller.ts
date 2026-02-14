import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { gstRuleSchema } from "@repo/schemas"



export const CreateOrUpdateGSTRule = async (req: Request, res: Response) => {
    try {
        const parsed = gstRuleSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Invalid request data",
                errors: parsed.error.flatten(),
            });
        }

        const { gstNumber, cgstRate, sgstRate, igstRate } = parsed.data;
        const branchId = req.branch_Id; // Assuming managerCheck middleware populates this

        if (!branchId) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Branch ID not found in request",
            });
        }

        const gstRule = await prisma.gSTRule.upsert({
            where: { branchId },
            update: {
                gstNumber,
                cgstRate,
                sgstRate,
                igstRate,
            },
            create: {
                publicId: crypto.randomUUID(),
                branchId,
                gstNumber,
                cgstRate,
                sgstRate,
                igstRate,
            },
        });

        return res.status(StatusCode.OK).json({
            message: "GST Rule saved successfully",
            data: gstRule,
        });
    } catch (error) {
        console.error("Error saving GST Rule:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal server error",
        });
    }
};

export const GetGSTRule = async (req: Request, res: Response) => {
    try {
        const branchId = req.branch_Id;

        if (!branchId) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Branch ID not found in request",
            });
        }

        const gstRule = await prisma.gSTRule.findUnique({
            where: { branchId },
        });

        if (!gstRule) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "GST Rule not found for this branch",
            });
        }

        return res.status(StatusCode.OK).json({
            message: "GST Rule fetched successfully",
            data: gstRule,
        });
    } catch (error) {
        console.error("Error fetching GST Rule:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal server error",
        });
    }
};
