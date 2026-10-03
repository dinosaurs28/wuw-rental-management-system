import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { hashpassword } from "../../utils/PasswordCrypt/password.js";
import { Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { z } from "zod";
import { indianMobileLookupVariants, normalizeIndianMobile } from "../../utils/phone.js";

// Emails are stored lowercased: sign-in and password reset look them up that way.
const createManagerSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().trim().toLowerCase().email("Invalid email"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

const updateManagerSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    password: z.string().min(6).optional(),
});

const setStatusSchema = z.object({
    isActive: z.boolean(),
});

// Optional manager mobile number (password reset by SMS goes to it). Omitted
// → leave as is; "" / null → clear; otherwise any common spelling, stored as
// the bare 10 digits.
export function parseOptionalManagerPhone(
    raw: unknown,
): { ok: true; phone: string | undefined } | { ok: false } {
    if (raw === undefined) return { ok: true, phone: undefined };
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) return { ok: true, phone: "" };
    const phone = normalizeIndianMobile(typeof raw === "string" ? raw : undefined);
    return phone ? { ok: true, phone } : { ok: false };
}

const INVALID_MANAGER_PHONE = {
    success: false,
    code: "INVALID_PHONE",
    message: "Enter a valid 10-digit mobile number for the branch manager.",
};

// SMS reset finds a manager by phone; a number on two manager accounts would
// match neither, so it is refused here.
export async function managerPhoneTaken(phone: string, exceptUserId?: number): Promise<boolean> {
    const other = await prisma.user.findFirst({
        where: {
            role: Role.MANAGER,
            deletedAt: null,
            phone: { in: indianMobileLookupVariants(phone) },
            ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
        },
        select: { id: true },
    });
    return !!other;
}

const MANAGER_PHONE_IN_USE = {
    success: false,
    code: "PHONE_IN_USE",
    message: "This mobile number is already on another branch manager account.",
};

export const GetBranchManagers = async (req: Request, res: Response) => {
    try {
        const { branchId } = req.params;

        const branch = await prisma.branch.findUnique({
            where: { publicId: branchId, deletedAt: null },
        });

        if (!branch) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
        }

        const managers = await prisma.user.findMany({
            where: {
                branchId: branch.id,
                role: Role.MANAGER,
                deletedAt: null,
            },
            select: {
                publicId: true,
                name: true,
                email: true,
                phone: true,
                isActive: true,
                createdAt: true,
            },
            orderBy: { createdAt: "asc" },
        });

        return res.status(StatusCode.OK).json({
            message: "Branch managers fetched successfully",
            data: managers,
        });
    } catch (error) {
        console.error("Get Branch Managers Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};

export const CreateBranchManager = async (req: Request, res: Response) => {
    try {
        const { branchId } = req.params;
        const validation = createManagerSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid Inputs", error: validation.error });
        }

        const data = validation.data;
        const phoneInput = parseOptionalManagerPhone(req.body?.phone);
        if (!phoneInput.ok) {
            return res.status(StatusCode.BAD_REQUEST).json(INVALID_MANAGER_PHONE);
        }

        const branch = await prisma.branch.findUnique({
            where: { publicId: branchId, deletedAt: null },
        });

        if (!branch) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
        }

        const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
        if (existingUser) {
            return res.status(StatusCode.CONFLICT).json({ message: "A user with this email already exists." });
        }
        if (phoneInput.phone && (await managerPhoneTaken(phoneInput.phone))) {
            return res.status(StatusCode.CONFLICT).json(MANAGER_PHONE_IN_USE);
        }

        const passwordHash = await hashpassword(data.password);

        const manager = await prisma.user.create({
            data: {
                name: data.name,
                email: data.email,
                passwordHash,
                role: Role.MANAGER,
                branchId: branch.id,
                publicId: createID(),
                authProvider: "PASSWORD",
                ...(phoneInput.phone ? { phone: phoneInput.phone } : {}),
            },
            select: {
                publicId: true,
                name: true,
                email: true,
                phone: true,
                createdAt: true,
            },
        });

        await redis.del("admin:all_branches");
        await redis.del("branches");

        return res.status(StatusCode.CREATED).json({
            message: "Branch manager created successfully",
            data: manager,
        });
    } catch (error) {
        console.error("Create Branch Manager Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};

export const UpdateBranchManager = async (req: Request, res: Response) => {
    try {
        const { branchId, managerId } = req.params;
        const validation = updateManagerSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid Inputs", error: validation.error });
        }

        const data = validation.data;
        const phoneInput = parseOptionalManagerPhone(req.body?.phone);
        if (!phoneInput.ok) {
            return res.status(StatusCode.BAD_REQUEST).json(INVALID_MANAGER_PHONE);
        }

        const branch = await prisma.branch.findUnique({ where: { publicId: branchId, deletedAt: null } });
        if (!branch) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
        }

        const manager = await prisma.user.findUnique({ where: { publicId: managerId } });

        if (!manager || manager.branchId !== branch.id || manager.role !== Role.MANAGER || manager.deletedAt) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Manager not found in this branch" });
        }
        if (phoneInput.phone && (await managerPhoneTaken(phoneInput.phone, manager.id))) {
            return res.status(StatusCode.CONFLICT).json(MANAGER_PHONE_IN_USE);
        }

        const updateData: Record<string, any> = {};
        if (data.name) updateData.name = data.name;
        if (data.email) updateData.email = data.email;
        if (data.password) updateData.passwordHash = await hashpassword(data.password);
        if (phoneInput.phone !== undefined) updateData.phone = phoneInput.phone;

        const updated = await prisma.user.update({
            where: { id: manager.id },
            data: updateData,
            select: { publicId: true, name: true, email: true, phone: true },
        });

        await redis.del("admin:all_branches");
        await redis.del("branches");

        return res.status(StatusCode.OK).json({ message: "Branch manager updated successfully", data: updated });
    } catch (error) {
        console.error("Update Branch Manager Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};

export const SetBranchManagerStatus = async (req: Request, res: Response) => {
    try {
        const { branchId, managerId } = req.params;
        const validation = setStatusSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid Inputs", error: validation.error });
        }

        const { isActive } = validation.data;

        const branch = await prisma.branch.findUnique({ where: { publicId: branchId, deletedAt: null } });
        if (!branch) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
        }

        const manager = await prisma.user.findUnique({ where: { publicId: managerId } });
        if (!manager || manager.branchId !== branch.id || manager.role !== Role.MANAGER || manager.deletedAt) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Manager not found in this branch" });
        }

        await prisma.user.update({
            where: { id: manager.id },
            data: { isActive },
        });

        await redis.del("admin:all_branches");
        await redis.del("branches");
        await redis.del("admin:user_transfer_stats");

        const admin = await prisma.user.findUnique({
            where: { publicId: req.public_Id },
            select: { id: true, name: true, role: true },
        });

        auditService.log({
            actorId: admin?.id,
            actorName: admin?.name ?? "Unknown",
            actorRole: admin?.role ?? Role.ADMIN,
            action: isActive ? "MANAGER_ACTIVATED" : "MANAGER_DEACTIVATED",
            category: AuditCategory.BRANCH,
            description: `Branch manager ${manager.name} ${isActive ? "activated" : "deactivated"}`,
            entity: "User",
            entityId: manager.publicId,
            entityLabel: manager.name,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
            before: { isActive: manager.isActive },
            after: { isActive },
        });

        return res.status(StatusCode.OK).json({
            message: `Branch manager ${isActive ? "activated" : "deactivated"} successfully`,
        });
    } catch (error) {
        console.error("Set Branch Manager Status Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};
