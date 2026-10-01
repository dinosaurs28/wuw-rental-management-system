import { Request, Response } from "express";
import { prisma, BookingRestrictionMode } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { validateScheduleRows } from "../../utils/booking/branchScheduleValidator.js";

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

/**
 * PATCH /branchManager/dashboard/branch/schedule
 * Body: { days: [{ dayOfWeek, isOpen, openTime, closeTime }] }
 * An open day must close after it opens (overnight hours aren't supported —
 * use 23:59, or the 24-hour switch on PATCH /branch/grace).
 */
export const upsertManagerBranchSchedule = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { days } = req.body as {
      days: { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string }[];
    };

    const invalid = validateScheduleRows(days);
    if (invalid) {
      return res.status(StatusCode.BAD_REQUEST).json({ success: false, code: "INVALID_SCHEDULE", message: invalid });
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
 * GET /branchManager/dashboard/branch/booking-restriction
 * Returns the current booking restriction mode for the manager's branch.
 */
export const getBookingRestrictionConfig = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { bookingRestrictionMode: true },
    });

    if (!branch) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
    }

    return res.status(StatusCode.OK).json({ bookingRestrictionMode: branch.bookingRestrictionMode });
  } catch (error) {
    console.error("[getBookingRestrictionConfig] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

const VALID_RESTRICTION_MODES = Object.values(BookingRestrictionMode);

/**
 * PATCH /branchManager/dashboard/branch/booking-restriction
 * Body: { bookingRestrictionMode: "NONE" | "SAME_CATEGORY" | "ANY_VEHICLE" }
 */
export const updateBookingRestrictionMode = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { bookingRestrictionMode } = req.body as { bookingRestrictionMode: BookingRestrictionMode };

    if (!VALID_RESTRICTION_MODES.includes(bookingRestrictionMode)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `bookingRestrictionMode must be one of: ${VALID_RESTRICTION_MODES.join(", ")}`,
      });
    }

    await prisma.branch.update({
      where: { id: branchId },
      data: { bookingRestrictionMode },
    });

    return res.status(StatusCode.OK).json({ message: "Booking restriction mode updated", bookingRestrictionMode });
  } catch (error) {
    console.error("[updateBookingRestrictionMode] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * PATCH /branchManager/dashboard/branch/grace
 * Body: { graceMinutes?: number (0-120), is24Hours?: boolean } — at least one.
 * is24Hours=true switches office-hours checks off for the branch (the weekly
 * rows are kept and apply again when it is switched back off).
 */
export const updateManagerBranchGrace = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { graceMinutes, is24Hours } = req.body as { graceMinutes?: unknown; is24Hours?: unknown };

    if (graceMinutes === undefined && is24Hours === undefined) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Send graceMinutes and/or is24Hours" });
    }
    if (
      graceMinutes !== undefined &&
      (typeof graceMinutes !== "number" || !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 120)
    ) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "graceMinutes must be 0–120" });
    }
    if (is24Hours !== undefined && typeof is24Hours !== "boolean") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "is24Hours must be true or false" });
    }

    const updated = await prisma.branch.update({
      where: { id: branchId },
      data: {
        ...(graceMinutes !== undefined ? { graceMinutes: graceMinutes as number } : {}),
        ...(is24Hours !== undefined ? { is24Hours: is24Hours as boolean } : {}),
      },
      select: { publicId: true, graceMinutes: true, is24Hours: true },
    });

    await redis.del(`branch:schedule:${updated.publicId}`);

    return res.status(StatusCode.OK).json({
      message: is24Hours !== undefined && graceMinutes === undefined ? "Opening hours mode updated" : "Grace period updated",
      graceMinutes: updated.graceMinutes,
      is24Hours: updated.is24Hours,
    });
  } catch (error) {
    console.error("[updateManagerBranchGrace] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
