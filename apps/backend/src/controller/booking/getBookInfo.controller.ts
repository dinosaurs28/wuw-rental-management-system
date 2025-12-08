import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode";
import { prisma } from "@repo/database/client";
import { bookingSummarySchema } from "@repo/schemas";
import { redis } from "../../lib/redisconfig";
import { calculatePricingForVehicleFromRecord } from "../../utils/pricing/calcPricingInd";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability";
import { getDepositAmount } from "../../utils/pricing/getDepositAmount";
import { calculateMultiDayTotalPrice } from "../../utils/pricing/calcMultiDayPrice";
import { getDiscountForDays } from "../../utils/pricing/getDiscountForDays";

export const createBookingSummary = async (req: Request, res: Response) => {
  try {
    const parsed = bookingSummarySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid request data",
        errors: parsed.error.flatten()
      });
    }

    const { vehicles, start, end } = parsed.data;

   
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid start or end date format"
      });
    }

    
    if (endDate <= startDate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "End date must be after start date"
      });
    }

    const now = new Date();
    if (startDate < now) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Start date cannot be in the past"
      });
    }

    
    const vehiclesData = await prisma.vehicle.findMany({
      where: { publicId: { in: vehicles } },
      include: {
        category: true,
        branch: {
          include: { pricingSetting: true }
        },
        pricingOverride: true
      }
    });

    
    if (vehiclesData.length !== vehicles.length) {
      const foundIds = vehiclesData.map(v => v.publicId);
      const missingIds = vehicles.filter(id => !foundIds.includes(id));
      return res.status(StatusCode.NOT_FOUND).json({
        message: "One or more vehicles not found",
        missingVehicles: missingIds
      });
    }

    const items = [];
    let grandBaseTotal = 0;
    let grandDiscountTotal = 0;
    let grandFinalTotal = 0;
    let grandDeposit = 0;

    
    for (const v of vehiclesData) {
      
      const availability = await checkVehicleAvailability(
        v.id,
        startDate,
        endDate
      );

      if (!availability) {
        return res.status(StatusCode.CONFLICT).json({
          message: `Vehicle ${v.make} ${v.model} is not available for selected dates`
        });
      }

      
      const vehicleHolds = await redis.smembers(`vehicle_holds:${v.publicId}`);
      if (vehicleHolds && vehicleHolds.length > 0) {
        
        return res.status(StatusCode.CONFLICT).json({
          message: `Vehicle ${v.make} ${v.model} is currently being booked by another user. Please try again in a few minutes.`
        });
      }

      
      const pricing = await calculatePricingForVehicleFromRecord(v);
      const multi = calculateMultiDayTotalPrice(startDate, endDate, pricing.daily);
      const baseTotal = multi.total;
      const days = multi.days;

      
      const discountPercent = (await getDiscountForDays(v.branchId, v.categoryId, days)) || 0;
      
    
      const discountedTotal = Number((baseTotal * (1 - discountPercent)).toFixed(2));
      const discountAmount = Number((baseTotal - discountedTotal).toFixed(2));


      const deposit = (await getDepositAmount(v.branchId, v.categoryId)) || 0;
      const finalTotal = Number((discountedTotal + deposit).toFixed(2));

      items.push({
        publicId: v.publicId,
        make: v.make,
        model: v.model,
        category: v.category.name,
        branch: v.branch.name,
        days,
        baseTotal,
        discountAmount,
        discountPercent, 
        deposit,
        finalTotal
      });

      grandBaseTotal += baseTotal;
      grandDiscountTotal += discountAmount;
      grandDeposit += deposit;
      grandFinalTotal += finalTotal;
    }

 
    grandBaseTotal = Number(grandBaseTotal.toFixed(2));
    grandDiscountTotal = Number(grandDiscountTotal.toFixed(2));
    grandDeposit = Number(grandDeposit.toFixed(2));
    grandFinalTotal = Number(grandFinalTotal.toFixed(2));


    const holdId = `hold_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const holdExpiry = 1800; 

    const holdData = {
      vehicles: items,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totals: {
        grandBaseTotal,
        grandDiscountTotal,
        grandDeposit,
        grandFinalTotal
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + holdExpiry * 1000).toISOString()
    };


    await redis.setex(holdId, holdExpiry, JSON.stringify(holdData));

    const pipeline = redis.pipeline();
    for (const v of vehiclesData) {
      pipeline.sadd(`vehicle_holds:${v.publicId}`, holdId);
      pipeline.expire(`vehicle_holds:${v.publicId}`, holdExpiry);
    }
    await pipeline.exec();

    return res.status(StatusCode.OK).json({
      message: "Summary created successfully",
      holdId,
      expiresIn: holdExpiry,
      expiresAt: holdData.expiresAt,
      data: {
        items,
        startDate: holdData.startDate,
        endDate: holdData.endDate,
        totals: {
          grandBaseTotal,
          grandDiscountTotal,
          grandDeposit,
          grandFinalTotal
        }
      }
    });

  } catch (e: any) {
    console.error("Error generating booking summary:", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal server error while generating booking summary",
    });
  }
};
