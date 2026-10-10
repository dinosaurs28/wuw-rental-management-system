import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { getVehicleDetailsSchema } from "@repo/schemas";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability.js";
import {
  explainUnavailableVehicles,
  getBlockedForAnyWindowIds,
  getUnavailableVehicleIds,
  type UnavailableReason,
} from "../../utils/availability/availabilityBatch.js";
import {
  insuranceValidFrom,
  isInsuranceValid,
  isListableStatus,
  listableVehicleWhere,
  normalizeRegNo,
  regNoMatches,
} from "../../utils/availability/vehicleEligibility.js";
import { getDepositAmount } from "../../utils/pricing/getDepositAmount.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { PricingEngineService, rentInclGstFields } from "../../services/pricing/pricing-engine.service.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import {
  getBatchListingPrices,
  getBatchFallbackPrices,
  type ListingPrice,
} from "../../utils/pricing/batchListingPrice.js";
import { DateTime } from "luxon";
import { isGstRuleMissing } from "../../services/tax/gst.service.js";
import { pickGroupRepresentative } from "../../utils/booking/groupRepresentative.js";

const pricingEngine = new PricingEngineService();

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

export { parseGroupKey, normalizeStr };

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
      // Every card of a branch in one page by default (the walk-in screens show
      // one list; mobile asks for 100)
      limit = "100",
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

    // Listable cars (vehicleEligibility): AVAILABLE or OUT_FOR_RENTAL, insurance
    // valid through its expiry day; the availability check blocks the dates a
    // car is out on a rental
    const where: any = {
      branchId,
      ...listableVehicleWhere(),
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
        category: { select: { id: true, name: true, typeClass: true } },
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
    } else {
      // No dates: leave out cars free at no time (set Out for Rental by hand, overdue)
      const blocked = await getBlockedForAnyWindowIds(vehicles.map((v) => v.id));
      availableVehicles = vehicles.filter((v) => !blocked.has(v.id));
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
      durationPriceMap = await getBatchListingPrices(availableVehicles, durationInfo, { startAt: startDate, endAt: endDate });
    } else {
      fallbackPriceMap = await getBatchFallbackPrices(availableVehicles);
    }

    // Group by make+model+category+branch
    interface GroupEntry {
      groupKey: string;
      make: string;
      model: string;
      category: string;
      typeClass: string;
      branch: string;
      availableCount: number;
      imageUrl: any[];
      pricing: { daily: number; hourly?: number; halfDay?: number };
      pricingDetails?: {
        price: number; finalPrice: number; type: string; billedAs?: string; billedAsType?: string;
        // GST inside the GST-inclusive finalPrice (item 17; absent without a branch GST rule)
        rentWithoutGst?: number; gst?: number; cgst?: number; sgst?: number;
      };
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
        pricingDetails = {
          price: lp?.price ?? 0,
          finalPrice: daily,
          type: durationInfo.periodType,
          ...(lp?.billedAs && { billedAs: lp.billedAs, billedAsType: lp.billedAsType }),
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
        daily = fp?.daily ?? 0;
        hourly = fp?.hourly;
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
      typeClass: g.typeClass,
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

    const branchVehicles = await prisma.vehicle.findMany({
      where: { categoryId, branchId, deletedAt: null, insuranceExpiry: { gte: insuranceValidFrom() } },
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

    const targetMake = normalizeStr(make);
    const targetModel = normalizeStr(model);
    const groupVehicles = branchVehicles.filter(
      (v) => normalizeStr(v.make) === targetMake && normalizeStr(v.model) === targetModel,
    );

    if (groupVehicles.length === 0) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No vehicles found for this group" });
    }

    // Listable units free for the dates (without dates: not blocked for every
    // window) — the same rule as the customer group page and booking creation
    const { representative, available } = await pickGroupRepresentative(
      groupVehicles,
      startDate && endDate ? TimezoneService.toPrisma(startDate) : null,
      startDate && endDate ? TimezoneService.toPrisma(endDate) : null,
    );
    const availableCount = available.length;
    const representativeVehicle =
      representative ?? groupVehicles.find((v) => isListableStatus(v.status)) ?? groupVehicles[0]!;

    const allImages: string[] = representativeVehicle.images.map((img) => img.file.url);

    let pricingDetails: any = null;
    let deposit = 0;
    let availability: boolean | null = null;

    if (startDate && endDate) {
      availability = availableCount > 0;
      if (isInsuranceValid(representativeVehicle.insuranceExpiry) && availability) {
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
            // Duration-slab layer, named (walk-ins take no coupon)
            durationDiscountAmount:  Number(pr.durationDiscountAmount),
            durationDiscountPercent: Math.round(Number(pr.durationDiscountPercent) * 100) / 100,
            durationDiscountLabel:   pr.durationDiscountLabel,
            deposit:          Number(pr.deposit),
            taxAmount:        Number(pr.taxAmount),
            cgstAmount:       Number(pr.cgstAmount),
            sgstAmount:       Number(pr.sgstAmount),
            taxRate:          Number(pr.taxRate),
            cgstRate:         Number(pr.cgstRate),
            sgstRate:         Number(pr.sgstRate),
            finalTotal:       Number(pr.finalTotal),
            // GST-inclusive rent view (item 17): rentInclGst is the price
            ...rentInclGstFields(pr),
            freeKmLimit:      pr.freeKmLimit,
            extraKmRate:      Number(pr.extraKmRate),
            pricingBreakdown: {
              periodType:      pr.pricingBreakdown.periodType,
              duration:        pr.pricingBreakdown.duration,
              applicablePrice: Number(pr.pricingBreakdown.applicablePrice),
              priceSource:     pr.pricingBreakdown.priceSource,
              billedAs:        pr.pricingBreakdown.billedAs,
              billedAsType:    pr.pricingBreakdown.billedAsType,
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
        deletedAt: null,
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

    // Bookable at all (vehicleEligibility): listable status, insurance valid
    // through its expiry day; the dated check adds bookings, holds, overdue
    // rentals and a hand-set Out for Rental
    const isInsuranceOk = isInsuranceValid(vehicleData.insuranceExpiry);
    const isBookable = isInsuranceOk && isListableStatus(vehicleData.status);

    if (startDate && endDate) {
      if (!isBookable) {
        availability = false;
      } else {
        availability = await checkVehicleAvailability(
          vehicleData.id,
          TimezoneService.toPrisma(startDate),
          TimezoneService.toPrisma(endDate),
        );
      }

      // Calculate pricing via Phase 2 Pricing Engine
      let pricingResult: Awaited<ReturnType<typeof pricingEngine.calculateBookingPrice>> | null = null;
      try {
        pricingResult = await pricingEngine.calculateBookingPrice(
          vehicleData.id,
          startDate,
          endDate,
          vehicleData.branchId,
        );
      } catch (err) {
        // Branch without a GSTRule: no quote (pricingDetails null → fallback list
        // prices), like the group endpoint — the vehicle detail still loads.
        if (!isGstRuleMissing(err)) throw err;
      }

      if (pricingResult) pricingDetails = {
        basePrice: Number(pricingResult.basePrice),
        discountAmount: Number(pricingResult.discountAmount),
        discountPercent: Number(pricingResult.discountPercent),
        // Duration-slab layer, named (walk-ins take no coupon)
        durationDiscountAmount: Number(pricingResult.durationDiscountAmount),
        durationDiscountPercent: Math.round(Number(pricingResult.durationDiscountPercent) * 100) / 100,
        durationDiscountLabel: pricingResult.durationDiscountLabel,
        deposit: Number(pricingResult.deposit),
        taxAmount: Number(pricingResult.taxAmount),
        cgstAmount: Number(pricingResult.cgstAmount),
        sgstAmount: Number(pricingResult.sgstAmount),
        taxRate: Number(pricingResult.taxRate),
        cgstRate: Number(pricingResult.cgstRate),
        sgstRate: Number(pricingResult.sgstRate),
        finalTotal: Number(pricingResult.finalTotal),
        // GST-inclusive rent view (item 17): rentInclGst is the price
        ...rentInclGstFields(pricingResult),
        freeKmLimit: pricingResult.freeKmLimit,
        extraKmRate: Number(pricingResult.extraKmRate),
        pricingBreakdown: {
          periodType: pricingResult.pricingBreakdown.periodType,
          duration: pricingResult.pricingBreakdown.duration,
          applicablePrice: Number(
            pricingResult.pricingBreakdown.applicablePrice,
          ),
          priceSource: pricingResult.pricingBreakdown.priceSource,
          billedAs: pricingResult.pricingBreakdown.billedAs,
          billedAsType: pricingResult.pricingBreakdown.billedAsType,
        },
      };

      if (pricingDetails) deposit = pricingDetails.deposit;
    } else if (!isInsuranceOk) {
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
        regNo: vehicleData.regNo,
        year: vehicleData.year,
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
        advancePayAmount: Number(vehicleData.advancePayAmount ?? 0),
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

    // Only return categories that have at least one listable vehicle in this branch
    const categories = await prisma.vehicleCategory.findMany({
      where: {
        vehicles: {
          some: {
            branchId,
            ...listableVehicleWhere(),
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

// ── Walk-in search by registration number (client item 5) ────────────────────

/** Most rows the registration search answers with (best matches first). */
const REG_SEARCH_LIMIT = 30;

const displayIst = (d: Date): string =>
  TimezoneService.formatForDisplay(TimezoneService.fromJSDate(d), "full");

/** Staff-facing text for why a car can't be booked for the dates. */
function unavailableReasonMessage(r: UnavailableReason): string {
  switch (r.code) {
    case "MANUAL_OUT_FOR_RENTAL":
      return "Set Out for Rental by the branch manager";
    case "OVERDUE_RENTAL":
      return `Not back from a rental (was due ${displayIst(r.endAt)})`;
    case "ON_RENT":
      return `On rent until ${displayIst(r.endAt)}`;
    case "BOOKED":
      return `Booked ${displayIst(r.startAt)} – ${displayIst(r.endAt)}`;
    case "ON_HOLD":
      return "A customer is booking it right now";
  }
}

/**
 * GET /api/employee/vehicles/search-reg?q=&start=&end=
 *
 * The branch's cars whose registration number contains q (case-insensitive,
 * spaces / hyphens ignored; at least 2 letters or digits), one row per car,
 * priced for the dates. Cars that can't be booked for the dates are still
 * listed with available: false and the reason, taken from the same rule as the
 * walk-in listing (vehicleEligibility + getUnavailableVehicleIds). Booking one
 * goes through POST /employee/booking/create with vehicles: [publicId].
 */
export const searchVehiclesByRegNo = async (req: Request, res: Response) => {
  try {
    const { q, start, end } = req.query as { q?: string; start?: string; end?: string };
    const branchId = req.branch_Id;
    const query = normalizeRegNo(q);
    if (query.length < 2) {
      return res.status(StatusCode.OK).json({ data: [], total: 0 });
    }
    if (!start) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Choose the rental dates first" });
    }

    const startDate = TimezoneService.parseISO(start);
    let endDate = end ? TimezoneService.parseISO(end) : startDate.plus({ hours: 24 });
    if (startDate.toMillis() === endDate.toMillis()) endDate = startDate.plus({ hours: 24 });
    if (!startDate.isValid || !endDate.isValid) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid date format" });
    }
    if (endDate <= startDate) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Return must be after pickup" });
    }
    const startPrisma = TimezoneService.toPrisma(startDate);
    const endPrisma = TimezoneService.toPrisma(endDate);

    // Registration numbers are stored as typed (spaces, hyphens), so they are
    // compared in their normalised form; a branch fleet is small enough to scan.
    const fleet = await prisma.vehicle.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, regNo: true },
    });
    const matches = fleet
      .filter((v) => regNoMatches(v.regNo, query))
      .sort((a, b) => {
        // Numbers that start with what was typed first, then alphabetical
        const aStarts = normalizeRegNo(a.regNo).startsWith(query);
        const bStarts = normalizeRegNo(b.regNo).startsWith(query);
        return Number(bStarts) - Number(aStarts) || a.regNo.localeCompare(b.regNo);
      });
    if (matches.length === 0) {
      return res.status(StatusCode.OK).json({ data: [], total: 0 });
    }

    const order = new Map(matches.slice(0, REG_SEARCH_LIMIT).map((v, i) => [v.id, i]));
    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: [...order.keys()] } },
      select: {
        id: true,
        publicId: true,
        regNo: true,
        make: true,
        model: true,
        year: true,
        status: true,
        insuranceExpiry: true,
        branchId: true,
        categoryId: true,
        category: { select: { name: true, typeClass: true } },
        images: {
          where: { isThumbnail: true },
          take: 1,
          select: { file: { select: { url: true } } },
        },
      },
    });
    vehicles.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

    const durationInfo = DurationCalculatorService.calculate(startDate, endDate);
    const [fallbackPrices, prices, dated] = await Promise.all([
      // The 24 h rent the car is billed with (0 = no pricing set)
      getBatchFallbackPrices(vehicles),
      getBatchListingPrices(vehicles, durationInfo, { startAt: startDate, endAt: endDate }),
      // The dated checks for the cars the static rule lets through
      explainUnavailableVehicles(
        vehicles.filter((v) => isListableStatus(v.status)).map((v) => v.id),
        startPrisma,
        endPrisma,
        new Map(vehicles.map((v) => [v.id, v.publicId])),
      ),
    ]);

    const data = vehicles.map((v) => {
      const priced = (fallbackPrices.get(v.id)?.daily ?? 0) > 0;
      const lp = priced ? prices.get(v.id) : undefined;
      const datedReason = dated.get(v.id);

      // First reason that applies, in the order the listing rule checks them
      let reason: { code: string; message: string } | null = null;
      if (v.status === "MAINTENANCE") reason = { code: "STATUS_MAINTENANCE", message: "In maintenance" };
      else if (v.status === "INACTIVE") reason = { code: "STATUS_INACTIVE", message: "Inactive" };
      else if (v.status === "MANAGER_REPORTED") {
        reason = { code: "DAMAGE_REVIEW_PENDING", message: "Damage review pending with the branch manager" };
      } else if (!isListableStatus(v.status)) reason = { code: "STATUS_UNAVAILABLE", message: `Status: ${v.status}` };
      else if (!isInsuranceValid(v.insuranceExpiry)) {
        reason = {
          code: "INSURANCE_EXPIRED",
          message: `Insurance expired on ${TimezoneService.formatForDisplay(TimezoneService.fromJSDate(v.insuranceExpiry), "date")}`,
        };
      } else if (!priced) reason = { code: "NO_PRICE", message: "No price set for this car" };
      else if (datedReason) reason = { code: datedReason.code, message: unavailableReasonMessage(datedReason) };

      return {
        publicId: v.publicId,
        regNo: v.regNo,
        make: v.make,
        model: v.model,
        year: v.year,
        category: v.category.name,
        typeClass: v.category.typeClass,
        imageUrl: v.images[0]?.file.url ?? null,
        // The car's make/model group — informational; book the car itself
        groupKey: buildGroupKey(v.make, v.model, v.categoryId, v.branchId),
        pricing: { daily: lp?.finalPrice ?? null },
        pricingDetails: lp
          ? {
              price: lp.price,
              finalPrice: lp.finalPrice,
              type: durationInfo.periodType,
              ...(lp.billedAs && { billedAs: lp.billedAs, billedAsType: lp.billedAsType }),
              // price / finalPrice are GST-inclusive; the GST inside finalPrice (item 17)
              ...(lp.rentWithoutGst != null && {
                rentWithoutGst: lp.rentWithoutGst,
                gst: lp.gst,
                cgst: lp.cgst,
                sgst: lp.sgst,
              }),
            }
          : null,
        available: reason === null,
        unavailableReason: reason,
      };
    });

    // Bookable cars first, keeping the match order within each part
    data.sort((a, b) => Number(b.available) - Number(a.available));

    return res.status(StatusCode.OK).json({ data, total: matches.length });
  } catch (error) {
    console.error("Employee reg-no vehicle search error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
