import { Request, Response } from "express";
import {
  forgotPasswordSchema,
  resetPasswordWithOtpSchema,
} from "@repo/schemas";
import { prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import {
  comparehash,
  hashpassword,
} from "../../utils/PasswordCrypt/password.js";
import { rateLimit } from "../../utils/rateLimiter.js";
import { sendOTPEmail } from "../../services/email/emailservice.js";
import {
  auditService,
  AuditCategory,
  AuditSeverity,
} from "../../services/audit/audit.service.js";

// Self-service customer password reset via email OTP. The OTP is stored in the
// existing EmailVerificationOtp table (one row per user, unique userId) so no
// schema migration is needed — reset and signup-verification OTPs are mutually
// exclusive per user because both delete-then-create for that userId.

const OTP_EXPIRY_MINUTES = 10;
const SENDER_EMAIL = process.env.OTP_SENDER_EMAIL || "no-reply@whatuwantrentals.com";
const SENDER_NAME = "WUW Rentals";

// Generic message returned whether or not the account exists — prevents email
// enumeration through this endpoint.
const GENERIC_SENT_MESSAGE =
  "If an account exists for that email, a reset code has been sent.";
// Reused for every reset-verify failure so an attacker can't tell which factor
// (email / OTP / expiry) was wrong.
const INVALID_CODE_MESSAGE = "Invalid or expired reset code.";

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation Error",
        errors: parsed.error.flatten(),
      });
    }

    const email = parsed.data.email.toLowerCase().trim();

    // IP throttle blunts enumeration/abuse regardless of whether the account exists.
    const ipKey = req.ip ?? "unknown";
    const ipAllowed = await rateLimit(`pwreset_ip:${ipKey}`, 10, 3600);
    if (!ipAllowed) {
      return res.status(StatusCode.TOO_MANY_REQUESTS).json({
        message: "Too many requests. Please try again later.",
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Only customers reset through the public endpoint (mirrors signin, which
    // only issues tokens to CUSTOMER accounts). Staff/admin reset elsewhere.
    if (user && user.role === Role.CUSTOMER && !user.deletedAt) {
      const allowed1 = await rateLimit(`pwreset_send_1min:${user.id}`, 1, 60);
      const allowed2 = await rateLimit(`pwreset_send_hour:${user.id}`, 5, 3600);

      if (allowed1 && allowed2) {
        await prisma.emailVerificationOtp.deleteMany({
          where: { userId: user.id },
        });

        const otp = Math.floor(100000 + Math.random() * 900000);

        await prisma.emailVerificationOtp.create({
          data: {
            userId: user.id,
            phone: user.phone ?? "",
            otpHash: await hashpassword(String(otp)),
            expiresAt: new Date(Date.now() + 1000 * 60 * OTP_EXPIRY_MINUTES),
          },
        });

        const emailResponse = await sendOTPEmail({
          recipientEmail: user.email,
          recipientName: user.name,
          otp,
          senderEmail: SENDER_EMAIL,
          senderName: SENDER_NAME,
          expiryMinutes: OTP_EXPIRY_MINUTES,
        });

        auditService.log({
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: "PASSWORD_RESET_REQUESTED",
          category: AuditCategory.AUTH,
          severity: AuditSeverity.WARNING,
          description: `Password reset code ${emailResponse.success ? "sent" : "FAILED to send"} for ${user.email}`,
          entity: "User",
          entityId: user.publicId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
      }
    }

    // Always the same response — never reveal account existence.
    return res.status(StatusCode.OK).json({ message: GENERIC_SENT_MESSAGE });
  } catch (e: any) {
    console.log("Internal Error in forgotPassword", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error while processing the password reset request",
    });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const parsed = resetPasswordWithOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation Error",
        errors: parsed.error.flatten(),
      });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const { otp, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== Role.CUSTOMER || user.deletedAt) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: INVALID_CODE_MESSAGE,
      });
    }

    const allowed = await rateLimit(`pwreset_verify:${user.id}`, 5, 3600);
    if (!allowed) {
      return res.status(StatusCode.TOO_MANY_REQUESTS).json({
        message: "Too many attempts. Please try again later.",
      });
    }

    const record = await prisma.emailVerificationOtp.findUnique({
      where: { userId: user.id },
    });
    if (!record || record.expiresAt < new Date()) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: INVALID_CODE_MESSAGE,
      });
    }

    const otpMatches = await comparehash(String(otp), record.otpHash);
    if (!otpMatches) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: INVALID_CODE_MESSAGE,
      });
    }

    const newHash = await hashpassword(password);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        // Proving control of the inbox also verifies the email.
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: { userId: user.id },
    });

    auditService.log({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: "PASSWORD_RESET_COMPLETED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset completed for ${user.email}`,
      entity: "User",
      entityId: user.publicId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(StatusCode.OK).json({
      message: "Password reset successfully. You can now sign in.",
    });
  } catch (e: any) {
    console.log("Internal Error in resetPassword", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error while resetting the password",
    });
  }
};
