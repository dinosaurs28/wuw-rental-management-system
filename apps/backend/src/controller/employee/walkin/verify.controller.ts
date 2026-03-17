import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode.js";
import { verifyWalkinOtpSchema } from "@repo/schemas";
import { comparehash } from "../../../utils/PasswordCrypt/password.js";

export const VerifyWalkinOtp = async (req: Request, res: Response) => {
  try {
    const validation = verifyWalkinOtpSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation Error",
        errors: validation.error.flatten(),
      });
    }

    const { customer_public_id, otp } = validation.data;

    // Ensure Employee Check
    if (!req.public_Id) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: Employee session missing",
      });
    }

    const user = await prisma.user.findUnique({
      where: { publicId: customer_public_id },
    });

    if (!user) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "User not found",
      });
    }

    const otpRecord = await prisma.emailVerificationOtp.findUnique({
      where: { userId: user.id },
    });

    if (!otpRecord) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "OTP not found or expired",
      });
    }

    if (otpRecord.expiresAt < new Date()) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "OTP expired",
      });
    }

    const isValid = await comparehash(otp, otpRecord.otpHash);
    if (!isValid) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Invalid OTP",
      });
    }

    // Mark as verified
    // We set emailVerifiedAt to now. Even though it's phone verification, we treat it as "verified" status for the user.
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });

    // Cleanup OTP
    await prisma.emailVerificationOtp.delete({
      where: { id: otpRecord.id },
    });

    return res.status(StatusCode.OK).json({
      message: "OTP verified successfully",
    });
  } catch (e: any) {
    console.error("Error in VerifyWalkinOtp:", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
