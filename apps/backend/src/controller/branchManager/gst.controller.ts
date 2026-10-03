import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { gstRuleSchema } from "@repo/schemas";
import { redis } from "../../lib/redisconfig.js";
import { gstRuleKey, invalidateGroupListingCache } from "../../utils/cache/vehicleCacheKeys.js";
import { recomputeBranchRentWithoutGst } from "../../services/pricing/rent-columns.service.js";

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

    // Canonical GST rule (#23): rentals are intra-state supplies — CGST and
    // SGST are charged in equal halves and IGST is never added. IGST may be
    // recorded for reference only (0, or equal to CGST + SGST).
    if (cgstRate !== sgstRate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "GST_RATE_INVALID",
        message: "CGST and SGST must be equal (intra-state supply).",
      });
    }
    if (cgstRate + sgstRate <= 0 || cgstRate + sgstRate > 28) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "GST_RATE_INVALID",
        message: "CGST + SGST must be more than 0% and at most 28%.",
      });
    }
    if (igstRate && igstRate !== cgstRate + sgstRate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "GST_RATE_INVALID",
        message: "IGST is never charged on rentals; leave it 0 or set it equal to CGST + SGST for reference.",
      });
    }

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

    // Rents are GST-inclusive (item 17): the stored "rent without GST" of every
    // vehicle and pricing default of the branch follows the new rule
    const rentWithoutGstUpdated = await recomputeBranchRentWithoutGst(branchId, { cgstRate, sgstRate });

    // TASK-012c: Invalidate GST cache so next pricing call fetches the updated rate
    try {
      await redis.del(gstRuleKey(branchId));
      // Listings carry the GST inside each price
      await invalidateGroupListingCache(redis);
    } catch (err) {
      console.warn("[pricing-cache] Failed to invalidate GST cache (non-fatal):", err);
    }

    return res.status(StatusCode.OK).json({
      message: "GST Rule saved successfully",
      data: gstRule,
      // Rows whose rent without GST was recomputed (vehicles' custom pricing, branch defaults)
      rentWithoutGstUpdated,
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
