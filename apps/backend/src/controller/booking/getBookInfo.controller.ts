import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { bookingSummarySchema } from "@repo/schemas";
import { redis } from "../../lib/redisconfig.js";
import { getUnavailableVehicleIds } from "../../utils/availability/availabilityBatch.js";
import {
  checkCustomerTypeClassLimits,
  checkCustomerTypeClassLimitsInTx,
  type VehicleWithTypeClass,
} from "../../utils/booking/customerTypeClassLimits.js";
import {
  validateBookingSchedule,
  buildScheduleErrorMessage,
  type BranchScheduleConfig,
} from "../../utils/booking/branchScheduleValidator.js";
import { invalidateVehicleAvailability, invalidateGroupListingCache } from "../../utils/cache/vehicleCacheKeys.js";
import { initiatePhonePePayment } from "../../utils/payment/paymentCreate.utils.js";
import { createID } from "../../utils/nanoID.js";
import jwt from "jsonwebtoken";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import { chargeConfigService } from "../../services/charges/charge-config.service.js";
import Decimal from "decimal.js";

const pricingEngine = new PricingEngineService();

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

/**
 * Atomically resolves a groupKey to the best available vehicle within a Prisma transaction.
 * Checks only DB-level CONFIRMED/PICKED_UP conflicts — Redis holds are checked outside.
 * Selects the lowest-odometer candidate to distribute fleet wear evenly.
 */
