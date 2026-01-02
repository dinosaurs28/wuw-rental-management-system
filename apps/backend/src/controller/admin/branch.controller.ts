import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { hashpassword } from "../../utils/PasswordCrypt/password.js";
import { createBranchSchema } from "@repo/schemas";
import { Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";

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
