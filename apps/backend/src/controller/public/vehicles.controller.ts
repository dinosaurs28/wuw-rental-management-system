import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { getVehicleDetailsSchema } from "@repo/schemas";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { vehicleDetailsPricingKey } from "../../utils/cache/vehicleCacheKeys.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import { DateTime } from "luxon";
import { getUnavailableVehicleIds } from "../../utils/availability/availabilityBatch.js";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability.js";
import {
  getBatchListingPrices,
  getBatchFallbackPrices,
  ListingPrice,
} from "../../utils/pricing/batchListingPrice.js";

const pricingEngine = new PricingEngineService();

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeStr(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

function buildGroupKey(make: string, model: string, categoryId: number, branchId: number): string {
  return `${normalizeStr(make)}__${normalizeStr(model)}__${categoryId}__${branchId}`;
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

// ── Listing ───────────────────────────────────────────────────────────────────

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

    // Parse and validate dates
    let startDate: DateTime | null = null;
    let endDate: DateTime | null = null;

    if (start) {
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

    const cacheKey = `public:vehicles:grouped:${category || "all"}:${branch || "all"}:${
      search || "all"
    }:${make || "all"}:${model || "all"}:${sort || "none"}:${start || "all"}:${end || "all"}:${limit}:${offset}`;

    try {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) {
        return res.status(StatusCode.OK).json(JSON.parse(cachedData));
      }
    } catch (redisErr) {
      console.warn("[listing] Redis get error:", redisErr);
    }

    // ── Resolve category/branch filters ──────────────────────────────────────

    const filters: any = {
      status: "AVAILABLE",
      deletedAt: null,
      insuranceExpiry: { gt: new Date() },
    };

    // TASK-014: Parallelise category + branch filter resolution
    const [categoryObj, branchObj] = await Promise.all([
      category
        ? prisma.vehicleCategory.findUnique({ where: { publicId: category }, select: { id: true } })
        : Promise.resolve(null),
      branch
        ? prisma.branch.findFirst({
            where: { OR: [{ publicId: branch }, { name: { contains: branch, mode: "insensitive" } }] },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (category && !categoryObj) {
      return res.status(404).json({ message: "Invalid category" });
    }
    if (branch && !branchObj) {
      return res.status(404).json({ message: "Invalid branch" });
    }
    if (categoryObj) filters.categoryId = categoryObj.id;
    if (branchObj) filters.branchId = branchObj.id;

    // ── Fetch vehicles (single query, no skip/take — pagination applied after grouping) ───

    console.time("[perf] listing:vehicles-query");
    const vehicles = await prisma.vehicle.findMany({
      where: filters,
      include: {
        category: { select: { id: true, name: true } },
        branch:   { select: { id: true, name: true } },
        images: {
          where: { isThumbnail: true },
          select: { file: { select: { url: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    console.timeEnd("[perf] listing:vehicles-query");

    if (vehicles.length === 0) {
      return res.status(StatusCode.OK).json({ count: 0, data: [] });
    }

    // ── In-memory search/make/model filters ───────────────────────────────────

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

    // ── Batch availability check (TASK-006): 1 query for all vehicles ─────────

    let availableVehicles = filteredVehicles;

    if (startDate && endDate) {
      const startPrisma = TimezoneService.toPrisma(startDate);
      const endPrisma = TimezoneService.toPrisma(endDate);

      // Pre-build publicId map so availabilityBatch skips the extra DB lookup
      const vehicleIdToPublicId = new Map(
        filteredVehicles.map((v) => [v.id, v.publicId]),
      );

      console.time("[perf] listing:availability-check");
      const unavailableIds = await getUnavailableVehicleIds(
        filteredVehicles.map((v) => v.id),
        startPrisma,
        endPrisma,
        vehicleIdToPublicId,
      );
      console.timeEnd("[perf] listing:availability-check");

      availableVehicles = filteredVehicles.filter(
        (v) => !unavailableIds.has(v.id),
      );
    }

    if (availableVehicles.length === 0) {
      return res.status(StatusCode.OK).json({ count: 0, data: [] });
    }

    // ── Batch pricing (TASK-007 / TASK-009): at most 2 queries for all vehicles

    console.time("[perf] listing:pricing");
    let durationPriceMap: Map<number, ListingPrice> | null = null;
    let fallbackPriceMap: Map<
      number,
      { daily: number; hourly: number; halfDay: number }
    > | null = null;
    let durationInfo: ReturnType<typeof DurationCalculatorService.calculate> | null = null;

    if (startDate && endDate) {
      durationInfo = DurationCalculatorService.calculate(startDate, endDate);
      durationPriceMap = await getBatchListingPrices(availableVehicles, durationInfo);
    } else {
      fallbackPriceMap = await getBatchFallbackPrices(availableVehicles);
    }
    console.timeEnd("[perf] listing:pricing");

    // ── Group vehicles by make+model+category+branch ──────────────────────────

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
        daily   = fp?.daily   ?? 0;
        hourly  = fp?.hourly;
        halfDay = fp?.halfDay;
      }

      const existing = groupMap.get(gk);
      if (!existing) {
        groupMap.set(gk, {
          groupKey: gk,
          make: normalizeStr(v.make),
          model: normalizeStr(v.model),
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
        // Keep the lowest-priced vehicle as the representative
        if (daily < existing.minDailyPrice) {
          existing.minDailyPrice = daily;
          existing.imageUrl = v.images;
          existing.pricing = { daily, ...(hourly !== undefined ? { hourly } : {}), ...(halfDay !== undefined ? { halfDay } : {}) };
          existing.pricingDetails = pricingDetails;
        }
      }
    }

    // ── Build flat response and sort ──────────────────────────────────────────

    const allGroups = Array.from(groupMap.values()).map((g) => ({
      groupKey:       g.groupKey,
      make:           g.make,
      model:          g.model,
      category:       g.category,
      branch:         g.branch,
      availableCount: g.availableCount,
      imageUrl:       g.imageUrl,
      pricing:        g.pricing,
      pricingDetails: g.pricingDetails,
    }));

    if (sort === "price_low_to_high") {
      allGroups.sort((a, b) => a.pricing.daily - b.pricing.daily);
    } else if (sort === "price_high_to_low") {
      allGroups.sort((a, b) => b.pricing.daily - a.pricing.daily);
    }

    // Paginate grouped results
    const paginatedGroups = allGroups.slice(Number(offset), Number(offset) + Number(limit));
    const result = { count: allGroups.length, data: paginatedGroups };

    // Cache with 30-second TTL (TASK-022)
    try {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 30);
    } catch (redisErr) {
      console.warn("[listing] Redis set error:", redisErr);
    }

    return res.status(StatusCode.OK).json(result);
  } catch (err) {
    console.error("Error fetching public vehicles:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal server error while fetching public vehicles",
    });
  }
};

// ── Group Detail ──────────────────────────────────────────────────────────────

export const getVehicleGroupDetails = async (req: Request, res: Response) => {
  try {
    const groupKey = decodeURIComponent(req.params.groupKey ?? "");
    const parsed = parseGroupKey(groupKey);
    if (!parsed) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid group key format" });
    }
    const { make, model, categoryId, branchId } = parsed;

    const { start, end } = req.query as { start?: string; end?: string };

    let startDate: DateTime | null = null;
    let endDate: DateTime | null = null;

    if (start) {
      startDate = TimezoneService.parseISO(start);
      endDate = end ? TimezoneService.parseISO(end) : startDate.plus({ hours: 24 });
      if (startDate.toMillis() === endDate!.toMillis()) endDate = startDate.plus({ hours: 24 });
      if (!startDate.isValid || !endDate!.isValid) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid start or end date format" });
      }
    }

    const cacheKey = `public:vehicles:group:${groupKey}:${start || "nodate"}:${end || "nodate"}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.status(StatusCode.OK).json(JSON.parse(cached));
    } catch { /* non-fatal */ }

    // Fetch all vehicles in this group
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

    // Only AVAILABLE vehicles can be booked; exclude INACTIVE, OUT_FOR_RENTAL, MAINTENANCE, etc.
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

    // Use images from the representative vehicle only
    const allImages: string[] = representativeVehicle.images.map((img) => img.file.url);

    // Compute pricing from the representative vehicle
    let pricingDetails: any = null;
    let deposit = 0;
    let availability: boolean | null = null;

    if (startDate && endDate) {
      availability = availableCount > 0;
      const isInsuranceValid = new Date(representativeVehicle.insuranceExpiry) > new Date();
      if (isInsuranceValid && availability) {
        try {
          pricingDetails = await pricingEngine.calculateBookingPrice(
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
          deposit = Number(pricingDetails.deposit);
          pricingDetails = {
            basePrice:        Number(pricingDetails.basePrice),
            discountAmount:   Number(pricingDetails.discountAmount),
            discountPercent:  Number(pricingDetails.discountPercent),
            deposit:          Number(pricingDetails.deposit),
            taxAmount:        Number(pricingDetails.taxAmount),
            cgstAmount:       Number(pricingDetails.cgstAmount),
            sgstAmount:       Number(pricingDetails.sgstAmount),
            taxRate:          Number(pricingDetails.taxRate),
            finalTotal:       Number(pricingDetails.finalTotal),
            freeKmLimit:      pricingDetails.freeKmLimit,
            extraKmRate:      Number(pricingDetails.extraKmRate),
            pricingBreakdown: {
              periodType:      pricingDetails.pricingBreakdown.periodType,
              duration:        pricingDetails.pricingBreakdown.duration,
              applicablePrice: Number(pricingDetails.pricingBreakdown.applicablePrice),
              priceSource:     pricingDetails.pricingBreakdown.priceSource,
            },
          };
        } catch {
          // pricing failure is non-fatal
        }
      }
    }

    const firstCat = groupVehicles[0]!.category;
    const firstBranch = groupVehicles[0]!.branch;

    const response = {
      groupKey,
      make,
      model,
      category:       firstCat.name,
      branch:         firstBranch.name,
      availableCount,
      totalCount:     groupVehicles.length,
      images:         allImages,
      pricing:        { daily: pricingDetails?.pricingBreakdown?.applicablePrice ?? null },
      deposit,
      availability,
      pricingDetails,
      advancePayAmount: Number(representativeVehicle.advancePayAmount ?? 0),
    };

    try {
      await redis.set(cacheKey, JSON.stringify({ message: "Success", data: response }), "EX", 30);
    } catch { /* non-fatal */ }

    return res.status(StatusCode.OK).json({ message: "Success", data: response });
  } catch (e) {
    console.error("Error fetching vehicle group details:", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

// ── Detail ────────────────────────────────────────────────────────────────────

export const getPublicVehiclesDetails = async (req: Request, res: Response) => {
  try {
    const parsedData = getVehicleDetailsSchema.safeParse(req.params);
    if (!parsedData.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: parsedData.error.flatten(),
      });
    }

    const { start, end } = req.query as { start?: string; end?: string };

    let startDate: DateTime | null = null;
    let endDate: DateTime | null = null;

    if (start) {
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
      where: { publicId: parsedData.data.id },
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
        fastagNumber: true,
        hasFastag: true,
        branchId: true,
        categoryId: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },  // TASK-015: only name needed
        branch:   { select: { id: true, name: true } },  // TASK-015: drop pricingSetting (unused)
        images: { where: { isThumbnail: false }, include: { file: true } },
        pricingOverride: true,
        customPricing: true,
      },
    });

    if (!vehicleData) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Vehicle details could not be found for the provided ID.",
      });
    }

    let deposit: number = 0;
    let availability: boolean | null = null;
    let pricingDetails: any = null;

    const isInsuranceValid = new Date(vehicleData.insuranceExpiry) > new Date();

    if (startDate && endDate) {
      if (!isInsuranceValid) {
        availability = false;
      } else {
        // TASK-023: uses checkVehicleAvailability which delegates to getUnavailableVehicleIds
        availability = await checkVehicleAvailability(
          vehicleData.id,
          TimezoneService.toPrisma(startDate),
          TimezoneService.toPrisma(endDate),
        );
      }

      // TASK-018: Check full pricing result cache before recomputing
      const startNorm = TimezoneService.toPrisma(startDate).toISOString();
      const endNorm = TimezoneService.toPrisma(endDate).toISOString();
      const pricingCacheKey = vehicleDetailsPricingKey(vehicleData.id, startNorm, endNorm);

      let pricingResult: any = null;
      try {
        const cached = await redis.get(pricingCacheKey);
        if (cached) {
          console.log(`[pricing-cache] hit: ${pricingCacheKey}`);
          pricingResult = JSON.parse(cached);
        }
      } catch (err) {
        console.warn("[pricing-cache] Redis get error:", err);
      }

      if (!pricingResult) {
        // TASK-001 + TASK-016: pass categoryId and customPricing to skip redundant DB lookups
        pricingResult = await pricingEngine.calculateBookingPrice(
          vehicleData.id,
          startDate,
          endDate,
          vehicleData.branchId,
          undefined,
          undefined,
          undefined,
          undefined,
          vehicleData.categoryId,
          vehicleData.customPricing,
        );
        try {
          await redis.set(pricingCacheKey, JSON.stringify(pricingResult), "EX", 60);
        } catch (err) {
          console.warn("[pricing-cache] Redis set error:", err);
        }
      }

      pricingDetails = {
        basePrice:       Number(pricingResult.basePrice),
        discountAmount:  Number(pricingResult.discountAmount),
        discountPercent: Number(pricingResult.discountPercent),
        deposit:         Number(pricingResult.deposit),
        taxAmount:       Number(pricingResult.taxAmount),
        cgstAmount:      Number(pricingResult.cgstAmount),
        sgstAmount:      Number(pricingResult.sgstAmount),
        taxRate:         Number(pricingResult.taxRate),
        finalTotal:      Number(pricingResult.finalTotal),
        freeKmLimit:     pricingResult.freeKmLimit,
        extraKmRate:     Number(pricingResult.extraKmRate),
        pricingBreakdown: {
          periodType:      pricingResult.pricingBreakdown.periodType,
          duration:        pricingResult.pricingBreakdown.duration,
          applicablePrice: Number(pricingResult.pricingBreakdown.applicablePrice),
          priceSource:     pricingResult.pricingBreakdown.priceSource,
        },
      };

      // TASK-005: read deposit from pricingResult — eliminates duplicate DB fetch
      deposit = pricingDetails.deposit;
    } else if (!isInsuranceValid) {
      availability = false;
    }

    const imageUrls = vehicleData.images.map((img) => img.file.url);
    const response = {
      publicId:         vehicleData.publicId,
      make:             vehicleData.make,
      model:            vehicleData.model,
      status:           vehicleData.status,
      fastagNumber:     vehicleData.fastagNumber,
      hasFastag:       vehicleData.hasFastag,
      category:         vehicleData.category.name,
      branch:           vehicleData.branch.name,
      advancePayAmount: vehicleData.advancePayAmount,
      images:           imageUrls,
      pricing:          { daily: pricingDetails?.pricingBreakdown?.applicablePrice },
      deposit,
      availability,
      pricingDetails,
    };

    return res.status(StatusCode.OK).json({ message: "Success", data: response });
  } catch (e: any) {
    console.error("Internal Error While Fetching the Vehicle Details", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Error While Fetching the Vehicle Details",
    });
  }
};
