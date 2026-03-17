import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { updateProfileSchema } from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";

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

    return res.status(StatusCode.OK).json({
      name: user.name,
      email: user.email,
      phone: user.phone,
      dob: user.customerProfile?.dob || null,
      addressLine1: user.customerProfile?.addressLine1 || "",
      city: user.customerProfile?.city || "",
      state: user.customerProfile?.state || "",
      country: user.customerProfile?.country || "",
      zipCode: user.customerProfile?.zipCode || "",
      alternatePhone: user.customerProfile?.alternatePhone || "",
      isProfileCompleted: user.customerProfile?.isProfileCompleted || false,
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

    const validation = updateProfileSchema.safeParse(body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.errors,
      });
    }

    const data = validation.data;

    const user = await prisma.user.findUnique({ where: { publicId } });
    if (!user) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "User not found" });
    }

    // Check if profile is completed
    const isProfileCompleted = !!(
      data.name &&
      data.phone &&
      data.addressLine1 &&
      data.city &&
      data.state &&
      data.zipCode &&
      data.country
    );

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
          addressLine1: data.addressLine1,
          city: data.city,
          state: data.state,
          country: data.country,
          zipCode: data.zipCode,
          alternatePhone: data.alternatePhone,
          isProfileCompleted,
        },
        create: {
          userId: user.id,
          publicId: createID(),
          dob: data.dob,
          addressLine1: data.addressLine1,
          city: data.city,
          state: data.state,
          country: data.country,
          zipCode: data.zipCode,
          alternatePhone: data.alternatePhone,
          isProfileCompleted,
        },
      });

      return {
        ...updatedUser,
        customerProfile: updatedCustomer,
      };
    });

    return res.status(StatusCode.OK).json({
      message: "Profile updated successfully",
      isProfileCompleted: updatedProfile.customerProfile.isProfileCompleted,
      data: {
        name: updatedProfile.name,
        email: updatedProfile.email,
        phone: updatedProfile.phone,
        dob: updatedProfile.customerProfile.dob,
        addressLine1: updatedProfile.customerProfile.addressLine1,
        city: updatedProfile.customerProfile.city,
        state: updatedProfile.customerProfile.state,
        country: updatedProfile.customerProfile.country,
        zipCode: updatedProfile.customerProfile.zipCode,
        alternatePhone: updatedProfile.customerProfile.alternatePhone,
      },
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
