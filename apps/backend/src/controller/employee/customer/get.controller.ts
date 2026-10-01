import { Request, Response } from "express";
import { prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode.js";
import {
  displayEmail,
  getMissingProfileFields,
  profileFieldsOf,
} from "../../../utils/customer/identity.js";
import { getCustomerQrPhotoFields } from "../../../services/qr-photo/customer-qr-photo.service.js";

export const GetCustomerDetails = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;

    if (!publicId) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Customer Public ID is required",
      });
    }

    const customer = await prisma.user.findUnique({
      where: { publicId },
      select: {
        name: true,
        email: true,
        phone: true,
        role: true,
        customerProfile: {
          select: {
            dob: true,
            addressLine1: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
            isProfileCompleted: true,
            drivingLicenceNumber: true,
            aadhaarNumber: true,
          },
        },
      },
    });

    // Staff only ever look up customers here (the response carries identity numbers).
    if (!customer || customer.role !== Role.CUSTOMER) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Customer not found",
      });
    }

    const missingFields = getMissingProfileFields(
      profileFieldsOf(customer, customer.customerProfile),
    );

    // Customer QR code photo (#4) — presigned, never the raw R2 key.
    const qrPhotoFields = await getCustomerQrPhotoFields(publicId);

    return res.status(StatusCode.OK).json({
      message: "Customer details fetched",
      data: {
        name: customer.name,
        // null when the customer has only a walk-in placeholder email.
        email: displayEmail(customer.email),
        phone: customer.phone,
        ...customer.customerProfile,
        // Full numbers: this staff detail view prefills the complete-profile
        // forms. Completeness is derived from the stored values (#1).
        ...(customer.customerProfile
          ? {
              isProfileCompleted: missingFields.length === 0,
              drivingLicenceNumber: customer.customerProfile.drivingLicenceNumber ?? null,
              aadhaarNumber: customer.customerProfile.aadhaarNumber ?? null,
            }
          : {}),
        missingFields,
        ...qrPhotoFields,
      },
    });
  } catch (error) {
    console.error("Error fetching customer details:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
