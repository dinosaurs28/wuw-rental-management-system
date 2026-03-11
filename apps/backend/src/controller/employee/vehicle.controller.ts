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
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { DateTime } from "luxon";

const pricingEngine = new PricingEngineService();

export const searchVehicles = async (req: Request, res: Response) => {
    try {
        const {
            search,
            model,
            make,
            category,
            start,
            end,
            limit = "20",
            offset = "0",
        } = req.query as any;

        const branchId = req.branch_Id;
        const limitNum = Number(limit);
        const offsetNum = Number(offset);

        // Basic validation for dates if provided
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
                return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid date format" });
            }
        }

        const cacheKey = `employee:vehicles:${branchId}:${search || 'all'}:${model || 'all'}:${make || 'all'}:${category || 'all'}:${start || 'none'}:${end || 'none'}:${limit}:${offset}`;
        const cached = await redis.get(cacheKey);
        if (cached) return res.status(StatusCode.OK).json(JSON.parse(cached));

        const where: any = {
            branchId: branchId,
            status: { in: ["AVAILABLE", "OUT_FOR_RENTAL"] },
            deletedAt: null,
            insuranceExpiry: {
                gt: new Date()
            }
        };

        if (search) {
            where.OR = [
                { make: { contains: search, mode: "insensitive" } },
                { model: { contains: search, mode: "insensitive" } },
                { regNo: { contains: search, mode: "insensitive" } }
            ];
        }
        if (model) where.model = { contains: model, mode: "insensitive" };
        if (make) where.make = { contains: make, mode: "insensitive" };

        if (category) {
            // Optimized: Filter by category publicId directly in the relation
            where.category = { publicId: category as string };
        }

        // Availability Filter
        if (startDate && endDate) {
            // Filter out vehicles that have conflicting bookings
            // using Prisma's relation filtering (anti-join logic)
            where.NOT = {
                bookingItems: {
                    some: {
                        booking: {
                            status: { in: ["CONFIRMED", "PICKED_UP", "HOLD"] },
                            // Check for overlap: (StartA <= EndB) and (EndA >= StartB)
                            startAt: { lte: TimezoneService.toPrisma(endDate) },
                            endAt: { gte: TimezoneService.toPrisma(startDate) }
                        }
                    }
                }
            };
        }

        // Single query to fetch vehicles with all necessary data
        const vehicles: any[] = await prisma.vehicle.findMany({
            where,
            take: limitNum,
            skip: offsetNum,
            include: {
                category: true,
                branch: {
                    include: { pricingSetting: true }
                },
                images: { where: { isThumbnail: true }, select: { file: { select: { url: true } } } },
                pricingOverride: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const total = await prisma.vehicle.count({ where });

        const formatted = [];
        for (const v of vehicles) {
            let pricingDetails: any = undefined;

            if (startDate && endDate) {
                const pricingResult = await pricingEngine.calculateListingPrice(
                    v.id,
                    startDate,
                    endDate,
                    v.branchId
                );

                pricingDetails = {
                    price: Number(pricingResult.price),
                    finalPrice: Number(pricingResult.finalPrice),
                    type: pricingResult.type
                };
            }

            let fallbackPricing: any = null;
            if (!pricingDetails) {
                fallbackPricing = await calculatePricingForVehicle(v.id);
            }

            formatted.push({
                publicId: v.publicId,
                make: v.make,
                model: v.model,
                category: v.category.name,
                branch: v.branch.name,
                imageUrl: v.images, // Structure matching public controller response for consistency
                pricing: pricingDetails ? {
                    daily: pricingDetails.price
                } : {
                    daily: fallbackPricing.daily,
                    hourly: fallbackPricing.hourly,
                    halfDay: fallbackPricing.halfDay
                },
                pricingDetails,
                status: v.status
            });
        }

        const response = {
            data: formatted,
            pagination: {
                total,
                limit: limitNum,
                offset: offsetNum
            }
        };

        await redis.setex(cacheKey, 60, JSON.stringify(response));
        return res.status(StatusCode.OK).json(response);

    } catch (error) {
        console.error("Employee search vehicles error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
    }
};

export const getEmployeeVehicleDetails = async (req: Request, res: Response) => {
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
                branchId: req.branch_Id
            },
            include: {
                category: true,
                branch: { include: { pricingSetting: true } },
                images: { include: { file: true } },
                pricingOverride: true
            }
        });

        if (!vehicleData) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Vehicle not found" });
        }

        let deposit = await getDepositAmount(vehicleData.branchId, vehicleData.categoryId);

        let availability: boolean | null = null;
        let pricingDetails: any = null;

        // Check insurance expiry
        const isInsuranceValid = new Date(vehicleData.insuranceExpiry) > new Date();

        if (startDate && endDate) {
            const isBookableStatus = ["AVAILABLE", "OUT_FOR_RENTAL"].includes(vehicleData.status);
            if (!isInsuranceValid || !isBookableStatus) {
                availability = false; // Not available if insurance expired or status not bookable
            } else {
                availability = await checkVehicleAvailability(vehicleData.id, TimezoneService.toPrisma(startDate), TimezoneService.toPrisma(endDate));
            }

            // Calculate pricing via Phase 2 Pricing Engine
            const pricingResult = await pricingEngine.calculateBookingPrice(
                vehicleData.id,
                startDate,
                endDate,
                vehicleData.branchId
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
                    applicablePrice: Number(pricingResult.pricingBreakdown.applicablePrice),
                    priceSource: pricingResult.pricingBreakdown.priceSource
                }
            };

            deposit = pricingDetails.deposit;
        } else if (!isInsuranceValid) {
            // If no dates provided but insurance expired, mark as explicitly unavailable
            availability = false;
        }

        const imageUrls = vehicleData.images.map(img => img.file.url);

        let fallbackPricing: any = null;
        if (!pricingDetails) {
            fallbackPricing = await calculatePricingForVehicle(vehicleData.id);
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
                pricing: pricingDetails ? {
                    daily: pricingDetails.pricingBreakdown.applicablePrice
                } : {
                    daily: fallbackPricing.daily,
                    hourly: fallbackPricing.hourly,
                    halfDay: fallbackPricing.halfDay
                },
                pricingDetails,
                deposit,
                availability
            }
        });

    } catch (error) {
        console.error("Employee vehicle details error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Error" });
    }
};
