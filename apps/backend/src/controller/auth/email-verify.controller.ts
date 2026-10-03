import crypto from "crypto";
import { prisma, Role } from "@repo/database/client";
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
import { normalizeIndianMobile, toMsg91Mobile } from "../../utils/phone.js";
import {
  readVerifySession,
  VERIFY_SESSION_COOKIE,
} from "../../utils/token/verifySession.js";

// Sign-up phone verification. Only an UNVERIFIED customer holding a valid,
// signed verifySession cookie (issued after their password / Google sign-in)
// may use it. The typed phone is kept with the pending code and written to the
// account only once the code is verified, so this endpoint can never point
// someone else's account at a new number.
function awaitingPhoneVerification(user: {
  role: Role;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
  isActive: boolean;
}): boolean {
  return (
    user.role === Role.CUSTOMER &&
    !user.emailVerifiedAt &&
    !user.deletedAt &&
    user.isActive
  );
}

function sessionExpired(res: Response) {
  return res.status(StatusCode.FORBIDDEN).json({
    success: false,
    code: "VERIFY_SESSION_INVALID",
    message: "Your verification session has expired. Please sign in again.",
  });
}

function notAwaitingVerification(res: Response) {
  return res.status(StatusCode.FORBIDDEN).json({
    success: false,
    code: "VERIFICATION_NOT_REQUIRED",
    message: "This account doesn't need phone verification. Please sign in.",
  });
}

export const generateOTP = async (req: Request, res: Response) => {
  try {
    const publicId = readVerifySession(req);
    const phone_num = req.body?.phone;

    if (!publicId) {
      return sessionExpired(res);
    }
    if (!phone_num) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Phone Number is Missing",
      });
    }
    const phone = normalizeIndianMobile(
      typeof phone_num === "number" ? String(phone_num) : phone_num,
    );
    if (!phone) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_PHONE",
        message: "Enter a valid 10-digit mobile number.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { publicId: publicId },
    });

    if (!user) {
      return sessionExpired(res);
    }
    if (!awaitingPhoneVerification(user)) {
      return notAwaitingVerification(res);
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

    const otp = crypto.randomInt(100000, 1000000);

    // Store hash locally for verification. The phone waits here until the
    // code is verified; only then is it saved on the account.
    await prisma.emailVerificationOtp.create({
      data: {
        phone,
        userId: user.id,
        otpHash: await hashpassword(String(otp)),
        expiresAt: new Date(Date.now() + 1000 * 60 * 5),
      },
    });

    // Send SMS
    const smsResponse = await sendOTP({
      mobile: toMsg91Mobile(phone),
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
    const publicId = readVerifySession(req);

    if (!parsedopt.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: parsedopt.error.flatten(),
      });
    }
    if (!publicId) {
      return sessionExpired(res);
    }

    const user = await prisma.user.findUnique({
      where: {
        publicId: publicId,
      },
    });

    if (!user) {
      return sessionExpired(res);
    }
    if (!awaitingPhoneVerification(user)) {
      return notAwaitingVerification(res);
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

    // The number the code went to is proven now: save it with the verification.
    const verifiedPhone = normalizeIndianMobile(response.phone);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        ...(verifiedPhone ? { phone: verifiedPhone } : {}),
      },
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
      .clearCookie(VERIFY_SESSION_COOKIE)
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
