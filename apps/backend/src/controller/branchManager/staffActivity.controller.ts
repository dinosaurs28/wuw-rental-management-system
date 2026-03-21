import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, StaffActionType, StaffEntityType } from "@repo/database/client";
import crypto from "crypto";
import { redis } from "../../lib/redisconfig.js";

export const GetBranchStaffActivity = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const {
    page = "1",
    limit = "20",
    startDate,
    endDate,
    actorPublicId,
    actionType,
    entityType,
  } = req.query;

  const pageNumber = parseInt(page as string) || 1;
  const limitNumber = parseInt(limit as string) || 20;
  const skip = (pageNumber - 1) * limitNumber;

  const queryHash = crypto
    .createHash("md5")
    .update(JSON.stringify(req.query))
    .digest("hex");
  const cacheKey = `staff-activity:branch:${branchId}:${queryHash}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.status(StatusCode.OK).json(JSON.parse(cached));
    }

    const where: any = { branchId };

    if (actorPublicId) {
      where.actorPublicId = actorPublicId as string;
    }

    if (
      actionType &&
      Object.values(StaffActionType).includes(actionType as StaffActionType)
    ) {
      where.actionType = actionType as StaffActionType;
    }

    if (
      entityType &&
      Object.values(StaffEntityType).includes(entityType as StaffEntityType)
    ) {
      where.entityType = entityType as StaffEntityType;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [logs, total] = await Promise.all([
      prisma.staffActivityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNumber,
      }),
      prisma.staffActivityLog.count({ where }),
    ]);

    const response = {
      data: logs,
      meta: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };

    await redis.set(cacheKey, JSON.stringify(response), "EX", 60);

    return res.status(StatusCode.OK).json(response);
  } catch (error) {
    console.error("GetBranchStaffActivity Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

export const GetBranchStaffActivityById = async (
  req: Request,
  res: Response,
) => {
  const branchId = req.branch_Id;
  const { publicId } = req.params;

  try {
    const log = await prisma.staffActivityLog.findUnique({
      where: { publicId },
    });

    if (!log) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Activity log not found" });
    }

    if (log.branchId !== branchId) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Access denied" });
    }

    return res.status(StatusCode.OK).json({ data: log });
  } catch (error) {
    console.error("GetBranchStaffActivityById Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};
