import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, AuditCategory, AuditSeverity } from "@repo/database/client";

export const GetAdminAuditLogs = async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 20,
    branchId,
    actorId,
    category,
    action,
    severity,
    startDate,
    endDate,
    entityId,
  } = req.query;

  const pageNumber = parseInt(page as string);
  const limitNumber = parseInt(limit as string);
  const skip = (pageNumber - 1) * limitNumber;

  try {
    const whereCondition: any = {};

    if (branchId) whereCondition.actorBranchId = parseInt(branchId as string);
    if (actorId) whereCondition.actorId = parseInt(actorId as string);
    if (category && Object.values(AuditCategory).includes(category as AuditCategory)) {
      whereCondition.category = category;
    }
    if (severity && Object.values(AuditSeverity).includes(severity as AuditSeverity)) {
      whereCondition.severity = severity;
    }
    if (action) whereCondition.action = action;
    if (entityId) whereCondition.entityId = entityId;
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
      }),
      prisma.auditLog.count({ where: whereCondition }),
    ]);

    return res.status(StatusCode.OK).json({
      message: "Audit logs fetched successfully",
      data: logs,
      pagination: {
        total: totalCount,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(totalCount / limitNumber),
      },
    });
  } catch (error) {
    console.error("GetAdminAuditLogs Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const GetAdminAuditStats = async (req: Request, res: Response) => {
  const { branchId, startDate, endDate } = req.query;

  try {
    const whereCondition: any = {};
    if (branchId) whereCondition.actorBranchId = parseInt(branchId as string);
    if (startDate && endDate) {
      whereCondition.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }

    const [byCategory, bySeverity, byAction] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ["category"],
        where: whereCondition,
        _count: { category: true },
      }),
      prisma.auditLog.groupBy({
        by: ["severity"],
        where: whereCondition,
        _count: { severity: true },
      }),
      prisma.auditLog.groupBy({
        by: ["action"],
        where: whereCondition,
        _count: { action: true },
        orderBy: { _count: { action: "desc" } },
        take: 10,
      }),
    ]);

    return res.status(StatusCode.OK).json({
      data: {
        byCategory: byCategory.map((r) => ({ category: r.category, count: r._count.category })),
        bySeverity: bySeverity.map((r) => ({ severity: r.severity, count: r._count.severity })),
        topActions: byAction.map((r) => ({ action: r.action, count: r._count.action })),
      },
    });
  } catch (error) {
    console.error("GetAdminAuditStats Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const GetAdminAuditLogById = async (req: Request, res: Response) => {
  const { publicId } = req.params;

  try {
    const log = await prisma.auditLog.findUnique({ where: { publicId } });
    if (!log) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Audit log not found" });
    }
    return res.status(StatusCode.OK).json({ data: log });
  } catch (error) {
    console.error("GetAdminAuditLogById Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
