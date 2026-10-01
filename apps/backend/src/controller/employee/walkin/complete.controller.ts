import { Request, Response } from "express";
import { randomBytes } from "crypto";
import { prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode.js";
import {
  aadhaarNumberSchema,
  completeWalkinProfileSchema,
  drivingLicenceNumberSchema,
  maskAadhaar,
} from "@repo/schemas";
import { hashpassword } from "../../../utils/PasswordCrypt/password.js";
import { createID } from "../../../utils/nanoID.js";
import {
  getMissingProfileFields,
  isPlaceholderEmail,
  isWalkinPlaceholderEmail,
  profileIncompleteMessage,
  walkinPlaceholderEmail,
} from "../../../utils/customer/identity.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../../services/staffActivity/staffActivity.service.js";

// Old staff builds send no DL/Aadhaar numbers: tolerate omission (stored values
// are kept and the profile stays incomplete, so booking create answers 422
// CUSTOMER_PROFILE_INCOMPLETE); a value that is sent must still be valid.
const completeWalkinProfileRequestSchema = completeWalkinProfileSchema.extend({
  drivingLicenceNumber: drivingLicenceNumberSchema.optional(),
  aadhaarNumber: aadhaarNumberSchema.optional(),
});

export const CompleteWalkinProfile = async (req: Request, res: Response) => {
  try {
    const validation = completeWalkinProfileRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "VALIDATION_ERROR",
        // First issue as the message, e.g. "Enter a valid Aadhaar number".
        message: validation.error.errors[0]?.message ?? "Validation Error",
        errors: validation.error.flatten(),
      });
    }

    const {
      customer_public_id,
      name,
      email,
      drivingLicenceNumber: dlInput,
      aadhaarNumber: aadhaarInput,
      addressLine1,
      dob,
      alternatePhone,
      city,
      state,
      zipCode,
      country,
      gender,
    } = validation.data;

    // Ensure Employee Check
    if (!req.public_Id) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: Employee session missing",
      });
    }

    const user = await prisma.user.findUnique({
      where: { publicId: customer_public_id },
      include: { customerProfile: true },
    });

    if (!user || user.deletedAt) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "User not found",
      });
    }

    // Staff may only complete CUSTOMER accounts — never rename or re-email a
    // staff, manager or admin user.
    if (user.role !== Role.CUSTOMER) {
      return res.status(StatusCode.FORBIDDEN).json({
        success: false,
        code: "NOT_A_CUSTOMER",
        message: "Only customer profiles can be completed here.",
      });
    }

    // Check if verified (OTP step done)
    if (!user.emailVerifiedAt) {
      return res.status(StatusCode.FORBIDDEN).json({
        success: false,
        code: "VERIFICATION_PENDING",
        message:
          "User verification pending. Please complete OTP verification first.",
      });
    }

    // Walk-ins get a random password so the account can later be claimed via a
    // reset; an existing password (online customer) is never touched.
    const passwordHash = user.passwordHash
      ? null
      : await hashpassword(randomBytes(12).toString("base64url"));

    // Email is optional: blank keeps the stored address (real or placeholder).
    // Stored lowercased: sign-in and password reset look the address up lowercased.
    const nextEmail = email?.trim().toLowerCase() || null;
    const emailChanged =
      !!nextEmail && nextEmail !== user.email.toLowerCase();

    if (emailChanged) {
      // The counter may only give an email to a customer who has none yet (a
      // placeholder). A real address is the customer's login: replacing it here
      // would let anyone at a counter take the account over via "Forgot password".
      if (!isPlaceholderEmail(user.email)) {
        return res.status(StatusCode.FORBIDDEN).json({
          success: false,
          code: "EMAIL_CHANGE_NOT_ALLOWED",
          message:
            "This customer already has an email address and it can't be changed at the counter. Leave the email as it is.",
        });
      }
      // User.email is unique but case-sensitive: catch "John@x.com" vs "john@x.com".
      const taken = await prisma.user.findFirst({
        where: {
          email: { equals: nextEmail!, mode: "insensitive" },
          NOT: { id: user.id },
        },
        select: { id: true },
      });
      if (taken) {
        return res.status(StatusCode.CONFLICT).json({
          success: false,
          code: "EMAIL_ALREADY_EXISTS",
          message: "Email already exists",
        });
      }
    }
    // A legacy walkin_*@temp.com placeholder moves onto the reserved domain.
    const placeholderEmail = walkinPlaceholderEmail(user.publicId);
    const emailUpdate = emailChanged
      ? nextEmail!
      : isWalkinPlaceholderEmail(user.email) && user.email !== placeholderEmail
        ? placeholderEmail
        : null;

    // Numbers omitted by an old build keep their stored values.
    const drivingLicenceNumber =
      dlInput ?? user.customerProfile?.drivingLicenceNumber ?? null;
    const aadhaarNumber =
      aadhaarInput ?? user.customerProfile?.aadhaarNumber ?? null;

    const missingFields = getMissingProfileFields({
      name,
      phone: user.phone,
      addressLine1,
      city,
      state,
      zipCode,
      country,
      drivingLicenceNumber,
      aadhaarNumber,
    });
    const isProfileCompleted = missingFields.length === 0;

    // Update User
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name: name,
        ...(emailUpdate ? { email: emailUpdate } : {}),
        ...(passwordHash ? { passwordHash } : {}),
        // Create or update customer profile
        customerProfile: {
          upsert: {
            create: {
              publicId: createID(),
              addressLine1: addressLine1 || "",
              alternatePhone: alternatePhone || "",
              country: country || "",
              dob: dob || "",
              city: city || "",
              state: state || "",
              zipCode: zipCode || "",
              drivingLicenceNumber,
              aadhaarNumber,
              isProfileCompleted,
            },
            update: {
              addressLine1: addressLine1 || "",
              city: city || "",
              state: state || "",
              zipCode: zipCode || "",
              country: country || "",
              // Optional fields only overwrite when sent.
              ...(dob ? { dob } : {}),
              ...(alternatePhone !== undefined ? { alternatePhone } : {}),
              drivingLicenceNumber,
              aadhaarNumber,
              isProfileCompleted,
            },
          },
        },
      },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.COMPLETED,
      entityType: StaffEntityType.CUSTOMER,
      entityRef: user.publicId,
      description: isProfileCompleted
        ? `Customer profile completed for ${name}`
        : `Customer profile updated for ${name} (still incomplete)`,
      // Aadhaar is masked in audit metadata; never log the full number.
      metadata: {
        drivingLicenceNumber,
        aadhaarNumber: aadhaarNumber ? maskAadhaar(aadhaarNumber) : null,
        emailChanged,
        isProfileCompleted,
        missingFields,
      },
    });

    // We might want to return the password to the employee to share? Or email it?
    // User request: "password would be random generate on the backend side with hash. later the user will reset the password."
    // Doesn't explicitly say "return it". But employee might need it?
    // Security risk to return it. Maybe user uses phone OTP mainly?
    // If "later user will reset", maybe they use "Forgot Password" flow via phone/email?
    // I won't return it unless asked.

    return res.status(StatusCode.OK).json({
      message: isProfileCompleted
        ? "Profile completed successfully"
        : `Profile saved. ${profileIncompleteMessage(missingFields, "staff")}`,
      customer_public_id: user.publicId,
      isProfileCompleted,
      missingFields,
      // false when the customer has no real email (placeholder kept).
      hasEmail: emailChanged || !isPlaceholderEmail(user.email),
    });
  } catch (e: any) {
    console.error("Error in CompleteWalkinProfile:", e);
    // Handle unique constraint error (e.g. duplicate email)
    if (e.code === "P2002") {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "EMAIL_ALREADY_EXISTS",
        message: "Email already exists",
      });
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
