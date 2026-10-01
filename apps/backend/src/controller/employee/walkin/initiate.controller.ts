import { Request, Response } from "express";
import { prisma, Role, AuthProvider } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode.js";
import { initiateWalkinSchema } from "@repo/schemas"; // Ensure this is exported
import { createID } from "../../../utils/nanoID.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../../services/staffActivity/staffActivity.service.js";
import { hashpassword } from "../../../utils/PasswordCrypt/password.js";
import { sendOTP } from "../../../services/otp/otpservice.js";
import { rateLimit } from "../../../utils/rateLimiter.js";
import {
  isWalkinPlaceholderEmail,
  walkinPlaceholderEmail,
} from "../../../utils/customer/identity.js";

export const InitiateWalkin = async (req: Request, res: Response) => {
  try {
    // Validate input
    const validation = initiateWalkinSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation Error",
        errors: validation.error.flatten(),
      });
    }

    const { phone } = validation.data;

    // Ensure EmployeeCheck middleware has run (req.public_Id should be present)
    if (!req.public_Id) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: Employee session missing",
      });
    }

    // Check if user exists
    let user = await prisma.user.findFirst({
      where: { phone: phone },
    });
    // An abandoned walk-in (created here, OTP never verified, no password,
    // placeholder email) is resumed: a fresh OTP is sent for the same user
    // instead of dead-ending on "already exists".
    let resumed = false;
    if (
      user &&
      user.role === Role.CUSTOMER &&
      !user.deletedAt &&
      !user.emailVerifiedAt &&
      !user.passwordHash &&
      isWalkinPlaceholderEmail(user.email)
    ) {
      resumed = true;
      // Move a legacy walkin_*@temp.com placeholder onto the reserved domain.
      const placeholder = walkinPlaceholderEmail(user.publicId);
      if (user.email !== placeholder) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { email: placeholder },
        });
      }
    } else if (user) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "CUSTOMER_ALREADY_EXISTS",
        message: "User already exists with this phone number",
        // Lets the UI jump straight to the existing customer.
        ...(user.role === Role.CUSTOMER && !user.deletedAt
          ? { customer_public_id: user.publicId }
          : {}),
      });
    }
    // Create user if not exists
    if (!user) {
      // Check if phone is used by another user (unique constraint might catch this, but phone is default("") so multiple empty allowed, but we are querying by specific phone)
      // Actually, allow creating logic.
      // Note: phone is not unique in schema `phone String @default("")`, so we findFirst.
      // Ideally should be unique but schema says otherwise for now.
      // Wait, schema says `phone String @default("")`. It's not unique.
      // But for this flow we want to identify unique user by phone.
      // If multiple users have same phone, this might be issue.
      // Assuming we take the first one or create new.

      // Create a temporary user or real user?
      // "make an entry in the db in user"
      const newPublicId = createID();
      user = await prisma.user.create({
        data: {
          publicId: newPublicId,
          name: "Walk-in Customer", // Placeholder
          // Reserved (RFC 2606) placeholder, unique per user; never shown or printed.
          email: walkinPlaceholderEmail(newPublicId),
          phone: phone,
          role: Role.CUSTOMER,
          authProvider: AuthProvider.PASSWORD,
          passwordHash: null, // No password yet
        },
      });
    }
    // Rate limit OTP
    const allowed1 = await rateLimit(`walkin_otp_send_1min:${user.id}`, 1, 60);
    const allowed2 = await rateLimit(
      `walkin_otp_send_hour:${user.id}`,
      5,
      3600,
    );

    if (!allowed1 || !allowed2) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Too many OTP requests. Please try again later.",
      });
    }
    // Invalidate old OTPs
    await prisma.emailVerificationOtp.deleteMany({
      where: { userId: user.id },
    });

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpHash = await hashpassword(String(otp));

    // Store OTP
    // Schema: EmailVerificationOtp has `phone` field.
    await prisma.emailVerificationOtp.create({
      data: {
        userId: user.id,
        phone: phone,
        otpHash: otpHash,
        expiresAt: new Date(Date.now() + 1000 * 60 * 5), // 5 minutes
      },
    });
    console.log(`Walkin Initiate Route->[Walkin] OTP for ${phone}: ${otp}`);
    // Send SMS Later Dev Test RemoveDEV
    // const smsResponse = await sendOTP({
    //     mobile: phone,
    //     otp: otp
    // });
    // if (!smsResponse.success) {
    //     // Rollback? Or just fail.
    //     return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    //         message: "Failed to send OTP SMS"
    //     });
    // }
    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.INITIATED,
      entityType: StaffEntityType.CUSTOMER,
      entityRef: user.publicId,
      description: resumed
        ? `Walk-in resumed (OTP re-sent) for customer phone ${phone}`
        : `Walk-in initiated for customer phone ${phone}`,
      metadata: { phone, resumed },
    });

    return res.status(StatusCode.OK).json({
      message: "OTP sent successfully",
      otp: otp,
      customer_public_id: user.publicId,
      // true when an earlier, unverified walk-in for this phone was resumed.
      resumed,
    });
  } catch (e: any) {
    console.error("Error in InitiateWalkin:", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
