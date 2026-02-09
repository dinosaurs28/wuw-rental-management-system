import { NextFunction, Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../types/statusCode.js";

export const checkProfileCompletion = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const publicId = req.public_Id;
        if (!publicId) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Unauthorized",
            });
        }

        const user = await prisma.user.findUnique({
            where: { publicId },
            select: {
                customerProfile: {
                    select: {
                        isProfileCompleted: true,
                    },
                },
            },
        });

        if (!user || !user.customerProfile?.isProfileCompleted) {
            const redirectUrl = `${process.env.FRONTEND_REDIRECT_URL}/profile/edit`;
            return res.status(StatusCode.FORBIDDEN).json({
                message: "Please complete your profile before proceeding.",
                code: "PROFILE_INCOMPLETE",
                redirectUrl
            });
        }

        return next();
    } catch (error) {
        console.error("Error checking profile completion:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error",
        });
    }
};
