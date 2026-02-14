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
        const branchId = req.branch_Id
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
            status: "AVAILABLE",
            deletedAt: null
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
            // Assuming category is publicId, need to resolve or join
            const catObj = await prisma.vehicleCategory.findUnique({ where: { publicId: category as string } });
            if (catObj) where.categoryId = catObj.id;
        }

        // Availability Filter
        if (startDate && endDate) {
            const bookedItems = await prisma.bookingItem.findMany({
                where: {
                    booking: {
                        status: { not: "CANCELLED" },
                        startAt: { lte: endDate }, // overlap logic
                        endAt: { gte: startDate }
                    }
                },
                select: { vehicleId: true }
            });
            const bookedIds = bookedItems.map(i => i.vehicleId);
            if (bookedIds.length > 0) {
                where.id = { notIn: bookedIds };
            }
        }

        const vehicles = await prisma.vehicle.findMany({
            where,
            take: Number(limit),
            skip: Number(offset),
            include: {
                category: true,
                branch: true,
                images: { where: { isThumbnail: true }, include: { file: true } }
            }
        });

        const total = await prisma.vehicle.count({ where });

        const formatted = [];
        for (const v of vehicles) {
            // Basic calculation, or detailed if needed in list? User said "basic info like name,model,type,thumbnail,base price"
            // base price usually is baseDailyPrice, or calculated
            const pricing = await calculatePricingForVehicle(v.id);
            formatted.push({
                publicId: v.publicId,
                make: v.make,
                model: v.model,
                category: v.category.name,
                branch: v.branch.name,
                imageUrl: v.images[0]?.file?.url ? [{ file: { url: v.images[0].file.url } }] : [],
                pricing: {
                    daily: pricing.daily
                },
                status: v.status
            });
        }

        const response = {
            data: formatted,
            pagination: {
                total,
                limit: Number(limit),
                offset: Number(offset)
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
            if (!isInsuranceValid) {
                availability = false; // Not available if insurance expired
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
