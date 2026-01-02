import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { hashpassword } from "../../utils/PasswordCrypt/password.js";
import { createBranchSchema, editBranchSchema } from "@repo/schemas";
import { Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { cleanupQueue } from "../../lib/queue.client.js";

export const CreateBranch = async (req: Request, res: Response) => {
    try {
        const validation = createBranchSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Invalid Inputs",
                error: validation.error
            });
        }

        const data = validation.data;

        const existingUser = await prisma.user.findUnique({
            where: { email: data.managerEmail }
        });

        if (existingUser) {
            return res.status(StatusCode.CONFLICT).json({
                message: "A user with this email already exists."
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const newBranch = await tx.branch.create({
                data: {
                    name: data.name,
                    address: data.address,
                    phone: data.phone,
                    publicId: createID(),
                }
            });

            const passwordHash = await hashpassword(data.managerPassword);

            const newManager = await tx.user.create({
                data: {
                    name: data.managerName,
                    email: data.managerEmail,
                    passwordHash: passwordHash,
                    role: Role.MANAGER,
                    branchId: newBranch.id,
                    publicId: createID(),
                    authProvider: 'PASSWORD'
                }
            });

            return { branch: newBranch, manager: newManager };
        });

        const cacheKey = "admin:all_branches";
        await redis.del(cacheKey);

        return res.status(StatusCode.CREATED).json({
            message: "Branch and Manager created successfully",
            data: {
                branch: result.branch,
                manager: {
                    id: result.manager.publicId,
                    name: result.manager.name,
                    email: result.manager.email
                }
            }
        });

    } catch (error) {
        console.error("Create Branch Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
}

export const GetAllBranches = async (req: Request, res: Response) => {
    try {
        const cacheKey = "admin:all_branches";
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
            return res.status(StatusCode.OK).json(JSON.parse(cachedData));
        }

        const branches = await prisma.branch.findMany({
            select: {
                publicId: true,
                name: true,
                address: true,
                phone: true,
                createdAt: true,
                _count: {
                    select: {
                        users: true,
                        vehicles: true,
                        bookings: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        const responseData = {
            message: "Branches fetched successfully",
            data: branches
        };

        await redis.setex(cacheKey, 300, JSON.stringify(responseData));

        return res.status(StatusCode.OK).json(responseData);

    } catch (error) {
        console.error("Get All Branches Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
}
export const EditBranch = async (req: Request, res: Response) => {
    try {
        const { branchId } = req.params;
        const validation = editBranchSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Invalid Inputs",
                error: validation.error
            });
        }

        const data = validation.data;

        const branch = await prisma.branch.findUnique({
            where: { publicId: branchId },
            include: { users: { where: { role: Role.MANAGER } } }
        });

        if (!branch) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
        }

        const manager = branch.users[0];

        await prisma.$transaction(async (tx) => {
            if (data.name || data.address || data.phone) {
                await tx.branch.update({
                    where: { id: branch.id },
                    data: {
                        name: data.name,
                        address: data.address,
                        phone: data.phone
                    }
                });
            }

            // Update Manager Details
            if ((data.managerName || data.managerEmail || data.managerPassword) && manager) {
                const updateData: any = {};
                if (data.managerName) updateData.name = data.managerName;
                if (data.managerEmail) updateData.email = data.managerEmail;
                if (data.managerPassword) {
                    updateData.passwordHash = await hashpassword(data.managerPassword);
                }

                await tx.user.update({
                    where: { id: manager.id },
                    data: updateData
                });
            }
        });

        // Invalidate Cache
        await redis.del("admin:all_branches");

        return res.status(StatusCode.OK).json({
            message: "Branch updated successfully"
        });

    } catch (error) {
        console.error("Edit Branch Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });

    }
}

export const DeleteBranch = async (req: Request, res: Response) => {
    try {
        const { branchId } = req.params;

        const branch = await prisma.branch.findUnique({
            where: { publicId: branchId },
            include: { users: { where: { role: Role.MANAGER } } }
        });

        if (!branch) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
        }

        await prisma.$transaction(async (tx) => {
            await tx.branch.update({
                where: { id: branch.id },
                data: { deletedAt: new Date() }
            });

            await tx.user.updateMany({
                where: {
                    branchId: branch.id,
                    role: Role.MANAGER
                },
                data: { deletedAt: new Date() }
            });
        });

        await cleanupQueue.add("delete-branch-cascading", { branchId: branch.id }, {
            delay: 500
        });

        await redis.del("admin:all_branches");

        return res.status(StatusCode.OK).json({
            message: "Branch deleted successfully. Associated data will be removed in the background."
        });

    } catch (error) {
        console.error("Delete Branch Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
}

