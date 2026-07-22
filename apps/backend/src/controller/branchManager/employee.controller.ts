import { Request, Response } from "express";
import { prisma, Role, User } from "@repo/database/client";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { StatusCode } from "../../types/statusCode.js";
import { createEmployeeSchema, updateEmployeeSchema } from "@repo/schemas";
import { hashSync } from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { createID } from "../../utils/nanoID.js";
import { hashpassword } from "../../utils/PasswordCrypt/password.js";
import { redis } from "../../lib/redisconfig.js";

const setStatusSchema = z.object({
    isActive: z.boolean(),
});

export const SearchEmployee = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { search, page = "1", limit = "10" } = req.query;

    const pageNumber = parseInt(page as string) || 1;
    const pageSize = parseInt(limit as string) || 10;
    const skip = (pageNumber - 1) * pageSize;

    const whereClause: any = {
        branchId: branchId,
        role: Role.STAFF,
    };

    if (search) {
        const searchTerm = search as string;
        whereClause.OR = [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } },
            { phone: { contains: searchTerm, mode: 'insensitive' } }
        ];
    }

    try {
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                select: {
                    id: false,
                    publicId: true,
                    name: true,
                    email: true,
                    phone: true,
                    role: true,
                    isActive: true,
                    createdAt: true
                },
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.user.count({ where: whereClause })
        ]);

        return res.status(StatusCode.OK).json({
            data: users,
            meta: {
                total,
                page: pageNumber,
                limit: pageSize,
                totalPages: Math.ceil(total / pageSize)
            }
        });

    } catch (error) {
        console.error("SearchEmployee Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}

export const GetEmployee = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { employeeId } = req.params;

    try {
        const user = await prisma.user.findFirst({
            where: {
                publicId: employeeId,
                branchId: branchId,
                role: Role.STAFF,
                deletedAt: null
            },
            select: {
                id: false,
                publicId: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                isActive: true,
                createdAt: true,
                updatedAt: true
            }
        });

        if (!user) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Employee not found" });
        }

        return res.status(StatusCode.OK).json({ data: user });

    } catch (error) {
        console.error("GetEmployee Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}

export const CreateEmployee = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const validation = createEmployeeSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "Invalid Inputs",
            error: validation.error
        });
    }

    const { name, email: rawEmail, phone, password } = validation.data;

    try {
        const email = rawEmail.toLowerCase().trim();

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: email },
                    { phone: phone } // Try to keep phone unique generally
                ]
            }
        });

        if (existingUser) {
            return res.status(StatusCode.CONFLICT).json({ message: "Employee with this email or phone already exists" });
        }

        const passwordHash = await hashpassword(password);
        const publicId = createID();

        const newUser = await prisma.user.create({
            data: {
                publicId,
                name,
                email,
                phone,
                passwordHash,
                role: Role.STAFF,
                branchId: branchId,
                authProvider: 'PASSWORD',
                emailVerifiedAt: new Date() // Auto verify as requested
            },
            select: {
                publicId: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                createdAt: true
            }
        });

        staffActivityService.logFromRequest(req, {
            actionType: StaffActionType.CREATED,
            entityType: StaffEntityType.EMPLOYEE,
            entityRef: newUser.publicId,
            description: `Employee account created for ${newUser.name}`,
        });

        const manager = await prisma.user.findUnique({
            where: { publicId: req.public_Id },
            select: { id: true, name: true, role: true },
        });
        auditService.log({
            actorId: manager?.id,
            actorName: manager?.name ?? "Unknown",
            actorRole: manager?.role ?? Role.MANAGER,
            actorBranchId: branchId,
            action: "EMPLOYEE_CREATED",
            category: AuditCategory.EMPLOYEE,
            description: `Employee account created for ${newUser.name} (${newUser.email})`,
            entity: "User",
            entityId: newUser.publicId,
            entityLabel: newUser.name,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
            after: { name: newUser.name, email: newUser.email, role: newUser.role },
        });

        return res.status(StatusCode.CREATED).json({
            message: "Employee created successfully",
            data: newUser,
            generatedPassword: password
        });

    } catch (error) {
        console.error("CreateEmployee Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}

export const UpdateEmployee = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { employeeId } = req.params;

    const validation = updateEmployeeSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "Invalid Inputs",
            error: validation.error
        });
    }

    const { name, phone } = validation.data;
    const email = validation.data.email.toLowerCase().trim();

    try {
        const user = await prisma.user.findFirst({
            where: {
                publicId: employeeId,
                branchId: branchId,
                role: Role.STAFF,
                deletedAt: null
            }
        });

        if (!user) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Employee not found" });
        }

        // Check if phone or email is being changed and if it conflicts
        if (phone !== user.phone || email !== user.email) {
            const existingUser = await prisma.user.findFirst({
                where: {
                    OR: [{ phone }, { email }],
                    id: { not: user.id }
                }
            });
            if (existingUser) {
                return res.status(StatusCode.CONFLICT).json({ message: "Phone number or email already in use" });
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                name,
                email,
                phone
            },
            select: {
                publicId: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                updatedAt: true
            }
        });

        staffActivityService.logFromRequest(req, {
            actionType: StaffActionType.UPDATED,
            entityType: StaffEntityType.EMPLOYEE,
            entityRef: updatedUser.publicId,
            description: `Employee ${updatedUser.name} updated`,
        });

        return res.status(StatusCode.OK).json({
            message: "Employee updated successfully",
            data: updatedUser
        });

    } catch (error) {
        console.error("UpdateEmployee Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}

export const SetEmployeeStatus = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { employeeId } = req.params;

    const validation = setStatusSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "Invalid Inputs",
            error: validation.error
        });
    }

    const { isActive } = validation.data;

    try {
        const user = await prisma.user.findFirst({
            where: {
                publicId: employeeId,
                branchId: branchId,
                role: Role.STAFF
            }
        });

        if (!user) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Employee not found" });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { isActive }
        });

        await redis.del("admin:user_transfer_stats");

        const manager = await prisma.user.findUnique({
            where: { publicId: req.public_Id },
            select: { id: true, name: true, role: true },
        });

        staffActivityService.logFromRequest(req, {
            actionType: isActive ? StaffActionType.ACTIVATED : StaffActionType.DEACTIVATED,
            entityType: StaffEntityType.EMPLOYEE,
            entityRef: user.publicId,
            description: `Employee ${user.name} ${isActive ? "activated" : "deactivated"}`,
        });

        auditService.log({
            actorId: manager?.id,
            actorName: manager?.name ?? "Unknown",
            actorRole: manager?.role ?? Role.MANAGER,
            actorBranchId: branchId,
            action: isActive ? "EMPLOYEE_ACTIVATED" : "EMPLOYEE_DEACTIVATED",
            category: AuditCategory.EMPLOYEE,
            description: `Employee ${user.name} ${isActive ? "activated" : "deactivated"}`,
            entity: "User",
            entityId: user.publicId,
            entityLabel: user.name,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
            before: { isActive: user.isActive },
            after: { isActive },
        });

        return res.status(StatusCode.OK).json({
            message: `Employee ${isActive ? "activated" : "deactivated"} successfully`
        });

    } catch (error) {
        console.error("SetEmployeeStatus Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}
