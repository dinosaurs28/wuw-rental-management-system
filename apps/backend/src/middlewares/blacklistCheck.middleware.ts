import { NextFunction, Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../types/statusCode.js";
import { blacklistRefusal } from "../services/customer/customer-blacklist.service.js";

/**
 * Refuses a new customer booking when the signed-in customer is blacklisted by
 * a Branch Manager (#13): 403 CUSTOMER_BLACKLISTED with a neutral message (the
 * reason is never shown to the customer). Runs before the profile gate so a
 * blacklisted customer isn't first sent to complete their profile.
 */
export const rejectBlacklistedCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const publicId = req.public_Id;
    if (!publicId) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { publicId },
      select: {
        customerProfile: {
          select: { isBlacklisted: true, blacklistReason: true, blacklistedAt: true },
        },
      },
    });

    const refusal = blacklistRefusal(user?.customerProfile, "customer");
    if (refusal) {
      return res.status(refusal.status).json(refusal.toJSON());
    }

    return next();
  } catch (error) {
    console.error("Error checking customer blacklist:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
