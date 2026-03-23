import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";

export const getPublicCategories = async (req: Request, res: Response) => {
  try {
    const cacheKey = "public:categories";
    const cachedCategories = await redis.get(cacheKey);

    if (cachedCategories) {
      return res.status(StatusCode.OK).json({
        message: "Categories fetched successfully",
        data: JSON.parse(cachedCategories),
      });
    }

    const categories = await prisma.vehicleCategory.findMany({
      select: {
        id: true,
        publicId: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    await redis.setex(cacheKey, 300, JSON.stringify(categories));

    return res.status(StatusCode.OK).json({
      message: "Categories fetched successfully",
      data: categories,
    });
  } catch (error) {
    console.error("Get Public Categories Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal server error",
    });
  }
};
