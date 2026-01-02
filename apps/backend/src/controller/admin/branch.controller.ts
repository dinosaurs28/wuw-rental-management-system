import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

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
