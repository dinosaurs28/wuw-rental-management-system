import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, AuditCategory, AuditSeverity } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import crypto from "crypto";

export const GetBranchAuditLogs = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const {
    page = 1,
    limit = 20,
    startDate,
    endDate,
    staffId,
    customerId,
    category,
    action,
    severity,
    entityId,
  } = req.query;

  const pageNumber = parseInt(page as string);
  const limitNumber = parseInt(limit as string);
  const skip = (pageNumber - 1) * limitNumber;

  const queryHash = crypto
    .createHash("md5")
    .update(JSON.stringify(req.query))
    .digest("hex");
  const cacheKey = `audit:branch:${branchId}:${queryHash}`;

  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.status(StatusCode.OK).json(JSON.parse(cachedData));
    }

    const whereCondition: any = { actorBranchId: branchId };

    if (staffId) {
      whereCondition.actorId = parseInt(staffId as string);
    }

    if (customerId) {
      whereCondition.actorId = parseInt(customerId as string);
    }

    if (category && Object.values(AuditCategory).includes(category as AuditCategory)) {
      whereCondition.category = category;
    }

    if (severity && Object.values(AuditSeverity).includes(severity as AuditSeverity)) {
      whereCondition.severity = severity;
    }

    if (action) {
      whereCondition.action = action;
    }

    if (entityId) {
      whereCondition.entityId = entityId;
    }

    if (startDate && endDate) {
      whereCondition.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }

    const [logs, totalCount] = await Promise.all([
      prisma.auditLog.findMany({
        where: whereCondition,
        skip,
        take: limitNumber,
        orderBy: { createdAt: "desc" },
        select: {
          publicId: true,
          actorId: true,
          actorName: true,
          actorRole: true,
          approverId: true,
          approverName: true,
          approverRole: true,
          action: true,
          category: true,
          severity: true,
          description: true,
          entity: true,
          entityId: true,
          entityLabel: true,
          before: true,
          after: true,
          changedFields: true,
          metadata: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where: whereCondition }),
    ]);

    const responseData = {
      message: "Audit logs fetched successfully",
      data: logs,
      pagination: {
        total: totalCount,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(totalCount / limitNumber),
      },
    };

    await redis.setex(cacheKey, 60, JSON.stringify(responseData));

    return res.status(StatusCode.OK).json(responseData);
  } catch (error) {
    console.error("GetBranchAuditLogs Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching audit logs",
    });
  }
};

export const GetBranchAuditLogById = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const { publicId } = req.params;

  try {
    const log = await prisma.auditLog.findUnique({ where: { publicId } });

    if (!log) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Audit log not found" });
    }

    if (log.actorBranchId !== branchId) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Access denied" });
    }

    return res.status(StatusCode.OK).json({ data: log });
  } catch (error) {
    console.error("GetBranchAuditLogById Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

export const GetCustomerAuditLogs = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const { customerId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const pageNumber = parseInt(page as string);
  const limitNumber = parseInt(limit as string);
  const skip = (pageNumber - 1) * limitNumber;

  try {
    const whereCondition = {
      actorId: parseInt(customerId as string),
      actorBranchId: branchId,
    };

    const [logs, totalCount] = await Promise.all([
      prisma.auditLog.findMany({
        where: whereCondition,
        skip,
        take: limitNumber,
        orderBy: { createdAt: "desc" },
        select: {
          publicId: true,
          actorName: true,
          actorRole: true,
          action: true,
          category: true,
          severity: true,
          description: true,
          entity: true,
          entityId: true,
          entityLabel: true,
          metadata: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where: whereCondition }),
    ]);

    return res.status(StatusCode.OK).json({
      message: "Customer audit logs fetched successfully",
      data: logs,
      pagination: {
        total: totalCount,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(totalCount / limitNumber),
      },
    });
  } catch (error) {
    console.error("GetCustomerAuditLogs Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

// Backward-compat handler for old route
export const GetStaffAuditLogs = GetBranchAuditLogs;
