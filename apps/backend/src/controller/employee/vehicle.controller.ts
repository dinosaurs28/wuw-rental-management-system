import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { getVehicleDetailsSchema } from "@repo/schemas";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability.js";
import { getUnavailableVehicleIds } from "../../utils/availability/availabilityBatch.js";
import { getDepositAmount } from "../../utils/pricing/getDepositAmount.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import {
  getBatchListingPrices,
  getBatchFallbackPrices,
  type ListingPrice,
} from "../../utils/pricing/batchListingPrice.js";
import { DateTime } from "luxon";

const pricingEngine = new PricingEngineService();

function buildGroupKey(make: string, model: string, categoryId: number, branchId: number): string {
  return `${make}__${model}__${categoryId}__${branchId}`;
}

function parseGroupKey(groupKey: string): { make: string; model: string; categoryId: number; branchId: number } | null {
  const idx = groupKey.indexOf("__");
  if (idx === -1) return null;
  const rest1 = groupKey.slice(idx + 2);
  const idx2 = rest1.indexOf("__");
  if (idx2 === -1) return null;
  const rest2 = rest1.slice(idx2 + 2);
  const idx3 = rest2.indexOf("__");
  if (idx3 === -1) return null;
  const make = groupKey.slice(0, idx);
  const model = rest1.slice(0, idx2);
  const categoryId = parseInt(rest2.slice(0, idx3), 10);
  const branchId = parseInt(rest2.slice(idx3 + 2), 10);
  if (isNaN(categoryId) || isNaN(branchId)) return null;
  return { make, model, categoryId, branchId };
}

export { parseGroupKey };

