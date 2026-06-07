import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";

/**
 * PATCH /admin/branch/:branchPublicId/schedule
 * PATCH /manager/branch/:branchPublicId/schedule
 *
 * Body: { schedules: [{ dayOfWeek: 0-6, isOpen: bool, openTime: "HH:mm", closeTime: "HH:mm" }] }
 * Upserts all 7 day rows. Partial updates (fewer than 7 days) are allowed.
 */
export const upsertBranchSchedule = async (req: Request, res: Response) => {
  try {
    const { branchPublicId } = req.params;
    const { schedules } = req.body as {
      schedules: { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string }[];
    };

    if (!Array.isArray(schedules) || schedules.length === 0) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "schedules array required" });
    }

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const s of schedules) {
      if (s.dayOfWeek < 0 || s.dayOfWeek > 6) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: `Invalid dayOfWeek: ${s.dayOfWeek}` });
      }
      if (!timeRe.test(s.openTime) || !timeRe.test(s.closeTime)) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: `Invalid time format for day ${s.dayOfWeek} — use HH:mm` });
      }
    }

    const branch = await prisma.branch.findUnique({
      where: { publicId: branchPublicId },
      select: { id: true },
    });
    if (!branch) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
    }

    await prisma.$transaction(
      schedules.map((s) =>
        prisma.branchSchedule.upsert({
          where: { branchId_dayOfWeek: { branchId: branch.id, dayOfWeek: s.dayOfWeek } },
          create: { branchId: branch.id, dayOfWeek: s.dayOfWeek, isOpen: s.isOpen, openTime: s.openTime, closeTime: s.closeTime },
          update: { isOpen: s.isOpen, openTime: s.openTime, closeTime: s.closeTime },
        }),
      ),
    );

    // Invalidate frontend query cache by busting the redis key if any caching wraps this
    await redis.del(`branch:schedule:${branchPublicId}`);

    return res.status(StatusCode.OK).json({ message: "Schedule updated" });
  } catch (error) {
    console.error("[upsertBranchSchedule] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * PATCH /admin/branch/:branchPublicId/grace
 *
 * Body: { graceMinutes: number (0-120), is24Hours?: boolean }
 */
export const updateBranchGrace = async (req: Request, res: Response) => {
  try {
    const { branchPublicId } = req.params;
    const { graceMinutes, is24Hours } = req.body as { graceMinutes?: number; is24Hours?: boolean };

    if (graceMinutes !== undefined && (typeof graceMinutes !== "number" || graceMinutes < 0 || graceMinutes > 120)) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "graceMinutes must be 0–120" });
    }

    const branch = await prisma.branch.findUnique({
      where: { publicId: branchPublicId },
      select: { id: true },
    });
    if (!branch) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
    }

    await prisma.branch.update({
      where: { id: branch.id },
      data: {
        ...(graceMinutes !== undefined ? { graceMinutes } : {}),
        ...(is24Hours !== undefined ? { is24Hours } : {}),
      },
    });

    await redis.del(`branch:schedule:${branchPublicId}`);

    return res.status(StatusCode.OK).json({ message: "Grace settings updated" });
  } catch (error) {
    console.error("[updateBranchGrace] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
