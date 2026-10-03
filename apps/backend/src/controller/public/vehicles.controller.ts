import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { getVehicleDetailsSchema, parseUseCasesFilter } from "@repo/schemas";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { vehicleDetailsPricingKey } from "../../utils/cache/vehicleCacheKeys.js";
import { PricingEngineService, rentInclGstFields } from "../../services/pricing/pricing-engine.service.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import { DateTime } from "luxon";
import { getUnavailableVehicleIds } from "../../utils/availability/availabilityBatch.js";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability.js";
import {
  getBatchListingPrices,
  getBatchFallbackPrices,
  ListingPrice,
} from "../../utils/pricing/batchListingPrice.js";
import { pickGroupRepresentative } from "../../utils/booking/groupRepresentative.js";
import {
  getCustomerPaymentMode,
  resolvePaymentOptions,
} from "../../services/payment/payment-flow.service.js";
import { isGstRuleMissing } from "../../services/tax/gst.service.js";

const pricingEngine = new PricingEngineService();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Duration-slab layer of a PricingResult (or its cached JSON) for the details
 * responses. discountAmount/discountPercent stay the combined totals; these
 * name the slab so clients can show e.g. "Weekly discount (10%)". Fields are
 * null/0 on a pricing result cached before they existed (60 s).
 */
