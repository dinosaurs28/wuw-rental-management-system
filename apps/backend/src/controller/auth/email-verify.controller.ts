import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { Request, Response } from "express";
import { rateLimit } from "../../utils/rateLimiter.js";
import {
  comparehash,
  hashpassword,
} from "../../utils/PasswordCrypt/password.js";
import { sendOTP } from "../../services/otp/otpservice.js";
import { otpSchema } from "@repo/schemas";
import { jwtsign } from "../../utils/token/tokensign.utlis.js";

export const generateOTP = async (req: Request, res: Response) => {
  try {
    const publicId = req.cookies.verifySession;
    const phone_num = req.body.phone;

    if (!publicId) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "The Public ID is Missing",
      });
    }
    if (!phone_num) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Phone Number is Missing",
      });
    }

    const user = await prisma.user.findUnique({
      where: { publicId: publicId },
    });

    if (!user) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "User not found",
      });
    }

    // Update phone number if it's different
    if (user.phone !== phone_num) {
      await prisma.user.update({
        where: { id: user.id },
        data: { phone: phone_num },
      });
    }

    const allowed1 = await rateLimit(`otp_send_1min:${user.id}`, 1, 60);
    const allowed2 = await rateLimit(`otp_send_hour:${user.id}`, 5, 3600);

    if (!allowed1 || !allowed2) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Too many OTP requests. Please try again later.",
      });
    }

    await prisma.emailVerificationOtp.deleteMany({
      where: { userId: user.id },
    });

    const otp = Math.floor(100000 + Math.random() * 900000);

    // Store hash locally for verification
    await prisma.emailVerificationOtp.create({
      data: {
        phone: phone_num,
        userId: user.id,
        otpHash: await hashpassword(String(otp)),
        expiresAt: new Date(Date.now() + 1000 * 60 * 5),
      },
    });
    console.log("OTP Generated", otp);

    // Send SMS
    const smsResponse = await sendOTP({
      mobile: phone_num,
      otp: otp,
    });

    if (!smsResponse.success) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
        message: "Failed to send OTP SMS",
      });
    }

    return res
      .status(StatusCode.OK)
      .json({ message: "OTP sent successfully." });
  } catch (e: any) {
    console.log("Internal Error Occured While Generating the Otp", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error While Generating the Otp",
    });
  }
};

export const verifyOTP = async (req: Request, res: Response) => {
  try {
    const parsedopt = otpSchema.safeParse(req.body);
    const publicId = req.cookies.verifySession;

    if (!parsedopt.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: parsedopt.error.flatten(),
      });
    }
    if (!publicId) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "The Public ID is Missing",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        publicId: publicId,
      },
    });

    if (!user) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "User does not exist.",
      });
    }

    const allowed = await rateLimit(`otp_verify:${user.id}`, 5, 3600);
    if (!allowed) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Too many attempts." });
    }

    const response = await prisma.emailVerificationOtp.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!response) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "OTP not found or expired",
      });
    }

    if (response.expiresAt < new Date()) {
      return res.status(400).json({ message: "OTP expired." });
    }

    const comaprehashotp = await comparehash(
      String(parsedopt.data.otp),
      response.otpHash,
    );
    if (!comaprehashotp) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Incorrect Otp! Please try Again",
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        userId: user.id,
      },
    });

    const token = await jwtsign({
      sub: user.publicId,
      role: user.role,
      verified: true,
      provider: user.authProvider,
    });

    return res
      .status(StatusCode.OK)
      .cookie("accessToken", token, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
      })
      .clearCookie("verifySession")
      .json({
        message: "OTP validated successfully",
      });
  } catch (e: any) {
    console.log("Internal Error Occured While Verifying the Otp", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error While Verifying the Otp",
    });
  }
};
