import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { hashpassword } from "../../utils/PasswordCrypt/password.js";
import { Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { z } from "zod";

const createManagerSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

const updateManagerSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
});

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
            },
            select: {
                publicId: true,
                name: true,
                email: true,
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

        const branch = await prisma.branch.findUnique({ where: { publicId: branchId, deletedAt: null } });
        if (!branch) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
        }

        const manager = await prisma.user.findUnique({ where: { publicId: managerId } });

        if (!manager || manager.branchId !== branch.id || manager.role !== Role.MANAGER || manager.deletedAt) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Manager not found in this branch" });
        }

        const updateData: Record<string, any> = {};
        if (data.name) updateData.name = data.name;
        if (data.email) updateData.email = data.email;
        if (data.password) updateData.passwordHash = await hashpassword(data.password);

        await prisma.user.update({
            where: { id: manager.id },
            data: updateData,
        });

        await redis.del("admin:all_branches");
        await redis.del("branches");

        return res.status(StatusCode.OK).json({ message: "Branch manager updated successfully" });
    } catch (error) {
        console.error("Update Branch Manager Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};

export const DeleteBranchManager = async (req: Request, res: Response) => {
    try {
        const { branchId, managerId } = req.params;

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
            data: { deletedAt: new Date() },
        });

        await redis.del("admin:all_branches");
        await redis.del("branches");

        return res.status(StatusCode.OK).json({ message: "Branch manager deleted successfully" });
    } catch (error) {
        console.error("Delete Branch Manager Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
};
