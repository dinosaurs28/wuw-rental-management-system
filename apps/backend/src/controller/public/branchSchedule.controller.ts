import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";

/**
 * GET /public/branch/:branchPublicId/schedule
 * No auth required. Returns schedule rows, graceMinutes, and is24Hours for
 * the requested branch so the frontend can validate booking times client-side.
 */
export const getBranchSchedule = async (req: Request, res: Response) => {
  try {
    const { branchPublicId } = req.params;

    const branch = await prisma.branch.findUnique({
      where: { publicId: branchPublicId },
      select: {
        graceMinutes: true,
        is24Hours: true,
        schedules: {
          select: {
            dayOfWeek: true,
            isOpen: true,
            openTime: true,
            closeTime: true,
          },
          orderBy: { dayOfWeek: "asc" },
        },
      },
    });

    if (!branch) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
    }

    return res.status(StatusCode.OK).json({
      schedules: branch.schedules,
      graceMinutes: branch.graceMinutes,
      is24Hours: branch.is24Hours,
    });
  } catch (error) {
    console.error("[getBranchSchedule] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
