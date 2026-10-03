import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { getPublicOffers } from "../../services/promo-banner/promo-banner.service.js";

/**
 * GET /api/public/offers?branch=<branchPublicId>
 * No auth. Live offer posters for the landing / home hero slider: with
 * `branch`, that branch's posters plus global ones; without it, every live
 * poster. An empty list means "show the default hero".
 */
export const GetPublicOffers = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.branch === "string" ? req.query.branch.trim() : "";
    let branch: { id: number; publicId: string } | null = null;
    if (raw) {
      branch = await prisma.branch.findFirst({
        where: { publicId: raw, deletedAt: null },
        select: { id: true, publicId: true },
      });
      if (!branch) {
        return res.status(StatusCode.NOT_FOUND).json({
          success: false,
          code: "BRANCH_NOT_FOUND",
          message: "Branch not found.",
        });
      }
    }

    const now = new Date();
    const data = await getPublicOffers(branch, now);
    return res.status(StatusCode.OK).json({ success: true, serverTime: now.toISOString(), data });
  } catch (error) {
    console.error("[GetPublicOffers] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't load offers.",
    });
  }
};
