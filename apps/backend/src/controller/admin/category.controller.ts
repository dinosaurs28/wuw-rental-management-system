import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";

/**
 * Get all vehicle categories for filtering
 */
export const GetAllCategories = async (req: Request, res: Response) => {
  try {
    const categories = await prisma.vehicleCategory.findMany({
      select: {
        publicId: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return res.status(StatusCode.OK).json({
      message: "Categories retrieved successfully",
      data: categories,
    });
  } catch (error) {
    console.error("Get Categories Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
