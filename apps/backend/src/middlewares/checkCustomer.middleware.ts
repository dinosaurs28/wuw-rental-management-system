import { NextFunction, Request, Response } from "express";
import { StatusCode } from "../types/statusCode";
import { prisma } from "@repo/database/client";
export const CheckCustomerPublicId = async (req: Request, res: Response, next: NextFunction) => {
    const { customer_public_id } = req.body;
    if (!customer_public_id) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "customer_public_id is required in the body"
        });
    }
    try {
        const customer = await prisma.customer.findUnique({
            where: {
                publicId: customer_public_id
            },
            select: {
                id: true
            }
        });
        if (!customer) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Customer not found"
            });
        }
        // Attach customer ID to request for downstream use if needed, 
        // though the controller might just look it up again or use the public ID.
        // For now, validation is the primary goal.
        return next();
    } catch (error) {
        console.error("Error checking customer public ID:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during customer validation"
        });
    }
}