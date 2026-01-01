import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, Role } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

export const GetStaffAuditLogs = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { page = 1, limit = 20, startDate, endDate, staffId } = req.query;

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const skip = (pageNumber - 1) * limitNumber;

    // Cache key
    const cacheKey = `audit_logs:${branchId}:${page}:${limit}:${startDate || 'all'}:${endDate || 'all'}:${staffId || 'all'}`;

    try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
            return res.status(StatusCode.OK).json(JSON.parse(cachedData));
        }

        // 1. Get all staff IDs for this branch
        const branchStaff = await prisma.user.findMany({
            where: {
                branchId: branchId,
                role: Role.STAFF
            },
            select: { id: true }
        });

        const staffIds = branchStaff.map(s => s.id);

        if (staffIds.length === 0) {
            return res.status(StatusCode.OK).json({
                message: "No staff found in branch",
                data: [],
                pagination: { total: 0, page: pageNumber, limit: limitNumber, totalPages: 0 }
            });
        }

        const whereCondition: any = {
            staffId: { in: staffIds }
        };

        if (staffId) {
            // If specific staff requested, ensure they are part of the branch
            const requestedId = parseInt(staffId as string);
            if (!staffIds.includes(requestedId)) {
                return res.status(StatusCode.FORBIDDEN).json({ message: "Staff not found in this branch" });
            }
            whereCondition.staffId = requestedId;
        }

        if (startDate && endDate) {
            whereCondition.createdAt = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string)
            };
        }

        const [logs, totalCount] = await Promise.all([
            prisma.staffActivityLog.findMany({
                where: whereCondition,
                skip,
                take: limitNumber,
                orderBy: {
                    createdAt: 'desc'
                }
            }),
            prisma.staffActivityLog.count({
                where: whereCondition
            })
        ]);

        const responseData = {
            message: "Audit logs fetched successfully",
            data: logs,
            pagination: {
                total: totalCount,
                page: pageNumber,
                limit: limitNumber,
                totalPages: Math.ceil(totalCount / limitNumber)
            }
        };

        // Cache for 1 minute
        await redis.setex(cacheKey, 60, JSON.stringify(responseData));

        return res.status(StatusCode.OK).json(responseData);

    } catch (error) {
        console.error("Get Staff Audit Logs Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching audit logs"
        });
    }
}