export const searchVehicles = async (req: Request, res: Response) => {
  try {
    const {
      search,
      model,
      make,
      category,
      sort,
      start,
      end,
      limit = "20",
      offset = "0",
    } = req.query as any;

    const branchId = req.branch_Id;
    const limitNum = Number(limit);
    const offsetNum = Number(offset);

    let startDate: DateTime | null = null;
    let endDate: DateTime | null = null;

    if (start) {
      startDate = TimezoneService.parseISO(start as string);
      endDate = end ? TimezoneService.parseISO(end as string) : startDate.plus({ hours: 24 });
      if (startDate.toMillis() === endDate!.toMillis()) endDate = startDate.plus({ hours: 24 });
      if (!startDate?.isValid || !endDate?.isValid) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid date format" });
      }
    }

    const cacheKey = `employee:vehicles:grouped:${branchId}:${search || "all"}:${model || "all"}:${make || "all"}:${category || "all"}:${sort || "none"}:${start || "none"}:${end || "none"}:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) return res.status(StatusCode.OK).json(JSON.parse(cached));

    const where: any = {
      branchId,
      status: "AVAILABLE",
      deletedAt: null,
      insuranceExpiry: { gt: new Date() },
    };

    if (search) {
      where.OR = [
        { make: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
      ];
    }
    if (model) where.model = { contains: model, mode: "insensitive" };
    if (make) where.make = { contains: make, mode: "insensitive" };
    if (category) where.category = { publicId: category as string };

    const vehicles = await prisma.vehicle.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        images: {
          where: { isThumbnail: true },
          select: { file: { select: { url: true } } },
        },
        pricingOverride: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (vehicles.length === 0) {
      return res.status(StatusCode.OK).json({ data: [], pagination: { total: 0, limit: limitNum, offset: offsetNum } });
    }

    // Batch availability filter
    let availableVehicles = vehicles;
    if (startDate && endDate) {
      const startPrisma = TimezoneService.toPrisma(startDate);
      const endPrisma = TimezoneService.toPrisma(endDate);
      const vehicleIdToPublicId = new Map(vehicles.map((v) => [v.id, v.publicId]));
      const unavailableIds = await getUnavailableVehicleIds(
        vehicles.map((v) => v.id),
        startPrisma,
        endPrisma,
        vehicleIdToPublicId,
      );
      availableVehicles = vehicles.filter((v) => !unavailableIds.has(v.id));
    }

    if (availableVehicles.length === 0) {
      return res.status(StatusCode.OK).json({ data: [], pagination: { total: 0, limit: limitNum, offset: offsetNum } });
    }

    // Batch pricing
    let durationInfo: ReturnType<typeof DurationCalculatorService.calculate> | null = null;
    let durationPriceMap: Map<number, ListingPrice> | null = null;
    let fallbackPriceMap: Map<number, { daily: number; hourly: number; halfDay: number }> | null = null;

    if (startDate && endDate) {
      durationInfo = DurationCalculatorService.calculate(startDate, endDate);
      durationPriceMap = await getBatchListingPrices(availableVehicles, durationInfo);
    } else {
      fallbackPriceMap = await getBatchFallbackPrices(availableVehicles);
    }

    // Group by make+model+category+branch
    interface GroupEntry {
      groupKey: string;
      make: string;
      model: string;
      category: string;
      branch: string;
      availableCount: number;
      imageUrl: any[];
      pricing: { daily: number; hourly?: number; halfDay?: number };
      pricingDetails?: { price: number; finalPrice: number; type: string };
      minDailyPrice: number;
    }

    const groupMap = new Map<string, GroupEntry>();

    for (const v of availableVehicles) {
      const gk = buildGroupKey(v.make, v.model, v.categoryId, v.branchId);

      let daily = 0;
      let hourly: number | undefined;
      let halfDay: number | undefined;
      let pricingDetails: GroupEntry["pricingDetails"];

      if (durationPriceMap && durationInfo) {
        const lp = durationPriceMap.get(v.id);
        daily = lp?.finalPrice ?? 0;
        pricingDetails = { price: lp?.price ?? 0, finalPrice: daily, type: durationInfo.periodType };
      } else {
        const fp = fallbackPriceMap?.get(v.id);
        daily = fp?.daily ?? 0;
        hourly = fp?.hourly;
        halfDay = fp?.halfDay;
      }

      const existing = groupMap.get(gk);
      if (!existing) {
        groupMap.set(gk, {
          groupKey: gk,
          make: v.make,
          model: v.model,
          category: v.category.name,
          branch: v.branch.name,
          availableCount: 1,
          imageUrl: v.images,
          pricing: { daily, ...(hourly !== undefined ? { hourly } : {}), ...(halfDay !== undefined ? { halfDay } : {}) },
          pricingDetails,
          minDailyPrice: daily,
        });
      } else {
        existing.availableCount++;
        if (daily < existing.minDailyPrice) {
          existing.minDailyPrice = daily;
          existing.imageUrl = v.images;
          existing.pricing = { daily, ...(hourly !== undefined ? { hourly } : {}), ...(halfDay !== undefined ? { halfDay } : {}) };
          existing.pricingDetails = pricingDetails;
        }
      }
    }

    const allGroups = Array.from(groupMap.values()).map((g) => ({
      groupKey: g.groupKey,
      make: g.make,
      model: g.model,
      category: g.category,
      branch: g.branch,
      availableCount: g.availableCount,
      imageUrl: g.imageUrl,
      pricing: g.pricing,
      pricingDetails: g.pricingDetails,
    }));

    if (sort === "price_low_to_high") {
      allGroups.sort((a, b) => a.pricing.daily - b.pricing.daily);
    } else if (sort === "price_high_to_low") {
      allGroups.sort((a, b) => b.pricing.daily - a.pricing.daily);
    }

    const paginatedGroups = allGroups.slice(offsetNum, offsetNum + limitNum);
    const response = {
      data: paginatedGroups,
      pagination: { total: allGroups.length, limit: limitNum, offset: offsetNum },
    };

    await redis.setex(cacheKey, 60, JSON.stringify(response));
    return res.status(StatusCode.OK).json(response);
  } catch (error) {
    console.error("Employee search vehicles error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const getEmployeeVehicleGroupDetails = async (req: Request, res: Response) => {
  try {
    const groupKey = decodeURIComponent(req.params.groupKey ?? "");
    const parsed = parseGroupKey(groupKey);
    if (!parsed) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid group key format" });
    }
    const { make, model, categoryId, branchId } = parsed;

    // Scoped to the employee's branch
    if (branchId !== req.branch_Id) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Group not accessible from this branch" });
    }

    const { start, end } = req.query as { start?: string; end?: string };

    let startDate: DateTime | null = null;
    let endDate: DateTime | null = null;

    if (start) {
      startDate = TimezoneService.parseISO(start);
      endDate = end ? TimezoneService.parseISO(end) : startDate.plus({ hours: 24 });
      if (startDate.toMillis() === endDate!.toMillis()) endDate = startDate.plus({ hours: 24 });
      if (!startDate.isValid || !endDate!.isValid) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid date format" });
      }
    }

    const cacheKey = `employee:vehicles:group:${groupKey}:${start || "nodate"}:${end || "nodate"}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.status(StatusCode.OK).json(JSON.parse(cached));
    } catch { /* non-fatal */ }

    const groupVehicles = await prisma.vehicle.findMany({
      where: { make, model, categoryId, branchId, deletedAt: null, insuranceExpiry: { gt: new Date() } },
      select: {
        id: true,
        publicId: true,
        make: true,
        model: true,
        odo: true,
        fuelLevel: true,
        advancePayAmount: true,
        insuranceExpiry: true,
        status: true,
        fastagNumber: true,
        hasFastag: true,
        branchId: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
        branch:   { select: { id: true, name: true } },
        images:   { where: { isThumbnail: false }, include: { file: true } },
        customPricing: true,
        pricingOverride: true,
      },
      orderBy: { odo: "asc" },
    });

    if (groupVehicles.length === 0) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No vehicles found for this group" });
    }

    const bookableVehicles = groupVehicles.filter((v) => v.status === "AVAILABLE");
    let availableCount: number;
    let representativeVehicle = bookableVehicles[0] ?? groupVehicles[0]!;

    if (startDate && endDate) {
      const startPrisma = TimezoneService.toPrisma(startDate);
      const endPrisma   = TimezoneService.toPrisma(endDate);
      const vehicleIdToPublicId = new Map(bookableVehicles.map((v) => [v.id, v.publicId]));
      const unavailableIds = await getUnavailableVehicleIds(
        bookableVehicles.map((v) => v.id),
        startPrisma,
        endPrisma,
        vehicleIdToPublicId,
      );
      availableCount = bookableVehicles.filter((v) => !unavailableIds.has(v.id)).length;
      const firstAvailable = bookableVehicles.find((v) => !unavailableIds.has(v.id));
      if (firstAvailable) representativeVehicle = firstAvailable;
    } else {
      availableCount = bookableVehicles.length;
    }

    const allImages: string[] = representativeVehicle.images.map((img) => img.file.url);

    let pricingDetails: any = null;
    let deposit = 0;
    let availability: boolean | null = null;

    if (startDate && endDate) {
      availability = availableCount > 0;
      const isInsuranceValid = new Date(representativeVehicle.insuranceExpiry) > new Date();
      if (isInsuranceValid && availability) {
        try {
          const pr = await pricingEngine.calculateBookingPrice(
            representativeVehicle.id,
            startDate,
            endDate,
            representativeVehicle.branchId,
            undefined,
            undefined,
            undefined,
            undefined,
            representativeVehicle.categoryId,
            representativeVehicle.customPricing,
          );
          deposit = Number(pr.deposit);
          pricingDetails = {
            basePrice:        Number(pr.basePrice),
            discountAmount:   Number(pr.discountAmount),
            discountPercent:  Number(pr.discountPercent),
            deposit:          Number(pr.deposit),
            taxAmount:        Number(pr.taxAmount),
            cgstAmount:       Number(pr.cgstAmount),
            sgstAmount:       Number(pr.sgstAmount),
            taxRate:          Number(pr.taxRate),
            finalTotal:       Number(pr.finalTotal),
            freeKmLimit:      pr.freeKmLimit,
            extraKmRate:      Number(pr.extraKmRate),
            pricingBreakdown: {
              periodType:      pr.pricingBreakdown.periodType,
              duration:        pr.pricingBreakdown.duration,
              applicablePrice: Number(pr.pricingBreakdown.applicablePrice),
              priceSource:     pr.pricingBreakdown.priceSource,
            },
          };
        } catch { /* pricing failure is non-fatal */ }
      }
    }

    const firstCat = groupVehicles[0]!.category;
    const firstBranch = groupVehicles[0]!.branch;

    const data = {
      groupKey,
      make,
      model,
      category:         firstCat.name,
      branch:           firstBranch.name,
      availableCount,
      totalCount:       groupVehicles.length,
      images:           allImages,
      pricing:          { daily: pricingDetails?.pricingBreakdown?.applicablePrice ?? null },
      deposit,
      availability,
      pricingDetails,
      advancePayAmount: Number(representativeVehicle.advancePayAmount ?? 0),
    };

    const responseBody = { message: "Success", data };
    try { await redis.setex(cacheKey, 30, JSON.stringify(responseBody)); } catch { /* non-fatal */ }
    return res.status(StatusCode.OK).json(responseBody);
  } catch (error) {
    console.error("Employee vehicle group details error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const getEmployeeVehicleDetails = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const { start, end } = req.query;
    let startDate: DateTime | null = null;
    let endDate: DateTime | null = null;

    if (start) {
      startDate = TimezoneService.parseISO(start as string);

      if (end) {
        endDate = TimezoneService.parseISO(end as string);
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

    const vehicleData = await prisma.vehicle.findFirst({
      where: {
        publicId: id,
        branchId: req.branch_Id,
      },
      include: {
        category: true,
        branch: { include: { pricingSetting: true } },
        images: { include: { file: true } },
        pricingOverride: true,
      },
    });

    if (!vehicleData) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Vehicle not found" });
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
      const isBookableStatus = ["AVAILABLE", "OUT_FOR_RENTAL"].includes(
        vehicleData.status,
      );
      if (!isInsuranceValid || !isBookableStatus) {
        availability = false; // Not available if insurance expired or status not bookable
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

    let fallbackPricing: { daily: number; hourly: number; halfDay: number } | null = null;
    if (!pricingDetails) {
      const fp = await getBatchFallbackPrices([
        { id: vehicleData.id, branchId: vehicleData.branchId, categoryId: vehicleData.categoryId },
      ]);
      fallbackPricing = fp.get(vehicleData.id) ?? { daily: 0, hourly: 0, halfDay: 0 };
    }

    return res.status(StatusCode.OK).json({
      message: "Success",
      data: {
        publicId: vehicleData.publicId,
        make: vehicleData.make,
        model: vehicleData.model,
        status: vehicleData.status,
        category: vehicleData.category.name,
        branch: vehicleData.branch.name,
        images: imageUrls,
        pricing: pricingDetails
          ? { daily: pricingDetails.pricingBreakdown.applicablePrice }
          : {
              daily:   fallbackPricing!.daily,
              hourly:  fallbackPricing!.hourly,
              halfDay: fallbackPricing!.halfDay,
            },
        pricingDetails,
        deposit,
        availability,
      },
    });
  } catch (error) {
    console.error("Employee vehicle details error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Error" });
  }
};

export const getEmployeeVehicleCategories = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const cacheKey = `employee:branch:${branchId}:categories`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.status(StatusCode.OK).json({
        message: "Categories fetched successfully",
        data: JSON.parse(cached),
      });
    }

    // Only return categories that have at least one active vehicle in this branch
    const categories = await prisma.vehicleCategory.findMany({
      where: {
        vehicles: {
          some: {
            branchId,
            status: { in: ["AVAILABLE", "OUT_FOR_RENTAL"] },
            deletedAt: null,
          },
        },
      },
      select: {
        publicId: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    await redis.setex(cacheKey, 120, JSON.stringify(categories));

    return res.status(StatusCode.OK).json({
      message: "Categories fetched successfully",
      data: categories,
    });
  } catch (error) {
    console.error("[getEmployeeVehicleCategories] Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
