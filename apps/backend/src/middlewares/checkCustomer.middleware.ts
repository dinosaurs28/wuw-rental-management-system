import { NextFunction, Request, Response } from "express";
import { StatusCode } from "../types/statusCode";
import { prisma } from "@repo/database/client";

declare global {
    namespace Express {
        interface Request {
            customer_public_id?: string;
            customer_id?: number;
        }
    }
}


export const CheckCustomerPublicId = async (req: Request, res: Response, next: NextFunction) => {
    const { customer_public_id } = req.body;
    if (!customer_public_id) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "customer_public_id is required in the body"
        });
    }
    try {
        const user = await prisma.user.findUnique({
            where: {
                publicId: customer_public_id
            },
            include: {
                customerProfile: true
            }
        });

        if (!user || !user.customerProfile) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Customer profile not found"
            });
        }

        // Validation successful
        req.customer_public_id = user.customerProfile.publicId;
        req.customer_id = user.customerProfile.id;
        return next();
    } catch (error) {
        console.error("Error checking customer public ID:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during customer validation"
        });
    }
}