function durationDiscountFields(pr: any) {
  const percent = Number(pr.durationDiscountPercent ?? 0);
  return {
    durationDiscountAmount:  Number(pr.durationDiscountAmount ?? 0),
    durationDiscountPercent: Math.round(percent * 100) / 100,
    durationDiscountLabel:   (pr.durationDiscountLabel as string | null | undefined) ?? null,
    durationDiscountType:    (pr.durationDiscountType as "PERCENTAGE" | "FLAT" | null | undefined) ?? null,
    couponDiscountAmount:    Number(pr.couponDiscountAmount ?? 0),
  };
}

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
    // Trip-type tags: comma list or repeated key; unknown values are ignored. OR semantics.
    const useCaseFilter = parseUseCasesFilter((req.query as any).useCases).sort();

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
    }:${make || "all"}:${model || "all"}:${sort || "none"}:${start || "all"}:${end || "all"}:${limit}:${offset}:uc=${useCaseFilter.join(",") || "all"}`;

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
    if (useCaseFilter.length > 0) filters.useCases = { hasSome: useCaseFilter };

    // ── Fetch vehicles (single query, no skip/take — pagination applied after grouping) ───

    console.time("[perf] listing:vehicles-query");
    const vehicles = await prisma.vehicle.findMany({
      where: filters,
      include: {
        category: { select: { id: true, name: true, typeClass: true } },
        branch:   { select: { id: true, name: true, publicId: true } },
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
      typeClass: string;
      branch: string;
      branchPublicId: string;
      availableCount: number;
      imageUrl: any[];
      pricing: { daily: number; hourly?: number; halfDay?: number };
      pricingDetails?: {
        price: number; finalPrice: number; type: string; billedAs?: string; billedAsType?: string;
        discountAmount?: number; discountPercent?: number; discountLabel?: string | null;
        // GST inside the GST-inclusive finalPrice (item 17; absent without a branch GST rule)
        rentWithoutGst?: number; gst?: number; cgst?: number; sgst?: number;
      };
      minDailyPrice: number;
      useCases: Set<string>;
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
        pricingDetails = {
          price: lp?.price ?? 0,
          finalPrice: daily,
          type: durationInfo.periodType,
          ...(lp?.billedAs && { billedAs: lp.billedAs, billedAsType: lp.billedAsType }),
          // Duration-slab saving already inside finalPrice (absent when none)
          ...(lp?.discountAmount != null && {
            discountAmount: lp.discountAmount,
            discountPercent: lp.discountPercent,
            discountLabel: lp.discountLabel ?? null,
          }),
          // price / finalPrice are GST-inclusive; the GST inside finalPrice (item 17)
          ...(lp?.rentWithoutGst != null && {
            rentWithoutGst: lp.rentWithoutGst,
            gst: lp.gst,
            cgst: lp.cgst,
            sgst: lp.sgst,
          }),
        };
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
          typeClass: v.category.typeClass,
          branch: v.branch.name,
          branchPublicId: v.branch.publicId,
          availableCount: 1,
          imageUrl: v.images,
          pricing: { daily, ...(hourly !== undefined ? { hourly } : {}), ...(halfDay !== undefined ? { halfDay } : {}) },
          pricingDetails,
          minDailyPrice: daily,
          useCases: new Set(v.useCases),
        });
      } else {
        existing.availableCount++;
        for (const uc of v.useCases) existing.useCases.add(uc);
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
      typeClass:      g.typeClass,
      branch:         g.branch,
      branchPublicId: g.branchPublicId,
      availableCount: g.availableCount,
      imageUrl:       g.imageUrl,
      pricing:        g.pricing,
      pricingDetails: g.pricingDetails,
      useCases:       Array.from(g.useCases).sort(),
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
    const branchVehicles = await prisma.vehicle.findMany({
      where: { categoryId, branchId, deletedAt: null, insuranceExpiry: { gt: new Date() } },
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
        useCases: true,
        branchId: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
        branch:   { select: { id: true, name: true, publicId: true } },
        images:   { where: { isThumbnail: false }, include: { file: true } },
        customPricing: true,
        pricingOverride: true,
      },
      orderBy: { odo: "asc" },
    });

    const targetMake = normalizeStr(make);
    const targetModel = normalizeStr(model);
    const groupVehicles = branchVehicles.filter(
      (v) => normalizeStr(v.make) === targetMake && normalizeStr(v.model) === targetModel,
    );

    if (groupVehicles.length === 0) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No vehicles found for this group" });
    }

    // Only AVAILABLE vehicles can be booked; exclude INACTIVE, OUT_FOR_RENTAL, MAINTENANCE, etc.
    const bookableVehicles = groupVehicles.filter((v) => v.status === "AVAILABLE");
    let availableCount: number;
    let representativeVehicle = bookableVehicles[0] ?? groupVehicles[0]!;

    if (startDate && endDate) {
      // Same rule as booking creation (pickGroupRepresentative), so the price and
      // advance quoted here come from the unit the booking will price and charge
      const { representative, available } = await pickGroupRepresentative(
        groupVehicles,
        TimezoneService.toPrisma(startDate),
        TimezoneService.toPrisma(endDate),
      );
      availableCount = available.length;
      if (representative) representativeVehicle = representative;
    } else {
      availableCount = bookableVehicles.length;
    }

    // Use images from the representative vehicle only
    const allImages: string[] = representativeVehicle.images.map((img: any) => img.file.url);

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
            ...durationDiscountFields(pricingDetails),
            deposit:          Number(pricingDetails.deposit),
            taxAmount:        Number(pricingDetails.taxAmount),
            cgstAmount:       Number(pricingDetails.cgstAmount),
            sgstAmount:       Number(pricingDetails.sgstAmount),
            taxRate:          Number(pricingDetails.taxRate),
            cgstRate:         Number(pricingDetails.cgstRate),
            sgstRate:         Number(pricingDetails.sgstRate),
            finalTotal:       Number(pricingDetails.finalTotal),
            // GST-inclusive rent view (item 17): rentInclGst is the price
            ...rentInclGstFields(pricingDetails),
            freeKmLimit:      pricingDetails.freeKmLimit,
            extraKmRate:      Number(pricingDetails.extraKmRate),
            pricingBreakdown: {
              periodType:      pricingDetails.pricingBreakdown.periodType,
              duration:        pricingDetails.pricingBreakdown.duration,
              applicablePrice: Number(pricingDetails.pricingBreakdown.applicablePrice),
              priceSource:     pricingDetails.pricingBreakdown.priceSource,
              billedAs:        pricingDetails.pricingBreakdown.billedAs,
              billedAsType:    pricingDetails.pricingBreakdown.billedAsType,
            },
          };
        } catch {
          // pricing failure is non-fatal
        }
      }
    }

    const firstCat = groupVehicles[0]!.category;
    const firstBranch = groupVehicles[0]!.branch;

    const groupCustomerPaymentMode = await getCustomerPaymentMode(firstBranch.id);
    // Which plans the customer can pick here (null payableTotal until dates are chosen)
    const groupPaymentOptions = resolvePaymentOptions({
      mode: groupCustomerPaymentMode,
      advanceAmount: representativeVehicle.advancePayAmount?.toString() ?? "0",
      payableTotal: pricingDetails ? pricingDetails.finalTotal + pricingDetails.deposit : null,
    });

    const response = {
      groupKey,
      make,
      model,
      category:       firstCat.name,
      branch:         firstBranch.name,
      branchPublicId: firstBranch.publicId,
      availableCount,
      totalCount:     groupVehicles.length,
      images:         allImages,
      pricing:        { daily: pricingDetails?.pricingBreakdown?.applicablePrice ?? null },
      deposit,
      availability,
      pricingDetails,
      advancePayAmount: Number(representativeVehicle.advancePayAmount ?? 0),
      customerPaymentMode: groupCustomerPaymentMode,
      paymentOptions: groupPaymentOptions,
      useCases: Array.from(new Set(groupVehicles.flatMap((v) => v.useCases))).sort(),
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

    // A removed (soft-deleted) vehicle 404s like an unknown id, so a stale shared
    // link shows "Vehicle Not Found" instead of a priced car that cannot be booked.
    const vehicleData = await prisma.vehicle.findFirst({
      where: { publicId: parsedData.data.id, deletedAt: null },
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
        useCases: true,
        branchId: true,
        categoryId: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },  // TASK-015: only name needed
        branch:   { select: { id: true, name: true, publicId: true } },  // TASK-015: drop pricingSetting (unused)
        images: { where: { isThumbnail: false }, include: { file: true } },
        pricingOverride: true,
        customPricing: true,
      },
    });

    if (!vehicleData) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "VEHICLE_NOT_FOUND",
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
        try {
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
        } catch (err) {
          // Branch without a GSTRule: no server price (pricingDetails null, clients show
          // "price unavailable"), like the group endpoint — the vehicle page still loads.
          if (!isGstRuleMissing(err)) throw err;
        }
        if (pricingResult) {
          try {
            await redis.set(pricingCacheKey, JSON.stringify(pricingResult), "EX", 60);
          } catch (err) {
            console.warn("[pricing-cache] Redis set error:", err);
          }
        }
      }

      if (pricingResult) pricingDetails = {
        basePrice:       Number(pricingResult.basePrice),
        discountAmount:  Number(pricingResult.discountAmount),
        discountPercent: Number(pricingResult.discountPercent),
        ...durationDiscountFields(pricingResult),
        deposit:         Number(pricingResult.deposit),
        taxAmount:       Number(pricingResult.taxAmount),
        cgstAmount:      Number(pricingResult.cgstAmount),
        sgstAmount:      Number(pricingResult.sgstAmount),
        taxRate:         Number(pricingResult.taxRate),
        // null only for a pricing result cached before these fields existed (60 s)
        cgstRate:        pricingResult.cgstRate != null ? Number(pricingResult.cgstRate) : null,
        sgstRate:        pricingResult.sgstRate != null ? Number(pricingResult.sgstRate) : null,
        finalTotal:      Number(pricingResult.finalTotal),
        // GST-inclusive rent view (item 17): rentInclGst is the price
        ...rentInclGstFields(pricingResult),
        freeKmLimit:     pricingResult.freeKmLimit,
        extraKmRate:     Number(pricingResult.extraKmRate),
        pricingBreakdown: {
          periodType:      pricingResult.pricingBreakdown.periodType,
          duration:        pricingResult.pricingBreakdown.duration,
          applicablePrice: Number(pricingResult.pricingBreakdown.applicablePrice),
          priceSource:     pricingResult.pricingBreakdown.priceSource,
          // absent only on a pricing result cached before these fields existed (60 s)
          billedAs:        pricingResult.pricingBreakdown.billedAs,
          billedAsType:    pricingResult.pricingBreakdown.billedAsType,
        },
      };

      // TASK-005: read deposit from pricingResult — eliminates duplicate DB fetch
      deposit = pricingDetails?.deposit ?? 0;
    } else if (!isInsuranceValid) {
      availability = false;
    }

    const singleCustomerPaymentMode = await getCustomerPaymentMode(vehicleData.branchId);
    // Which plans the customer can pick here (null payableTotal until dates are chosen)
    const singlePaymentOptions = resolvePaymentOptions({
      mode: singleCustomerPaymentMode,
      advanceAmount: vehicleData.advancePayAmount?.toString() ?? "0",
      payableTotal: pricingDetails ? pricingDetails.finalTotal + pricingDetails.deposit : null,
    });

    const imageUrls = vehicleData.images.map((img: any) => img.file.url);
    const response = {
      publicId:         vehicleData.publicId,
      make:             vehicleData.make,
      model:            vehicleData.model,
      status:           vehicleData.status,
      fastagNumber:     vehicleData.fastagNumber,
      hasFastag:       vehicleData.hasFastag,
      useCases:         vehicleData.useCases,
      category:         vehicleData.category.name,
      branch:           vehicleData.branch.name,
      branchPublicId:   vehicleData.branch.publicId,
      advancePayAmount: Number(vehicleData.advancePayAmount ?? 0),
      customerPaymentMode: singleCustomerPaymentMode,
      paymentOptions:   singlePaymentOptions,
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
