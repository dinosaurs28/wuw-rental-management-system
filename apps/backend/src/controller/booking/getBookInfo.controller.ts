import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { bookingSummarySchema } from "@repo/schemas";
import { redis } from "../../lib/redisconfig.js";
import { getUnavailableVehicleIds } from "../../utils/availability/availabilityBatch.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { initiatePhonePePayment } from "../../utils/payment/paymentCreate.utils.js";
import { createID } from "../../utils/nanoID.js";
import jwt from "jsonwebtoken";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import Decimal from "decimal.js";

const pricingEngine = new PricingEngineService();

export const createBookingSummary = async (req: Request, res: Response) => {
  try {
    const parsed = bookingSummarySchema.safeParse(req.body);
    const customerpubId = req.public_Id;
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid request data",
        errors: parsed.error.flatten(),
      });
    }
    const userData = await prisma.user.findUnique({
      where: {
        publicId: customerpubId,
      },
      select: {
        id: true,
        customerProfile: {
          select: {
            id: true,
          },
        },
      },
    });
    if (!userData?.customerProfile) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Customer doesnt Exists",
      });
    }
    const { vehicles, start, end, file_public_id, payment_flow } = parsed.data;
    const customerId = userData.customerProfile.id;
    const kycFile = await prisma.fileObject.findUnique({
      where: { publicId: file_public_id },
      select: { id: true },
    });

    if (!kycFile) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid KYC document",
      });
    }
    const startDateDt = TimezoneService.parseISO(start);
    const endDateDt = TimezoneService.parseISO(end);

    if (!startDateDt.isValid || !endDateDt.isValid) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid start or end date format",
      });
    }

    const startDate = TimezoneService.toPrisma(startDateDt);
    const endDate = TimezoneService.toPrisma(endDateDt);

    if (endDate <= startDate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "End date must be after start date",
      });
    }

    const nowDt = TimezoneService.getCurrentTime();
    // Compare only the date portion, not the exact time
    // This allows same-day bookings even if the time has passed
    const startDateOnly = TimezoneService.startOfDay(startDateDt);
    const todayOnly = TimezoneService.startOfDay(nowDt);

    if (startDateOnly < todayOnly) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Start date cannot be in the past",
      });
    }

    const vehiclesData = await prisma.vehicle.findMany({
      where: { publicId: { in: vehicles } },
      include: {
        category: true,
        branch: {
          include: { pricingSetting: true },
        },
        pricingOverride: true,
        customPricing: true,
      },
    });

    if (vehiclesData.length !== vehicles.length) {
      const foundIds = vehiclesData.map((v) => v.publicId);
      const missingIds = vehicles.filter((id) => !foundIds.includes(id));
      return res.status(StatusCode.NOT_FOUND).json({
        message: "One or more vehicles not found",
        missingVehicles: missingIds,
      });
    }

    const items: any = [];

    // GST Rule Fetching
    const branchId = vehiclesData[0]?.branchId;
    let cgstRate = 9;
    let sgstRate = 9;

    if (branchId) {
      const gstRule = await prisma.gSTRule.findUnique({
        where: { branchId },
      });
      if (gstRule) {
        cgstRate = Number(gstRule.cgstRate);
        sgstRate = Number(gstRule.sgstRate);
      }
    }
    const totalTaxRate = cgstRate + sgstRate;

    let grandBaseTotal = 0;
    let grandDiscountTotal = 0;
    let grandTaxTotal = 0;
    let grandCGSTTotal = 0;
    let grandSGSTTotal = 0;
    let grandDeposit = 0;
    let grandFinalTotal = 0;
    let grandAdvanceAmount = 0; // sum of per-vehicle fixed advance amounts

    // Calculate total duration info once for the booking overall constraints
    const bookingDuration = DurationCalculatorService.calculate(
      startDateDt,
      endDateDt,
    );

    // Batch availability check (DB + Redis holds) — single call for all vehicles
    const vehicleIdToPublicId = new Map(vehiclesData.map((v) => [v.id, v.publicId]));
    const unavailableIds = await getUnavailableVehicleIds(
      vehiclesData.map((v) => v.id),
      startDate,
      endDate,
      vehicleIdToPublicId,
    );
    for (const v of vehiclesData) {
      if (unavailableIds.has(v.id)) {
        return res.status(StatusCode.CONFLICT).json({
          message: `Vehicle ${v.make} ${v.model} is not available for the selected dates`,
        });
      }
    }

    for (const v of vehiclesData) {

      // Calculate pricing via Phase 2 Pricing Engine
      const pricingResult = await pricingEngine.calculateBookingPrice(
        v.id,
        startDateDt,
        endDateDt,
        v.branchId,
      );

      const baseTotal = Number(pricingResult.basePrice.toString());
      const days = bookingDuration.days;
      const discountPercent =
        Number(pricingResult.discountPercent.toString()) / 100;
      const discountAmount = Number(pricingResult.discountAmount.toString());

      const deposit = Number(pricingResult.deposit.toString());

      const taxAmount = Number(pricingResult.taxAmount.toString());
      const cgstAmount = Number(pricingResult.cgstAmount.toString());
      const sgstAmount = Number(pricingResult.sgstAmount.toString());

      const finalTotal = Number(
        pricingResult.finalTotal.add(pricingResult.deposit).toString(),
      );

      items.push({
        publicId: v.publicId,
        make: v.make,
        model: v.model,
        category: v.category.name,
        branch: v.branch.name,
        vehicleId: v.id,
        days: bookingDuration.days,
        baseTotal,
        discountAmount,
        discountPercent: discountPercent * 100, // as percentage (e.g., 10 instead of 0.1)
        deposit,
        taxAmount,
        cgstAmount,
        sgstAmount,
        taxRate: Number(pricingResult.taxRate.toString()),
        finalTotal,
        // Include new details for frontend or snapshot
        pricingBreakdown: {
          periodType: pricingResult.pricingBreakdown.periodType,
          billableHours: bookingDuration.billableDuration,
          actualHours: bookingDuration.actualDuration,
          freeKmLimit: pricingResult.freeKmLimit,
          extraKmRate: Number(pricingResult.extraKmRate.toString()),
        },
      });

      grandBaseTotal += baseTotal;
      grandDiscountTotal += discountAmount;
      grandTaxTotal += taxAmount;
      grandCGSTTotal += cgstAmount;
      grandSGSTTotal += sgstAmount;
      grandDeposit += deposit;
      grandFinalTotal += finalTotal;
      grandAdvanceAmount += Number(v.advancePayAmount ?? 0);
    }

    grandBaseTotal = Number(grandBaseTotal.toFixed(2));
    grandDiscountTotal = Number(grandDiscountTotal.toFixed(2));
    grandTaxTotal = Number(grandTaxTotal.toFixed(2));
    grandCGSTTotal = Number(grandCGSTTotal.toFixed(2));
    grandSGSTTotal = Number(grandSGSTTotal.toFixed(2));
    grandDeposit = Number(grandDeposit.toFixed(2));
    grandFinalTotal = Number(grandFinalTotal.toFixed(2));
    grandAdvanceAmount = Number(grandAdvanceAmount.toFixed(2));

    const isAdvancePayment = payment_flow === "ADVANCE";

    // Validate advance payment eligibility
    if (isAdvancePayment) {
      if (grandAdvanceAmount <= 0) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Advance payment is not configured for the selected vehicle(s). Please use full payment.",
        });
      }
      if (grandAdvanceAmount >= grandFinalTotal) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Advance amount must be less than the total amount. Please use full payment.",
        });
      }
    }

    const chargeAmount = isAdvancePayment ? grandAdvanceAmount : grandFinalTotal;
    const remainingBalance = isAdvancePayment
      ? Number((grandFinalTotal - grandAdvanceAmount).toFixed(2))
      : 0;

    let transactionId: string;
    let paymentURL: string;
    let encryptedFinalPrice: string | null = null;
    if (parsed.data.payment_type === "ONLINE") {
      const redirectUrl = process.env.REDIRECT_URL_PAY;
      const customerRedirectUrl = `${redirectUrl}/booking/status`;
      try {
        const paymentDetails = await initiatePhonePePayment(
          chargeAmount,
          customerRedirectUrl,
        );
        if (!paymentDetails || !paymentDetails.merchantTransactionId) {
          throw new Error("Invalid payment details received");
        }
        transactionId = paymentDetails.merchantTransactionId;
        paymentURL = paymentDetails.instrumentResponse.redirectInfo.url;
      } catch (error: any) {
        console.error("Error initiating payment:", error);
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          message: error.message || "Failed to initiate payment gateway",
        });
      }
    } else {
      transactionId = createID();
      paymentURL = "";
      encryptedFinalPrice = await jwt.sign(
        { finalPrice: chargeAmount },
        process.env.JWT_SECERT!,
        {
          expiresIn: "10m",
        },
      );
    }
    const booking = await prisma.$transaction(async (tx) => {
      const newBooking = await tx.booking.create({
        data: {
          publicId: createID(),
          customerId: customerId,
          kycFileId: kycFile.id,
          branchId: vehiclesData[0]!.branchId,
          startAt: startDate,
          endAt: endDate,
          days: bookingDuration.days,
          rentalPeriodType: bookingDuration.periodType,
          actualHours: new Decimal(bookingDuration.actualDuration.toString()),
          billableHours: new Decimal(
            bookingDuration.billableDuration.toString(),
          ),
          holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          totalBase: grandBaseTotal,
          totalDiscount: grandDiscountTotal,
          totalDeposit: grandDeposit,
          totalTax: grandTaxTotal,
          totalFinal: grandFinalTotal,
          isAdvancePayment: isAdvancePayment,
          advanceAmount: isAdvancePayment ? grandAdvanceAmount : 0,
          remainingBalance: remainingBalance,
          transactionId,
          pricingSnapshot: {
            items,
            totals: {
              grandBaseTotal,
              grandDiscountTotal,
              grandDeposit,
              grandTaxTotal,
              grandCGSTTotal,
              grandSGSTTotal,
              taxRate: totalTaxRate,
              grandFinalTotal,
            },
          },
          createdById: userData.id,
        },
      });
      await tx.bookingItem.createMany({
        data: items.map((i: any) => ({
          bookingId: newBooking.id,
          vehicleId: i.vehicleId,
          days: i.days,
          baseTotal: i.baseTotal,
          discountAmount: i.discountAmount,
          discountPercent: i.discountPercent,
          deposit: i.deposit,
          taxAmount: i.taxAmount,
          cgstAmount: i.cgstAmount,
          sgstAmount: i.sgstAmount,
          taxRate: i.taxRate,
          finalTotal: i.finalTotal,
        })),
      });

      return newBooking;
    });

    const holdId = booking.publicId;
    const holdExpiry = 10 * 60;

    const holdData = {
      vehicles: items,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totals: {
        grandBaseTotal,
        grandDiscountTotal,
        grandDeposit,
        grandTaxTotal,
        grandCGSTTotal,
        grandSGSTTotal,
        taxRate: totalTaxRate,
        grandFinalTotal,
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + holdExpiry * 1000).toISOString(),
    };

    await redis.setex(holdId, holdExpiry, JSON.stringify(holdData));

    const pipeline = redis.pipeline();
    for (const v of vehiclesData) {
      pipeline.sadd(`vehicle_holds:${v.publicId}`, holdId);
      pipeline.expire(`vehicle_holds:${v.publicId}`, holdExpiry);
    }
    await pipeline.exec();

    // Targeted availability cache invalidation (TASK-019)
    try {
      await invalidateVehicleAvailability(redis, vehiclesData.map((v) => v.id));
    } catch (redisErr) {
      console.warn("[booking] Cache invalidation failed (non-fatal):", redisErr);
    }

    return res.status(StatusCode.OK).json({
      message: "Summary created successfully",
      holdId,
      payment_type: parsed.data.payment_type,
      payment_flow,
      isAdvancePayment,
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
          grandTaxTotal,
          grandCGSTTotal,
          grandSGSTTotal,
          taxRate: totalTaxRate,
          grandFinalTotal,
          advanceAmount: isAdvancePayment ? grandAdvanceAmount : grandFinalTotal,
          remainingBalance,
          paymentURL,
          encryptedFinalPrice,
          transactionId,
        },
      },
    });
  } catch (e: any) {
    console.error("Error generating booking summary:", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal server error while generating booking summary",
    });
  }
};
