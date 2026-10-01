import { NextFunction, Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../types/statusCode.js";
import {
  getMissingProfileFields,
  profileFieldsOf,
  profileIncompleteMessage,
} from "../utils/customer/identity.js";

export const checkProfileCompletion = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
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
        name: true,
        phone: true,
        customerProfile: {
          select: {
            addressLine1: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
            drivingLicenceNumber: true,
            aadhaarNumber: true,
          },
        },
      },
    });

    // Completeness is derived from the stored values (DL + Aadhaar numbers
    // included), so a stale isProfileCompleted flag can never let a booking by.
    const missingFields = user
      ? getMissingProfileFields(profileFieldsOf(user, user.customerProfile))
      : [];
    if (!user || !user.customerProfile || missingFields.length > 0) {
      const redirectUrl = `${process.env.FRONTEND_REDIRECT_URL}/profile/personal-information`;
      return res.status(StatusCode.FORBIDDEN).json({
        success: false,
        message: user
          ? profileIncompleteMessage(missingFields, "self")
          : "Please complete your profile before proceeding.",
        code: "PROFILE_INCOMPLETE",
        missingFields,
        redirectUrl,
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
