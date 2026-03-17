import { Request, Response } from "express";
import { StatusCode } from "../../../types/statusCode.js";
import { prisma } from "@repo/database/client";

export const GetCustomerKyc = async (req: Request, res: Response) => {
  const { customerPublicId } = req.params;

  if (!customerPublicId) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Customer Public ID is required",
    });
  }

  try {
    const actingUser = await prisma.user.findUnique({
      where: { publicId: customerPublicId },
      select: {
        customerProfile: {
          select: {
            publicId: true,
            kycs: {
              select: {
                id: true,
                publicId: true,
                customerId: true,
                type: true,
                status: true,
                fileId: true,
                createdAt: true,
                file: {
                  select: {
                    id: true,
                    publicId: true,
                    key: true,
                    url: true,
                    mime: true,
                    size: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!actingUser || !actingUser.customerProfile) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Customer not found",
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Customer KYC fetched successfully",
      data: actingUser.customerProfile.kycs.map((kyc) => ({
        id: kyc.id,
        publicId: kyc.publicId,
        customerId: kyc.customerId,
        type: kyc.type,
        status: kyc.status,
        fileId: kyc.fileId,
        createdAt: kyc.createdAt,
        file: {
          id: kyc.file.id,
          publicId: kyc.file.publicId,
          key: kyc.file.key,
          url: kyc.file.url,
          mime: kyc.file.mime,
          size: kyc.file.size,
        },
      })),
    });
  } catch (error) {
    console.error("Error fetching Customer KYC:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
