import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { calculatePricingForVehicle } from "../../utils/pricing/calcPricing.js";
import { getVehicleDetailsSchema } from "@repo/schemas";
import { calculatePricingForVehicleFromRecord } from "../../utils/pricing/calcPricingInd.js";
import { calculateMultiDayTotalPrice } from "../../utils/pricing/calcMultiDayPrice.js";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability.js";
import { getDepositAmount } from "../../utils/pricing/getDepositAmount.js";
import { getDiscountForDays } from "../../utils/pricing/getDiscountForDays.js";

export const getPublicVehicles = async (req: Request, res: Response) => {
  try {
    const {
      category,
      branch,
      search,
      model,
      make,
      sort,
      start,
      end,
      limit = "50",
      offset = "0",
    } = req.query as any;

    // Parse and validate dates if provided
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    if (start) {
      // Force UTC parsing
      startDate = new Date(`${start}T00:00:00Z`);

      if (end) {
        endDate = new Date(`${end}T00:00:00Z`);
      } else {
        // Default to same day if end date missing
        endDate = new Date(startDate);
      }

      // Update end date to end of day for full availability check
      endDate.setUTCHours(23, 59, 59, 999);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Invalid start or end date format",
        });
      }
    }

    const cacheKey = `public:vehicles:${category || "all"}:${branch || "all"}:${
      search || "all"
    }:${make || "all"}:${model || "all"}:${sort || "none"}:${start || "all"}:${end || "all"}:${limit}:${offset}`;

    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.status(StatusCode.OK).json(JSON.parse(cachedData));
    }
    const filters: any = {
      status: "AVAILABLE",
      deletedAt: null,
      insuranceExpiry: {
        gt: new Date(), // Only show vehicles with valid insurance
      },
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
        images: {
          where: {
            isThumbnail: true,
          },
          select: {
            file: {
              select: { url: true },
            },
          },
        },
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
          v.make.toLowerCase().includes(t) || v.model.toLowerCase().includes(t),
      );
    }

    if (make) {
      const t = make.toLowerCase();
      filteredVehicles = filteredVehicles.filter((v) =>
        v.make.toLowerCase().includes(t),
      );
    }

    if (model) {
      const t = model.toLowerCase();
      filteredVehicles = filteredVehicles.filter((v) =>
        v.model.toLowerCase().includes(t),
      );
    }

    const finalResponse = [];
    for (const v of filteredVehicles) {
      // Check availability if dates are provided
      if (startDate && endDate) {
        const isAvailable = await checkVehicleAvailability(
          v.id,
          startDate,
          endDate,
        );
        if (!isAvailable) {
          continue; // Skip vehicles that are not available for the selected dates
        }
      }

      const pricing = await calculatePricingForVehicle(v.id);

      finalResponse.push({
        publicId: v.publicId,
        make: v.make,
        model: v.model,
        category: v.category.name,
        branch: v.branch.name,
        imageUrl: v.images,
        pricing: {
          daily: pricing.daily,
        },
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

export const getPublicVehiclesDetails = async (req: Request, res: Response) => {
  try {
    const parasedData = getVehicleDetailsSchema.safeParse(req.params);
    if (!parasedData.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: parasedData.error.flatten(),
      });
    }
    const { start, end } = req.query as { start?: string; end?: string };

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (start) {
      // Force UTC parsing
      startDate = new Date(`${start}T00:00:00Z`);

      if (end) {
        endDate = new Date(`${end}T00:00:00Z`);
      } else {
        endDate = new Date(startDate);
      }

      // Update end date to end of day for full availability check
      endDate.setUTCHours(23, 59, 59, 999);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Invalid start or end date format",
        });
      }
    }
    const vehicleData = await prisma.vehicle.findUnique({
      where: { publicId: parasedData.data.id },
      include: {
        category: true,
        branch: {
          include: { pricingSetting: true },
        },
        images: {
          include: {
            file: true,
          },
        },
        pricingOverride: true,
      },
    });
    if (!vehicleData) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Vehicle details could not be found for the provided ID.",
      });
    }
    const pricing = await calculatePricingForVehicleFromRecord(vehicleData);
    const deposit = await getDepositAmount(
      vehicleData.branchId,
      vehicleData.categoryId,
    );
    let availability: boolean | null = null;
    let totalPrice: number | null = null;
    let totalDays: number | null = null;
    let baseTotal: number | null = null;
    let discountPrice: number | null = null;

    // Check insurance expiry
    const isInsuranceValid = new Date(vehicleData.insuranceExpiry) > new Date();

    if (startDate && endDate) {
      if (!isInsuranceValid) {
        availability = false; // Not available if insurance expired
      } else {
        availability = await checkVehicleAvailability(
          vehicleData.id,
          startDate,
          endDate,
        );
      }

      const multi = calculateMultiDayTotalPrice(
        startDate,
        endDate,
        pricing.daily,
      );
      baseTotal = multi.total;
      totalDays = multi.days;
      const discountPercent = await getDiscountForDays(
        vehicleData.branchId,
        vehicleData.categoryId,
        totalDays,
      );
      const finalTotal = baseTotal * (1 - discountPercent);
      totalPrice = Number(finalTotal.toFixed(2));
      discountPrice = Number((baseTotal - finalTotal).toFixed(2));
    } else if (!isInsuranceValid) {
      // If no dates provided but insurance expired, mark as explicitly unavailable
      availability = false;
    }
    const imageUrls = vehicleData.images.map((img) => img.file.url);
    const response = {
      publicId: vehicleData.publicId,
      make: vehicleData.make,
      model: vehicleData.model,
      status: vehicleData.status,
      category: vehicleData.category.name,
      branch: vehicleData.branch.name,
      images: imageUrls,
      pricing: {
        daily: pricing.daily,
      },
      deposit,
      availability,
      totalDays,
      baseTotal,
      discountPrice,
    };

    return res.status(StatusCode.OK).json({
      message: "Success",
      data: response,
    });
  } catch (e: any) {
    console.log("Internal Error While Fetching the Vehicle Details", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Error While Fetching the Vehicle Details",
    });
  }
};
