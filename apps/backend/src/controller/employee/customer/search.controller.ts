import { Request, Response } from "express";
import { prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode.js";
import { redis } from "../../../lib/redisconfig.js";

export const SearchCustomer = async (req: Request, res: Response) => {
    try {
        const q = req.query.q as string;

        // Ensure Employee Session
        if (!req.public_Id) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Unauthorized: Employee session missing"
            });
        }

        if (!q || q.trim().length === 0) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Search query 'q' is required"
            });
        }

        const trimmedQuery = q.trim();
        const cacheKey = `customer_search:${trimmedQuery.toLowerCase()}`;

        // Check Cache
        const cachedResult = await redis.get(cacheKey);
        if (cachedResult) {
            return res.status(StatusCode.OK).json({
                message: "Customers found (cached)",
                customers: JSON.parse(cachedResult)
            });
        }

        // Search DB
        // We match Name (contains), Email (contains), or Phone (contains)
        // Only Role.CUSTOMER
        const customers = await prisma.user.findMany({
            where: {
                role: Role.CUSTOMER,
                OR: [
                    { name: { contains: trimmedQuery, mode: 'insensitive' } },
                    { email: { contains: trimmedQuery, mode: 'insensitive' } },
                    { phone: { contains: trimmedQuery } }
                ]
            },
            select: {
                publicId: true,
                name: true,
                email: true,
                phone: true,
                customerProfile: {
                    select: {
                        isProfileCompleted: true,
                        publicId: true
                    }
                }
            },
            take: 20 // Limit results
        });

        if (customers.length === 0) {
            return res.status(StatusCode.OK).json({
                message: "No customers found matching your query",
                customers: []
            });
        }

        // Cache Result (60 seconds)
        await redis.setex(cacheKey, 60, JSON.stringify(customers));

        return res.status(StatusCode.OK).json({
            message: "Customers found",
            customers: customers
        });

    } catch (e: any) {
        console.error("Error in SearchCustomer:", e);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
};