async function resolveVehicleFromGroup(
  groupKey: string,
  startDate: Date,
  endDate: Date,
  tx: typeof prisma,
): Promise<NonNullable<Awaited<ReturnType<typeof prisma.vehicle.findFirst>>>> {
  const parsed = parseGroupKey(groupKey);
  if (!parsed) throw Object.assign(new Error("Invalid groupKey format"), { code: "INVALID_GROUP_KEY", status: 400 });

  const { make, model, categoryId, branchId } = parsed;

  const candidates = await tx.vehicle.findMany({
    where: { make, model, categoryId, branchId, status: "AVAILABLE", deletedAt: null, insuranceExpiry: { gt: new Date() } },
    include: {
      category: true,
      branch: { include: { pricingSetting: true } },
      pricingOverride: true,
      customPricing: true,
    },
    orderBy: { odo: "asc" },
    take: 10,
  });

  if (candidates.length === 0) {
    throw Object.assign(new Error("No vehicles available for this group"), { code: "NO_VEHICLE_AVAILABLE", status: 409 });
  }

  for (const candidate of candidates) {
    const conflict = await tx.bookingItem.findFirst({
      where: {
        vehicleId: candidate.id,
        booking: {
          status: { in: ["CONFIRMED", "PICKED_UP"] },
          startAt: { lt: endDate },
          endAt:   { gt: startDate },
        },
      },
      select: { id: true },
    });
    if (!conflict) return candidate as any;
  }

  throw Object.assign(new Error("All vehicles in this group are booked for the selected dates"), { code: "NO_VEHICLE_AVAILABLE", status: 409 });
}

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
    const { vehicles, groupKeys, start, end, file_public_id, payment_flow, couponCode } = parsed.data;
    const customerId = userData.customerProfile.id;
    const kycFile = await prisma.fileObject.findUnique({
      where: { publicId: file_public_id },
      select: { id: true, customerKycs: { select: { customer: { select: { userId: true } } } } },
    });

    if (!kycFile) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid KYC document" });
    }

    const kycOwner = kycFile.customerKycs?.[0]?.customer?.userId;
    if (kycOwner && kycOwner !== userData.id) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "KYC document does not belong to your account" });
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

    // ── Resolve groupKeys to specific vehicles (atomic within the DB transaction below) ──
    // We pre-check here (outside tx) to return early on obvious mismatches.
    // The transaction below re-validates and assigns the actual vehicle atomically.
    const resolvedGroupVehicles: (typeof vehiclesData) = [];
    const resolvedGroupKeys: string[] = groupKeys ?? [];

    if (resolvedGroupKeys.length > 0) {
      for (const gk of resolvedGroupKeys) {
        if (!parseGroupKey(gk)) {
          return res.status(StatusCode.BAD_REQUEST).json({ message: `Invalid group key: ${gk}` });
        }
      }
    }

    // ── Fetch directly-referenced vehicles ────────────────────────────────────
    const vehiclesData = await prisma.vehicle.findMany({
      where: {
        publicId: { in: vehicles.length > 0 ? vehicles : ["__none__"] },
        status: "AVAILABLE",
        deletedAt: null,
      },
      include: {
        category: true,
        branch: { include: { pricingSetting: true } },
        pricingOverride: true,
        customPricing: true,
      },
    });

    if (vehiclesData.length !== vehicles.length) {
      const foundIds = vehiclesData.map((v) => v.publicId);
      const missingIds = vehicles.filter((id: string) => !foundIds.includes(id));
      return res.status(StatusCode.NOT_FOUND).json({
        message: "One or more vehicles not found",
        missingVehicles: missingIds,
      });
    }

    const items: any = [];

    // GST Rule Fetching — branchId is resolved from either directly-referenced vehicles
    // or from the parsed groupKey (for pure group-key bookings)
    let bookingBranchId: number | undefined = vehiclesData[0]?.branchId;
    if (!bookingBranchId && resolvedGroupKeys.length > 0) {
      const firstParsed = parseGroupKey(resolvedGroupKeys[0]!);
      bookingBranchId = firstParsed?.branchId;
    }
    let cgstRate = 9;
    let sgstRate = 9;

    if (bookingBranchId) {
      const gstRule = await prisma.gSTRule.findUnique({
        where: { branchId: bookingBranchId },
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

    // Batch availability check (DB + Redis holds) — single call for directly-referenced vehicles
    if (vehiclesData.length > 0) {
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
    }

    // ── Type-class limit pre-check ────────────────────────────────────────────
    // Build a representative entry for each groupKey slot using its categoryId
    // so we can detect conflicts before the transaction resolves the actual vehicle.
    const groupKeyRepVehicles: VehicleWithTypeClass[] = [];
    if (resolvedGroupKeys.length > 0) {
      const groupCategoryIds = resolvedGroupKeys.map((gk) => parseGroupKey(gk)!.categoryId);
      const groupCategories = await prisma.vehicleCategory.findMany({
        where: { id: { in: groupCategoryIds } },
        select: { id: true, typeClass: true },
      });
      const categoryTypeMap = new Map(groupCategories.map((c) => [c.id, c.typeClass]));
      for (const gk of resolvedGroupKeys) {
        const gkParsed = parseGroupKey(gk)!;
        groupKeyRepVehicles.push({
          id: 0,
          make: gkParsed.make,
          model: gkParsed.model,
          category: { typeClass: categoryTypeMap.get(gkParsed.categoryId) ?? "OTHER" },
        });
      }
    }

    // ── Branch schedule validation ────────────────────────────────────────────
    if (bookingBranchId) {
      const branchScheduleData = await prisma.branch.findUnique({
        where: { id: bookingBranchId },
        select: {
          graceMinutes: true,
          is24Hours: true,
          schedules: { select: { dayOfWeek: true, isOpen: true, openTime: true, closeTime: true } },
        },
      });

      if (branchScheduleData) {
        const scheduleConfig: BranchScheduleConfig = {
          schedules: branchScheduleData.schedules,
          graceMinutes: branchScheduleData.graceMinutes,
          is24Hours: branchScheduleData.is24Hours,
        };

        // Times are already in IST (TimezoneService.toPrisma converts to UTC for DB,
        // but for schedule comparison we need local time — use the original Luxon DT)
        const pickupLocal = startDateDt.toJSDate();
        const returnLocal = endDateDt.toJSDate();

        const verdict = validateBookingSchedule(scheduleConfig, pickupLocal, returnLocal);

        if (verdict.status.startsWith("PICKUP_") || verdict.status === "NO_OPEN_DAY_IN_WINDOW") {
          return res.status(StatusCode.BAD_REQUEST).json({
            code: "BRANCH_SCHEDULE_VIOLATION",
            message: buildScheduleErrorMessage(verdict),
            verdict,
          });
        }

        if (verdict.status === "RETURN_BUMPED" && verdict.adjustedReturn) {
          // Client should have already adjusted; if not, reject so they recalculate pricing
          return res.status(StatusCode.BAD_REQUEST).json({
            code: "BRANCH_SCHEDULE_RETURN_ADJUSTED",
            message: `Return time adjusted to ${verdict.nextOpenLabel ?? "next available time"} due to branch operating hours. Please confirm the new return time.`,
            verdict,
          });
        }
      }
    }

    const { conflicts: typeClassConflicts } = await checkCustomerTypeClassLimits(
      customerId,
      [...vehiclesData, ...groupKeyRepVehicles],
      startDate,
      endDate,
    );
    if (typeClassConflicts.length > 0) {
      const c = typeClassConflicts[0]!;
      const label = c.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler";
      return res.status(StatusCode.CONFLICT).json({
        code: "VEHICLE_TYPE_LIMIT_EXCEEDED",
        message: `You already have an active ${label} booking that overlaps the selected dates. Only one ${label} booking is allowed at a time.`,
        conflicts: typeClassConflicts,
      });
    }

    for (const v of vehiclesData) {

      // Calculate pricing via Phase 2 Pricing Engine
      const pricingResult = await pricingEngine.calculateBookingPrice(
        v.id,
        startDateDt,
        endDateDt,
        v.branchId,
        customerId,
        couponCode?.toUpperCase(),
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
        appliedCouponCode: pricingResult.appliedCouponCode ?? null,
        couponRuleId: pricingResult.couponRuleId ?? null,
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

    // Pre-price group vehicles so grand totals are correct before payment initiation.
    // All vehicles in a group share the same pricing rules, so this representative
    // pricing matches what the transaction will compute for the atomically resolved vehicle.
    if (resolvedGroupKeys.length > 0) {
      for (const gk of resolvedGroupKeys) {
        const gkParsed = parseGroupKey(gk)!;
        console.log(`[booking] resolving group key: ${gk} → make:${gkParsed.make} model:${gkParsed.model} categoryId:${gkParsed.categoryId} branchId:${gkParsed.branchId}`);
        const repVehicle = await prisma.vehicle.findFirst({
          where: {
            make: gkParsed.make,
            model: gkParsed.model,
            categoryId: gkParsed.categoryId,
            branchId: gkParsed.branchId,
            status: "AVAILABLE",
            deletedAt: null,
            insuranceExpiry: { gt: new Date() },
          },
          select: { id: true, branchId: true, advancePayAmount: true },
          orderBy: { odo: "asc" },
        });
        if (!repVehicle) {
          return res.status(StatusCode.CONFLICT).json({ message: `No vehicles available for group ${gk}` });
        }
        console.log(`[booking] repVehicle id:${repVehicle.id} branchId:${repVehicle.branchId}`);
        const pr = await pricingEngine.calculateBookingPrice(
          repVehicle.id, startDateDt, endDateDt, repVehicle.branchId, customerId, couponCode?.toUpperCase(),
        );
        console.log(`[booking] pricing for vehicle ${repVehicle.id}: base:${pr.basePrice} discount:${pr.discountAmount} tax:${pr.taxAmount} deposit:${pr.deposit} finalTotal:${pr.finalTotal}`);
        grandBaseTotal     += Number(pr.basePrice.toString());
        grandDiscountTotal += Number(pr.discountAmount.toString());
        grandTaxTotal      += Number(pr.taxAmount.toString());
        grandCGSTTotal     += Number(pr.cgstAmount.toString());
        grandSGSTTotal     += Number(pr.sgstAmount.toString());
        grandDeposit       += Number(pr.deposit.toString());
        grandFinalTotal    += Number(pr.finalTotal.add(pr.deposit).toString());
        grandAdvanceAmount += Number(repVehicle.advancePayAmount ?? 0);
      }
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

    console.log(`[booking] pricing summary — base:${grandBaseTotal} discount:${grandDiscountTotal} tax:${grandTaxTotal} deposit:${grandDeposit} finalTotal:${grandFinalTotal} chargeAmount:${chargeAmount}`);

    if (chargeAmount <= 0) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Pricing error: calculated charge is ₹${chargeAmount}. Please ensure branch pricing or vehicle custom pricing is configured for this vehicle category.`,
      });
    }

    const remainingBalance = isAdvancePayment
      ? Number((grandFinalTotal - grandAdvanceAmount).toFixed(2))
      : 0;

    let transactionId: string;
    let paymentURL: string;
    let encryptedFinalPrice: string | null = null;
    if (parsed.data.payment_type === "ONLINE") {
      // Mobile deep-link takes priority so PhonePe redirects back to the app directly.
      // Falls back to the web frontend URL for web-initiated bookings.
      const customerRedirectUrl = process.env.MOBILE_REDIRECT_URL
        ?? `${process.env.REDIRECT_URL_PAY}/booking/status`;
      try {
        const paymentDetails = await initiatePhonePePayment(
          chargeAmount,
          customerRedirectUrl,
          customerpubId,
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
          message: `Payment failed (charge: ₹${chargeAmount}): ${error.message || "Failed to initiate payment gateway"}`,
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

    // Freeze branch charge config so return-flow employees see the correct modules
    const frozenChargeConfig = bookingBranchId
      ? await chargeConfigService.freezeChargeConfig(bookingBranchId)
      : null;

    const booking = await prisma.$transaction(async (tx) => {
      // Atomically resolve each groupKey to a specific vehicle within the transaction
      for (const gk of resolvedGroupKeys) {
        try {
          const resolved = await resolveVehicleFromGroup(gk, startDate, endDate, tx as any);
          resolvedGroupVehicles.push(resolved as any);
        } catch (err: any) {
          if (err.code === "NO_VEHICLE_AVAILABLE") {
            const parsed2 = parseGroupKey(gk);
            throw Object.assign(
              new Error(`No vehicles available for ${parsed2?.make ?? ""} ${parsed2?.model ?? ""} on the selected dates. Please try different dates or refresh to see current availability.`),
              { code: "NO_VEHICLE_AVAILABLE", status: 409 },
            );
          }
          throw err;
        }
      }

      // Re-price the resolved group vehicles and add them to items.
      // Grand totals were already computed from representative vehicles before payment
      // initiation — do NOT add to them again here to avoid double-counting.
      for (const v of resolvedGroupVehicles) {
        const pricingResult = await pricingEngine.calculateBookingPrice(
          v.id,
          startDateDt,
          endDateDt,
          v.branchId,
          customerId,
          couponCode?.toUpperCase(),
        );

        const baseTotal       = Number(pricingResult.basePrice.toString());
        const discountPercent = Number(pricingResult.discountPercent.toString()) / 100;
        const discountAmount  = Number(pricingResult.discountAmount.toString());
        const deposit         = Number(pricingResult.deposit.toString());
        const taxAmount       = Number(pricingResult.taxAmount.toString());
        const cgstAmount      = Number(pricingResult.cgstAmount.toString());
        const sgstAmount      = Number(pricingResult.sgstAmount.toString());
        const finalTotal      = Number(pricingResult.finalTotal.add(pricingResult.deposit).toString());

        items.push({
          publicId:          v.publicId,
          make:              v.make,
          model:             v.model,
          category:          v.category.name,
          branch:            v.branch.name,
          vehicleId:         v.id,
          days:              bookingDuration.days,
          baseTotal,
          discountAmount,
          discountPercent:   discountPercent * 100,
          appliedCouponCode: pricingResult.appliedCouponCode ?? null,
          couponRuleId:      pricingResult.couponRuleId ?? null,
          deposit,
          taxAmount,
          cgstAmount,
          sgstAmount,
          taxRate:    Number(pricingResult.taxRate.toString()),
          finalTotal,
          pricingBreakdown: {
            periodType:    pricingResult.pricingBreakdown.periodType,
            billableHours: bookingDuration.billableDuration,
            actualHours:   bookingDuration.actualDuration,
            freeKmLimit:   pricingResult.freeKmLimit,
            extraKmRate:   Number(pricingResult.extraKmRate.toString()),
          },
        });
      }

      // Race-condition guard: re-validate type-class limit inside the transaction
      const allResolvedVehicles = [...vehiclesData, ...resolvedGroupVehicles];
      const { conflicts: txTypeClassConflicts } = await checkCustomerTypeClassLimitsInTx(
        tx as any,
        customerId,
        allResolvedVehicles,
        startDate,
        endDate,
      );
      if (txTypeClassConflicts.length > 0) {
        const c = txTypeClassConflicts[0]!;
        const label = c.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler";
        throw Object.assign(
          new Error(`You already have an active ${label} booking that overlaps the selected dates.`),
          { code: "VEHICLE_TYPE_LIMIT_EXCEEDED", conflicts: txTypeClassConflicts },
        );
      }

      const newBooking = await tx.booking.create({
        data: {
          publicId: createID(),
          customerId: customerId,
          kycFileId: kycFile.id,
          branchId: (vehiclesData[0]?.branchId ?? resolvedGroupVehicles[0]?.branchId)!,
          startAt: startDate,
          endAt: endDate,
          days: bookingDuration.days,
          rentalPeriodType: bookingDuration.periodType,
          actualHours: new Decimal(bookingDuration.actualDuration.toString()),
          billableHours: new Decimal(
            bookingDuration.billableDuration.toString(),
          ),
          holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          ...(items[0]?.appliedCouponCode
            ? {
                couponCode: items[0].appliedCouponCode,
                discountRuleId: items[0].couponRuleId ?? undefined,
              }
            : {}),
          totalBase: grandBaseTotal,
          totalDiscount: grandDiscountTotal,
          totalDeposit: grandDeposit,
          totalTax: grandTaxTotal,
          totalFinal: grandFinalTotal,
          isAdvancePayment: isAdvancePayment,
          advanceAmount: isAdvancePayment ? grandAdvanceAmount : 0,
          remainingBalance: remainingBalance,
          transactionId,
          ...(frozenChargeConfig ? { frozenChargeConfig: frozenChargeConfig as any } : {}),
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
    }, { timeout: 20000 });

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

    const allBookedVehicles = [...vehiclesData, ...resolvedGroupVehicles];
    const pipeline = redis.pipeline();
    for (const v of allBookedVehicles) {
      pipeline.sadd(`vehicle_holds:${v.publicId}`, holdId);
      pipeline.expire(`vehicle_holds:${v.publicId}`, holdExpiry);
    }
    await pipeline.exec();

    // Targeted availability cache invalidation
    try {
      await invalidateVehicleAvailability(redis, allBookedVehicles.map((v) => v.id));
    } catch (redisErr) {
      console.warn("[booking] Cache invalidation failed (non-fatal):", redisErr);
    }

    // Invalidate group listing caches for all affected groups
    try {
      await invalidateGroupListingCache(redis as any);
    } catch (redisErr) {
      console.warn("[booking] Group cache invalidation failed (non-fatal):", redisErr);
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
          appliedCouponCode: items[0]?.appliedCouponCode ?? null,
          advanceAmount: isAdvancePayment ? grandAdvanceAmount : grandFinalTotal,
          remainingBalance,
          paymentURL,
          encryptedFinalPrice,
          transactionId,
        },
      },
    });
  } catch (e: any) {
    if (e?.code === "NO_VEHICLE_AVAILABLE") {
      return res.status(409).json({ code: "NO_VEHICLE_AVAILABLE", message: e.message });
    }
    if (e?.code === "INVALID_GROUP_KEY") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: e.message });
    }
    if (e?.code === "VEHICLE_TYPE_LIMIT_EXCEEDED") {
      return res.status(StatusCode.CONFLICT).json({
        code: "VEHICLE_TYPE_LIMIT_EXCEEDED",
        message: e.message,
        conflicts: e.conflicts ?? [],
      });
    }
    console.error("Error generating booking summary:", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal server error while generating booking summary",
    });
  }
};
