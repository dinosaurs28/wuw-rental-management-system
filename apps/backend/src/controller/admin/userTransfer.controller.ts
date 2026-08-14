import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, Role, CashShiftStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { z } from "zod";

const STATS_CACHE_KEY = "admin:user_transfer_stats";

const transferUserSchema = z.object({
    toBranchId: z.string().min(1, "Target branch is required"),
    reason: z.string().optional(),
});

type RoleCounts = { active: number; inactive: number; total: number };

const emptyRoleCounts = (): RoleCounts => ({ active: 0, inactive: 0, total: 0 });

export const GetBranchStaffingStats = async (req: Request, res: Response) => {
    try {
        const cachedData = await redis.get(STATS_CACHE_KEY);
        if (cachedData) {
            return res.status(StatusCode.OK).json(JSON.parse(cachedData));
        }

        const branches = await prisma.branch.findMany({
            where: { deletedAt: null },
            select: { id: true, publicId: true, name: true },
            orderBy: { name: "asc" },
        });

        const grouped = await prisma.user.groupBy({
            by: ["branchId", "role", "isActive"],
            where: {
                role: { in: [Role.MANAGER, Role.STAFF] },
                branchId: { not: null },
            },
            _count: { _all: true },
        });

        const statsByBranch = new Map<number, { managers: RoleCounts; employees: RoleCounts }>();
        for (const branch of branches) {
            statsByBranch.set(branch.id, { managers: emptyRoleCounts(), employees: emptyRoleCounts() });
        }

        const totals = { managers: emptyRoleCounts(), employees: emptyRoleCounts() };

        for (const row of grouped) {
            if (row.branchId === null) continue;
            const entry = statsByBranch.get(row.branchId);
            if (!entry) continue;

            const bucket = row.role === Role.MANAGER ? entry.managers : entry.employees;
            const totalsBucket = row.role === Role.MANAGER ? totals.managers : totals.employees;
            const count = row._count._all;

            if (row.isActive) {
                bucket.active += count;
                totalsBucket.active += count;
            } else {
                bucket.inactive += count;
                totalsBucket.inactive += count;
            }
            bucket.total += count;
            totalsBucket.total += count;
        }

        const data = branches.map((branch) => ({
            branchId: branch.publicId,
            branchName: branch.name,
            ...statsByBranch.get(branch.id)!,
        }));

        const responseData = { data, totals };

        await redis.set(STATS_CACHE_KEY, JSON.stringify(responseData), "EX", 60);

        return res.status(StatusCode.OK).json(responseData);
    } catch (error) {
        console.error("GetBranchStaffingStats Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};

export const GetBranchUsers = async (req: Request, res: Response) => {
    try {
        const { branchId, role, search, page = "1", limit = "10" } = req.query;

        const pageNumber = parseInt(page as string) || 1;
        const pageSize = parseInt(limit as string) || 10;
        const skip = (pageNumber - 1) * pageSize;

        const whereClause: any = {
            role: { in: [Role.MANAGER, Role.STAFF] },
        };

        if (role === Role.MANAGER || role === Role.STAFF) {
            whereClause.role = role;
        }

        if (branchId) {
            const branch = await prisma.branch.findUnique({
                where: { publicId: branchId as string, deletedAt: null },
                select: { id: true },
            });
            if (!branch) {
                return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
            }
            whereClause.branchId = branch.id;
        }

        if (search) {
            const searchTerm = search as string;
            whereClause.OR = [
                { name: { contains: searchTerm, mode: "insensitive" } },
                { email: { contains: searchTerm, mode: "insensitive" } },
                { phone: { contains: searchTerm, mode: "insensitive" } },
            ];
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                select: {
                    publicId: true,
                    name: true,
                    email: true,
                    phone: true,
                    role: true,
                    isActive: true,
                    createdAt: true,
                    branch: { select: { publicId: true, name: true } },
                },
                skip,
                take: pageSize,
                orderBy: { createdAt: "desc" },
            }),
            prisma.user.count({ where: whereClause }),
        ]);

        const data = users.map((user) => ({
            publicId: user.publicId,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            branchId: user.branch?.publicId ?? null,
            branchName: user.branch?.name ?? null,
        }));

        return res.status(StatusCode.OK).json({
            data,
            meta: {
                total,
                page: pageNumber,
                limit: pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (error) {
        console.error("GetBranchUsers Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};

export const TransferUser = async (req: Request, res: Response) => {
    try {
        const { userPublicId } = req.params;
        const validation = transferUserSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid Inputs", error: validation.error });
        }

        const { toBranchId, reason } = validation.data;

        const user = await prisma.user.findFirst({
            where: {
                publicId: userPublicId,
                role: { in: [Role.MANAGER, Role.STAFF] },
            },
            include: { branch: { select: { id: true, publicId: true, name: true } } },
        });

        if (!user) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "User not found" });
        }

        const targetBranch = await prisma.branch.findUnique({
            where: { publicId: toBranchId, deletedAt: null },
        });

        if (!targetBranch) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Target branch not found" });
        }

        if (targetBranch.id === user.branchId) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "User already belongs to this branch" });
        }

        const openShift = await prisma.cashShift.findFirst({
            where: { employeeId: user.id, status: CashShiftStatus.OPEN },
        });

        if (openShift) {
            return res.status(StatusCode.CONFLICT).json({
                message: "Cannot transfer: this user has an open cash shift. Close/reconcile it before transferring.",
            });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { branchId: targetBranch.id },
        });

        await redis.del("admin:all_branches");
        await redis.del("branches");
        await redis.del(STATS_CACHE_KEY);

        const admin = await prisma.user.findUnique({
            where: { publicId: req.public_Id },
            select: { id: true, name: true, role: true },
        });

        auditService.log({
            actorId: admin?.id,
            actorName: admin?.name ?? "Unknown",
            actorRole: admin?.role ?? Role.ADMIN,
            action: "USER_BRANCH_TRANSFER",
            category: user.role === Role.MANAGER ? AuditCategory.BRANCH : AuditCategory.EMPLOYEE,
            description: `${user.name} transferred from ${user.branch?.name ?? "Unassigned"} to ${targetBranch.name}${reason ? ` — ${reason}` : ""}`,
            entity: "User",
            entityId: user.publicId,
            entityLabel: user.name,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
            before: { branchId: user.branch?.publicId ?? null, branchName: user.branch?.name ?? null },
            after: { branchId: targetBranch.publicId, branchName: targetBranch.name },
            metadata: reason ? { reason } : undefined,
        });

        return res.status(StatusCode.OK).json({ message: "User transferred successfully" });
    } catch (error) {
        console.error("TransferUser Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};
