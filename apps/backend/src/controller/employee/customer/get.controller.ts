import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode.js";

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
        customerProfile: {
          select: {
            dob: true,
            addressLine1: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
            isProfileCompleted: true,
          },
        },
      },
    });

    if (!customer) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Customer not found",
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Customer details fetched",
      data: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        ...customer.customerProfile,
      },
    });
  } catch (error) {
    console.error("Error fetching customer details:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
