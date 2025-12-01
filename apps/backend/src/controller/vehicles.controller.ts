import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../types/statusCode";
import { redis } from "../lib/redisconfig";
import { calculatePricingForVehicle } from "../utils/pricing/calcPricing";

export const getPublicVehicles = async (req: Request, res: Response) => {
  try {
    const {
      category,
      branch,
      search,
      model,
      make,
      sort,
      limit = "50",
      offset = "0",
    } = req.query as any;

    const cacheKey = `public:vehicles:${category || "all"}:${branch || "all"}:${search || "all"
      }:${make || "all"}:${model || "all"}:${sort || "none"}:${limit}:${offset}`;

    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.status(StatusCode.OK).json(JSON.parse(cachedData));
    }
    const filters: any = {
      status: "AVAILABLE",
      deletedAt: null,
    };

    if (category) {
      const categoryObj = await prisma.vehicleCategory.findUnique({
        where: { publicId: category },
        select: { id: true },
      });

      if (!categoryObj) {
        return res.status(404).json({ message: "Invalid category" });
      }

      filters.categoryId = categoryObj.id;
    }

    if (branch) {
      const branchObj = await prisma.branch.findFirst({
        where: {
          OR: [
            { publicId: branch },
            { name: { contains: branch, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });

      if (!branchObj) {
        return res.status(404).json({ message: "Invalid branch" });
      }

      filters.branchId = branchObj.id;
    }

    const vehicles = await prisma.vehicle.findMany({
      where: filters,
      skip: Number(offset),
      take: Number(limit),
      include: {
        category: true,
        branch: true,
      },
      orderBy:
        sort === "price_low_to_high"
          ? { id: "asc" }
          : sort === "price_high_to_low"
            ? { id: "desc" }
            : { createdAt: "desc" },
    });

    if (vehicles.length === 0) {
      return res.status(StatusCode.OK).json({ count: 0, data: [] });
    }

    let filteredVehicles = vehicles;

    if (search) {
      const t = search.toLowerCase();
      filteredVehicles = filteredVehicles.filter(
        (v) =>
          v.make.toLowerCase().includes(t) ||
          v.model.toLowerCase().includes(t)
      );
    }

    if (make) {
      const t = make.toLowerCase();
      filteredVehicles = filteredVehicles.filter((v) =>
        v.make.toLowerCase().includes(t)
      );
    }

    if (model) {
      const t = model.toLowerCase();
      filteredVehicles = filteredVehicles.filter((v) =>
        v.model.toLowerCase().includes(t)
      );
    }

    const finalResponse = [];
    for (const v of filteredVehicles) {
      const pricing = await calculatePricingForVehicle(v.id);

      finalResponse.push({
        publicId: v.publicId,
        make: v.make,
        model: v.model,
        category: v.category.name,
        branch: v.branch.name,
        odo: v.odo,
        imageUrl: null,
        pricing,
      });
    }

    if (sort === "price_low_to_high") {
      finalResponse.sort((a, b) => a.pricing.daily - b.pricing.daily);
    }

    if (sort === "price_high_to_low") {
      finalResponse.sort((a, b) => b.pricing.daily - a.pricing.daily);
    }

    const result = {
      count: finalResponse.length,
      data: finalResponse,
    };

    await redis.set(cacheKey, JSON.stringify(result), "EX", 60);

    return res.status(StatusCode.OK).json(result);
  } catch (err) {
    console.error("Error fetching public vehicles:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal server error while fetching public vehicles",
    });
  }
};
