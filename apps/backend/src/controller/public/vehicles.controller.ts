import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { calculatePricingForVehicle } from "../../utils/pricing/calcPricing.js";
import { getVehicleDetailsSchema } from "@repo/schemas";
import { calculatePricingForVehicleFromRecord } from "../../utils/pricing/calcPricingInd.js";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability.js";
import { getDepositAmount } from "../../utils/pricing/getDepositAmount.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import { DateTime } from "luxon";

const pricingEngine = new PricingEngineService();

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
    let startDate: DateTime | null = null;
    let endDate: DateTime | null = null;

    if (start) {
      startDate = TimezoneService.parseISO(start);

      if (end) {
        endDate = TimezoneService.parseISO(end);
      } else {
        // Fallback: Default to 24 hours if end date missing
        endDate = startDate.plus({ hours: 24 });
      }

      if (startDate.toMillis() === endDate.toMillis()) {
        // Fallback: Default to 24 hours if same exact time
        endDate = startDate.plus({ hours: 24 });
      }

      if (!startDate?.isValid || !endDate?.isValid) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Invalid start or end date format",
        });
      }
    }

    const cacheKey = `public:vehicles:${category || "all"}:${branch || "all"}:${
      search || "all"
    }:${make || "all"}:${model || "all"}:${sort || "none"}:${start || "all"}:${end || "all"}:${limit}:${offset}`;

    let cachedData = null;
    try {
      cachedData = await redis.get(cacheKey);
    } catch (redisErr) {
      console.warn("Redis get error:", redisErr);
    }
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
      let pricingDetails: any = undefined;

      if (startDate && endDate) {
        const isAvailable = await checkVehicleAvailability(
          v.id,
          TimezoneService.toPrisma(startDate),
          TimezoneService.toPrisma(endDate),
        );
        if (!isAvailable) {
          continue; // Skip vehicles that are not available for the selected dates
        }

        const pricingResult = await pricingEngine.calculateListingPrice(
          v.id,
          startDate,
          endDate,
          v.branchId,
        );

        pricingDetails = {
          price: Number(pricingResult.price),
          finalPrice: Number(pricingResult.finalPrice),
          type: pricingResult.type,
        };
      }

      let fallbackPricing: any = null;
      if (!pricingDetails) {
        fallbackPricing = await calculatePricingForVehicle(v.id);
      }

      finalResponse.push({
        publicId: v.publicId,
        make: v.make,
        model: v.model,
        category: v.category.name,
        branch: v.branch.name,
        imageUrl: v.images,
        pricing: pricingDetails
          ? {
              daily: pricingDetails.price,
            }
          : {
              daily: fallbackPricing.daily,
              hourly: fallbackPricing.hourly,
              halfDay: fallbackPricing.halfDay,
            },
        pricingDetails,
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

    try {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 60);
    } catch (redisErr) {
      console.warn("Redis set error:", redisErr);
    }

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

    let startDate: DateTime | null = null;
    let endDate: DateTime | null = null;

    if (start) {
      // Fix: Use parseISO instead of parseUserDateTime since query params are typically full ISO strings from frontend
      startDate = TimezoneService.parseISO(start);

      if (end) {
        endDate = TimezoneService.parseISO(end);
      } else {
        endDate = startDate.plus({ hours: 24 });
      }

      if (startDate.toMillis() === endDate.toMillis()) {
        endDate = startDate.plus({ hours: 24 });
      }

      if (!startDate?.isValid || !endDate?.isValid) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Invalid start or end date format",
        });
      }
    }
    const vehicleData = await prisma.vehicle.findUnique({
      where: { publicId: parasedData.data.id },
      select: {
        id: true,
        publicId: true,
        make: true,
        model: true,
        regNo: true,
        odo: true,
        fuelLevel: true,
        advancePayAmount: true,
        insuranceExpiry: true,
        status: true,
        branchId: true,
        categoryId: true,
        createdAt: true,
        updatedAt: true,
        category: true,
        branch: {
          include: { pricingSetting: true },
        },
        images: {
          include: { file: true },
        },
        pricingOverride: true,
        customPricing: true,
      },
    });
    if (!vehicleData) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Vehicle details could not be found for the provided ID.",
      });
    }

    let deposit = await getDepositAmount(
      vehicleData.branchId,
      vehicleData.categoryId,
    );
    let availability: boolean | null = null;
    let pricingDetails: any = null;

    // Check insurance expiry
    const isInsuranceValid = new Date(vehicleData.insuranceExpiry) > new Date();

    if (startDate && endDate) {
      if (!isInsuranceValid) {
        availability = false; // Not available if insurance expired
      } else {
        availability = await checkVehicleAvailability(
          vehicleData.id,
          TimezoneService.toPrisma(startDate),
          TimezoneService.toPrisma(endDate),
        );
      }

      // Calculate pricing via Phase 2 Pricing Engine
      const pricingResult = await pricingEngine.calculateBookingPrice(
        vehicleData.id,
        startDate,
        endDate,
        vehicleData.branchId,
      );

      pricingDetails = {
        basePrice: Number(pricingResult.basePrice),
        discountAmount: Number(pricingResult.discountAmount),
        discountPercent: Number(pricingResult.discountPercent),
        deposit: Number(pricingResult.deposit),
        taxAmount: Number(pricingResult.taxAmount),
        cgstAmount: Number(pricingResult.cgstAmount),
        sgstAmount: Number(pricingResult.sgstAmount),
        taxRate: Number(pricingResult.taxRate),
        finalTotal: Number(pricingResult.finalTotal),
        freeKmLimit: pricingResult.freeKmLimit,
        extraKmRate: Number(pricingResult.extraKmRate),
        pricingBreakdown: {
          periodType: pricingResult.pricingBreakdown.periodType,
          duration: pricingResult.pricingBreakdown.duration,
          applicablePrice: Number(
            pricingResult.pricingBreakdown.applicablePrice,
          ),
          priceSource: pricingResult.pricingBreakdown.priceSource,
        },
      };

      deposit = pricingDetails.deposit;
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
      advancePayAmount: vehicleData.advancePayAmount,
      images: imageUrls,
      pricing: {
        daily: pricingDetails?.pricingBreakdown?.applicablePrice,
      },
      deposit,
      availability,
      pricingDetails,
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
