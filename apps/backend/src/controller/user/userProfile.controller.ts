import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import {
  aadhaarNumberSchema,
  customerAgeSchema,
  drivingLicenceNumberSchema,
  legacyDobSchema,
  updateProfileSchema,
} from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";
import {
  displayEmail,
  effectiveCustomerAge,
  getMissingProfileFields,
  profileFieldsOf,
} from "../../utils/customer/identity.js";

// The profile form (Oct 2026) sends an age and no DL / Aadhaar / date of
// birth. Old app builds send DL + Aadhaar numbers and a date of birth but no
// age: tolerate both shapes. Omitted values keep what is stored; a value that
// is sent must still be valid. Completeness: see utils/customer/identity.ts.
const updateProfileRequestSchema = updateProfileSchema.extend({
  age: customerAgeSchema.optional(),
  dob: legacyDobSchema.optional(),
  drivingLicenceNumber: drivingLicenceNumberSchema.optional(),
  aadhaarNumber: aadhaarNumberSchema.optional(),
});

export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const publicId = req.public_Id;
    if (!publicId) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "User ID is missing",
      });
    }

    const user = await prisma.user.findUnique({
      where: { publicId },
      include: {
        customerProfile: true,
      },
    });

    if (!user) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "User not found",
      });
    }

    const missingFields = getMissingProfileFields(
      profileFieldsOf(user, user.customerProfile),
    );

    return res.status(StatusCode.OK).json({
      name: user.name,
      // null when the account only has a walk-in placeholder address.
      email: displayEmail(user.email),
      phone: user.phone,
      dob: user.customerProfile?.dob || null,
      // Entered age, else derived from an older customer's date of birth
      age: effectiveCustomerAge(user.customerProfile),
      addressLine1: user.customerProfile?.addressLine1 || "",
      city: user.customerProfile?.city || "",
      state: user.customerProfile?.state || "",
      country: user.customerProfile?.country || "",
      zipCode: user.customerProfile?.zipCode || "",
      alternatePhone: user.customerProfile?.alternatePhone || "",
      // Full numbers: this is the owner's own profile (prefills the form).
      drivingLicenceNumber: user.customerProfile?.drivingLicenceNumber ?? null,
      aadhaarNumber: user.customerProfile?.aadhaarNumber ?? null,
      isProfileCompleted: !!user.customerProfile && missingFields.length === 0,
      missingFields,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const publicId = req.public_Id;
    const body = req.body;

    const validation = updateProfileRequestSchema.safeParse(body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "VALIDATION_ERROR",
        // First issue as the message, e.g. "Enter a valid Aadhaar number".
        message: validation.error.errors[0]?.message ?? "Invalid input",
        errors: validation.error.errors,
      });
    }

    const data = validation.data;

    const user = await prisma.user.findUnique({
      where: { publicId },
      include: {
        customerProfile: {
          select: { id: true, drivingLicenceNumber: true, aadhaarNumber: true, age: true, dob: true },
        },
      },
    });
    if (!user) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "User not found" });
    }

    // One vehicle per DL (X3): a customer can't swap the DL number on file
    // while a booking is live, or a new number would slip past DL_IN_USE.
    // Adding a number for the first time is always allowed; staff correct
    // mistakes at the counter or at pickup.
    const storedDl = user.customerProfile?.drivingLicenceNumber ?? null;
    if (storedDl && data.drivingLicenceNumber && data.drivingLicenceNumber !== storedDl) {
      const liveBooking = await prisma.booking.findFirst({
        where: {
          customerId: user.customerProfile!.id,
          deletedAt: null,
          OR: [
            { status: { in: ["CONFIRMED", "PICKED_UP"] } },
            { status: "HOLD", holdExpiresAt: { gt: new Date() } },
          ],
        },
        select: { id: true },
      });
      if (liveBooking) {
        return res.status(StatusCode.CONFLICT).json({
          success: false,
          code: "DL_NUMBER_LOCKED",
          message:
            "You can change your driving licence number once your current booking is completed. If it's wrong, ask the branch to correct it.",
        });
      }
    }

    // Numbers omitted by an old client keep their stored values.
    const drivingLicenceNumber =
      data.drivingLicenceNumber ?? user.customerProfile?.drivingLicenceNumber ?? null;
    const aadhaarNumber =
      data.aadhaarNumber ?? user.customerProfile?.aadhaarNumber ?? null;

    // Age / date of birth omitted keep their stored values
    const age = data.age ?? user.customerProfile?.age ?? null;
    const dob = data.dob ?? user.customerProfile?.dob ?? null;

    // Check if profile is completed (age, or dob / both numbers for old profiles)
    const isProfileCompleted =
      getMissingProfileFields({ ...data, age, dob, drivingLicenceNumber, aadhaarNumber }).length === 0;

    // Transaction to update User and Upsert Customer
    const updatedProfile = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { publicId },
        data: {
          name: data.name,
          phone: data.phone,
        },
      });
      const updatedCustomer = await tx.customer.upsert({
        where: { userId: user.id },
        update: {
          dob: data.dob,
          ...(data.age !== undefined ? { age: data.age } : {}),
          addressLine1: data.addressLine1,
          city: data.city,
          state: data.state,
          country: data.country,
          zipCode: data.zipCode,
          alternatePhone: data.alternatePhone,
          drivingLicenceNumber,
          aadhaarNumber,
          isProfileCompleted,
        },
        create: {
          userId: user.id,
          publicId: createID(),
          dob: data.dob,
          age: data.age ?? null,
          addressLine1: data.addressLine1,
          city: data.city,
          state: data.state,
          country: data.country,
          zipCode: data.zipCode,
          alternatePhone: data.alternatePhone,
          drivingLicenceNumber,
          aadhaarNumber,
          isProfileCompleted,
        },
      });

      return {
        ...updatedUser,
        customerProfile: updatedCustomer,
      };
    });

    const missingFields = getMissingProfileFields(
      profileFieldsOf(updatedProfile, updatedProfile.customerProfile),
    );

    return res.status(StatusCode.OK).json({
      message: "Profile updated successfully",
      isProfileCompleted: updatedProfile.customerProfile.isProfileCompleted,
      missingFields,
      data: {
        name: updatedProfile.name,
        email: displayEmail(updatedProfile.email),
        phone: updatedProfile.phone,
        dob: updatedProfile.customerProfile.dob,
        age: effectiveCustomerAge(updatedProfile.customerProfile),
        addressLine1: updatedProfile.customerProfile.addressLine1,
        city: updatedProfile.customerProfile.city,
        state: updatedProfile.customerProfile.state,
        country: updatedProfile.customerProfile.country,
        zipCode: updatedProfile.customerProfile.zipCode,
        alternatePhone: updatedProfile.customerProfile.alternatePhone,
        drivingLicenceNumber: updatedProfile.customerProfile.drivingLicenceNumber,
        aadhaarNumber: updatedProfile.customerProfile.aadhaarNumber,
      },
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
