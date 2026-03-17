import { NextFunction, Request, Response } from "express";
import { StatusCode } from "../types/statusCode.js";
import { prisma } from "@repo/database/client";
export const kycCheck = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const public_Id = req.public_Id;
    if (!public_Id) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "The Public Id Is Missing",
      });
    }
    const isKycUpload = await prisma.user.findUnique({
      where: {
        publicId: public_Id,
      },
      select: {
        customerProfile: {
          select: {
            kycs: {
              select: {
                status: true,
              },
            },
          },
        },
      },
    });
    if (
      !isKycUpload?.customerProfile?.kycs ||
      isKycUpload.customerProfile.kycs.length === 0
    ) {
      return res.status(StatusCode.FORBIDDEN).json({
        message:
          "Please ensure you upload a valid, clear image of your Driver's License.",
      });
    }
    return next();
  } catch (e: any) {
    console.log("Internal Error While Checking Kyc Has been Upload", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Error While Checking Kyc Has been Upload",
    });
  }
};
