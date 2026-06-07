import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";

/**
 * GET /branchManager/dashboard/branch/schedule
 * Returns the schedule for the manager's own branch (branch resolved from JWT).
 */
export const getManagerBranchSchedule = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: {
        publicId: true,
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

    return res.status(StatusCode.OK).json({
      schedules: branch.schedules,
      graceMinutes: branch.graceMinutes,
      is24Hours: branch.is24Hours,
    });
  } catch (error) {
    console.error("[getManagerBranchSchedule] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * PATCH /branchManager/dashboard/branch/schedule
 * Body: { days: [{ dayOfWeek, isOpen, openTime, closeTime }] }
 */
export const upsertManagerBranchSchedule = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { days } = req.body as {
      days: { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string }[];
    };

    if (!Array.isArray(days) || days.length === 0) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "days array required" });
    }

    for (const s of days) {
      if (s.dayOfWeek < 0 || s.dayOfWeek > 6) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: `Invalid dayOfWeek: ${s.dayOfWeek}` });
      }
      if (!TIME_RE.test(s.openTime) || !TIME_RE.test(s.closeTime)) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: `Invalid time format for day ${s.dayOfWeek} — use HH:mm` });
      }
    }

    await prisma.$transaction(
      days.map((s) =>
        prisma.branchSchedule.upsert({
          where: { branchId_dayOfWeek: { branchId, dayOfWeek: s.dayOfWeek } },
          create: { branchId, dayOfWeek: s.dayOfWeek, isOpen: s.isOpen, openTime: s.openTime, closeTime: s.closeTime },
          update: { isOpen: s.isOpen, openTime: s.openTime, closeTime: s.closeTime },
        }),
      ),
    );

    // Bust public schedule cache for this branch
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { publicId: true } });
    if (branch) await redis.del(`branch:schedule:${branch.publicId}`);

    return res.status(StatusCode.OK).json({ message: "Schedule updated" });
  } catch (error) {
    console.error("[upsertManagerBranchSchedule] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * PATCH /branchManager/dashboard/branch/grace
 * Body: { graceMinutes: number (0-120) }
 */
export const updateManagerBranchGrace = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { graceMinutes } = req.body as { graceMinutes: number };

    if (typeof graceMinutes !== "number" || graceMinutes < 0 || graceMinutes > 120) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "graceMinutes must be 0–120" });
    }

    await prisma.branch.update({ where: { id: branchId }, data: { graceMinutes } });

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { publicId: true } });
    if (branch) await redis.del(`branch:schedule:${branch.publicId}`);

    return res.status(StatusCode.OK).json({ message: "Grace period updated" });
  } catch (error) {
    console.error("[updateManagerBranchGrace] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
