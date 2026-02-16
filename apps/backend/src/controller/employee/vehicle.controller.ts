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
        let startDate: Date | null = null;
        let endDate: Date | null = null;
        if (start && end) {
            startDate = new Date(start as string);
            endDate = new Date(end as string);
            // Set end date to end of day to cover full day (23:59:59.999)
            endDate.setHours(23, 59, 59, 999);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
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
                            status: { in: ["CONFIRMED", "PICKED_UP", "HOLD"] }, // Assuming logic matches public controller
                            // Check for overlap: (StartA <= EndB) and (EndA >= StartB)
                            startAt: { lte: endDate },
                            endAt: { gte: startDate }
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
            // In-memory pricing calculation to avoid N+1 calls
            const base = Number(v.baseDailyPrice);
            let finalDailyPrice = base;

            if (v.pricingOverride?.enabled) {
                if (v.pricingOverride.customPrice) {
                    finalDailyPrice = Number(v.pricingOverride.customPrice);
                } else if (v.pricingOverride.multiplier) {
                    finalDailyPrice = base * Number(v.pricingOverride.multiplier);
                }
            } else {
                const settings = v.branch?.pricingSetting;
                if (settings) {
                    if (settings.customEnabled) {
                        finalDailyPrice = base * Number(settings.customMultiplier);
                    } else if (settings.peakEnabled) {
                        finalDailyPrice = base * Number(settings.peakMultiplier);
                    } else if (settings.weekendEnabled) {
                        finalDailyPrice = base * Number(settings.weekendMultiplier);
                    }
                }
            }

            formatted.push({
                publicId: v.publicId,
                make: v.make,
                model: v.model,
                category: v.category.name,
                branch: v.branch.name,
                imageUrl: v.images, // Structure matching public controller response for consistency
                pricing: {
                    daily: Number(finalDailyPrice.toFixed(2))
                },
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
        let startDate: Date | null = null;
        let endDate: Date | null = null;
        if (start && end) {
            startDate = new Date(start as string);
            endDate = new Date(end as string);
            // Set end date to end of day to cover full day (23:59:59.999)
            endDate.setHours(23, 59, 59, 999);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
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

        const pricing = await calculatePricingForVehicleFromRecord(vehicleData);
        const deposit = await getDepositAmount(vehicleData.branchId, vehicleData.categoryId);

        let availability: boolean | null = null;
        let baseTotal: number | null = null;
        let totalDays: number | null = null;
        let discountPrice: number | null = null;
        let totalPrice: number | null = null;

        // Check insurance expiry
        const isInsuranceValid = new Date(vehicleData.insuranceExpiry) > new Date();

        if (startDate && endDate) {
            const isBookableStatus = ["AVAILABLE", "OUT_FOR_RENTAL"].includes(vehicleData.status);
            if (!isInsuranceValid || !isBookableStatus) {
                availability = false; // Not available if insurance expired or status not bookable
            } else {
                availability = await checkVehicleAvailability(vehicleData.id, startDate, endDate);
            }

            const multi = calculateMultiDayTotalPrice(startDate, endDate, pricing.daily);
            baseTotal = multi.total;
            totalDays = multi.days;
            const discountPercent = await getDiscountForDays(vehicleData.branchId, vehicleData.categoryId, totalDays);
            const finalTotal = baseTotal * (1 - discountPercent);
            totalPrice = Number(finalTotal.toFixed(2));
            discountPrice = Number((baseTotal - finalTotal).toFixed(2));
        } else if (!isInsuranceValid) {
            // If no dates provided but insurance expired, mark as explicitly unavailable
            availability = false;
        }

        const imageUrls = vehicleData.images.map(img => img.file.url);

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
                pricing,
                deposit,
                availability,
                totalDays,
                baseTotal,
                discountPrice,
                finalTotal: totalPrice
            }
        });

    } catch (error) {
        console.error("Employee vehicle details error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Error" });
    }
};
