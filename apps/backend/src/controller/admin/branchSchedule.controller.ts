import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { validateScheduleRows, buildScheduleResponse } from "../../utils/booking/branchScheduleValidator.js";

/**
 * GET /admin/dashboard/branches/:branchPublicId/schedule
 * The branch's weekly office hours, grace and 24-hour flag (same shape as the
 * public schedule endpoint). Empty schedules = default hours (8 AM – 11 PM
 * every day, defaultHours: true); effectiveSchedules has the week filled in.
 */
export const getAdminBranchSchedule = async (req: Request, res: Response) => {
  try {
    const { branchPublicId } = req.params;
    const branch = await prisma.branch.findUnique({
      where: { publicId: branchPublicId },
      select: {
        graceMinutes: true,
        is24Hours: true,
        schedules: {
          select: { dayOfWeek: true, isOpen: true, openTime: true, closeTime: true },
          orderBy: { dayOfWeek: "asc" },
        },
      },
    });
    if (!branch) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
    }
    return res.status(StatusCode.OK).json(buildScheduleResponse(branch));
  } catch (error) {
    console.error("[getAdminBranchSchedule] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

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

    // An open day must close after it opens (no overnight hours)
    const invalid = validateScheduleRows(schedules);
    if (invalid) {
      return res.status(StatusCode.BAD_REQUEST).json({ success: false, code: "INVALID_SCHEDULE", message: invalid });
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
    if (is24Hours !== undefined && typeof is24Hours !== "boolean") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "is24Hours must be true or false" });
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
