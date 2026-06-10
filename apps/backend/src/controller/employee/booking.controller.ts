import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, DepositMethod } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { getUnavailableVehicleIds } from "../../utils/availability/availabilityBatch.js";
import {
  checkCustomerTypeClassLimits,
  checkCustomerTypeClassLimitsInTx,
} from "../../utils/booking/customerTypeClassLimits.js";
import {
  validateBookingSchedule,
  buildScheduleErrorMessage,
  type BranchScheduleConfig,
} from "../../utils/booking/branchScheduleValidator.js";
import { parseGroupKey } from "./vehicle.controller.js";
import { createID } from "../../utils/nanoID.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { chargeConfigService } from "../../services/charges/charge-config.service.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { initiatePhonePePayment } from "../../utils/payment/paymentCreate.utils.js";

const pricingEngine = new PricingEngineService();

// ── Booking list (GET /bookings) ──────────────────────────────────────────────

export const BookingController = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { date } = req.query;

    let dateFilter: any = {};
    let cacheKeySuffix = "";

    if (date) {
      const parsedDateDt = TimezoneService.parseISO(date as string);
      if (parsedDateDt.isValid) {
        const startOfDayDt = TimezoneService.startOfDay(parsedDateDt);
        const endOfDayDt = TimezoneService.endOfDay(parsedDateDt);

        dateFilter = {
          gte: TimezoneService.toPrisma(startOfDayDt),
          lte: TimezoneService.toPrisma(endOfDayDt),
        };
        cacheKeySuffix = `date:${parsedDateDt.toFormat("yyyy-MM-dd")}`;
      }
    }

    if (Object.keys(dateFilter).length === 0) {
      const nowDt = TimezoneService.getCurrentTime();
      const startOfDayDt = TimezoneService.startOfDay(nowDt);
      dateFilter = { gte: TimezoneService.toPrisma(startOfDayDt) };
      cacheKeySuffix = `upcoming:${nowDt.toFormat("yyyy-MM-dd")}`;
    }

    const cacheKey = `bookings:${branchId}:${cacheKeySuffix}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.status(StatusCode.OK).json({
        message: "Bookings fetched successfully",
        data: JSON.parse(cachedData),
      });
    }

    const bookings = await prisma.booking.findMany({
      where: {
        branchId,
        startAt: dateFilter,
        status: BookingStatus.CONFIRMED,
      },
      select: {
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        totalFinal: true,
        isAdvancePayment: true,
        advanceAmount: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaidDuring: true,
        customer: {
          select: {
            user: {
              select: { publicId: true, name: true, phone: true },
            },
          },
        },
        items: {
          select: {
            vehicle: {
              select: {
                publicId: true,
                make: true,
                model: true,
                regNo: true,
                status: true,
                images: {
                  where: { isThumbnail: true },
                  take: 1,
                  select: { file: { select: { url: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { startAt: "asc" },
    });

    if (bookings.length === 0) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "No Upcoming Bookings Found",
      });
    }

    await redis.setex(cacheKey, 60, JSON.stringify(bookings));
    return res.status(StatusCode.OK).json({
      message: "Upcoming bookings fetched successfully",
      data: bookings,
    });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error While Fetching Bookings",
    });
  }
};

// ── Create booking ────────────────────────────────────────────────────────────

export const createEmployeeBooking = async (req: Request, res: Response) => {
  try {
    const {
      vehicles,
      group_key,
      customer_public_id,
      customer_kyc_id,
      start,
      end,
      payment_type,
    } = req.body;

    const hasVehicles = Array.isArray(vehicles) && vehicles.length > 0;
    const hasGroupKey = typeof group_key === "string" && group_key.length > 0;

    if (
      (!hasVehicles && !hasGroupKey) ||
      !customer_public_id ||
      !customer_kyc_id ||
      !start ||
      !end ||
      !["CASH", "ONLINE"].includes(payment_type)
    ) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid request payload" });
    }

    const staff = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!staff) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Invalid staff user" });
    }

    const customer = await prisma.user.findUnique({
      where: { publicId: customer_public_id },
      include: { customerProfile: true },
    });
    if (!customer || !customer.customerProfile) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Customer not found" });
    }

    const kycRecord = await prisma.customerKyc.findUnique({
      where: { publicId: customer_kyc_id },
      select: { fileId: true },
    });
    if (!kycRecord || !kycRecord.fileId) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid KYC ID or Document missing" });
    }

    // Parse dates (IST) — used as Luxon DateTime for pricing engine
    const startDateDt = TimezoneService.parseISO(start);
    const endDateDt = TimezoneService.parseISO(end);
    if (!startDateDt.isValid || !endDateDt.isValid) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid dates" });
    }
    const startDate = TimezoneService.toPrisma(startDateDt);
    const endDate = TimezoneService.toPrisma(endDateDt);

    // ── Resolve vehicle list: explicit IDs or pick from group ────────────────
    let resolvedVehicleIds: string[] = hasVehicles ? vehicles : [];

    if (hasGroupKey && !hasVehicles) {
      const parsed = parseGroupKey(group_key);
      if (!parsed) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid group key format" });
      }
      const { make, model, categoryId, branchId } = parsed;

      // Ensure the group belongs to this branch
      if (branchId !== req.branch_Id) {
        return res.status(StatusCode.FORBIDDEN).json({ message: "Group not accessible from this branch" });
      }

      // Find an available vehicle from the group for the requested dates
      const candidates = await prisma.vehicle.findMany({
        where: { make, model, categoryId, branchId, status: "AVAILABLE", deletedAt: null, insuranceExpiry: { gt: new Date() } },
        select: { id: true, publicId: true },
        orderBy: { odo: "asc" },
      });

      if (candidates.length === 0) {
        return res.status(StatusCode.CONFLICT).json({ message: "No vehicles available in this group" });
      }

      const vehicleIdToPublicId = new Map(candidates.map((v) => [v.id, v.publicId]));
      const unavailableIds = await getUnavailableVehicleIds(
        candidates.map((v) => v.id),
        startDate,
        endDate,
        vehicleIdToPublicId,
      );

      const available = candidates.filter((v) => !unavailableIds.has(v.id));
      if (available.length === 0) {
        return res.status(StatusCode.CONFLICT).json({ message: "No vehicles in this group are available for the selected dates" });
      }

      resolvedVehicleIds = [available[0]!.publicId];
    }

    const vehiclesData = await prisma.vehicle.findMany({
      where: { publicId: { in: resolvedVehicleIds } },
      include: {
        category: true,
        branch: { include: { pricingSetting: true } },
        images: { include: { file: true }, take: 1 },
      },
    });

    if (vehiclesData.length !== resolvedVehicleIds.length) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Some vehicles not found" });
    }

    // ── Initial availability check (batch) ────────────────────────────────────

    const vehicleIdToPublicId = new Map(vehiclesData.map((v) => [v.id, v.publicId]));
    const initialUnavailable = await getUnavailableVehicleIds(
      vehiclesData.map((v) => v.id),
      startDate,
      endDate,
      vehicleIdToPublicId,
    );
    for (const v of vehiclesData) {
      if (initialUnavailable.has(v.id)) {
        return res.status(StatusCode.CONFLICT).json({
          message: `Vehicle ${v.make} ${v.model} unavailable for the selected dates`,
        });
      }
    }

    // ── Branch schedule + restriction mode ───────────────────────────────────
    const bypassSchedule =
      req.body.bypassSchedule === true && ["ADMIN", "MANAGER"].includes(staff.role);

    let branchRestrictionMode: "NONE" | "SAME_CATEGORY" | "ANY_VEHICLE" = "SAME_CATEGORY";

    {
      const branchData = await prisma.branch.findUnique({
        where: { id: req.branch_Id },
        select: {
          graceMinutes: true,
          is24Hours: true,
          bookingRestrictionMode: true,
          schedules: { select: { dayOfWeek: true, isOpen: true, openTime: true, closeTime: true } },
        },
      });

      if (branchData) {
        branchRestrictionMode = branchData.bookingRestrictionMode as "NONE" | "SAME_CATEGORY" | "ANY_VEHICLE";

        if (!bypassSchedule) {
          const scheduleConfig: BranchScheduleConfig = {
            schedules: branchData.schedules,
            graceMinutes: branchData.graceMinutes,
            is24Hours: branchData.is24Hours,
          };

          const verdict = validateBookingSchedule(scheduleConfig, startDateDt.toJSDate(), endDateDt.toJSDate());

          if (verdict.status.startsWith("PICKUP_") || verdict.status === "NO_OPEN_DAY_IN_WINDOW") {
            return res.status(StatusCode.BAD_REQUEST).json({
              code: "BRANCH_SCHEDULE_VIOLATION",
              message: buildScheduleErrorMessage(verdict),
              verdict,
            });
          }

          if (verdict.status === "RETURN_BUMPED" && verdict.adjustedReturn) {
            return res.status(StatusCode.BAD_REQUEST).json({
              code: "BRANCH_SCHEDULE_RETURN_ADJUSTED",
              message: `Return time adjusted to ${verdict.nextOpenLabel ?? "next available time"} due to branch operating hours.`,
              verdict,
            });
          }
        }
      }
    }

    // ── Type-class limit check ─────────────────────────────────────────────────
    const bypassLimit =
      req.body.bypassTypeClassLimit === true &&
      ["ADMIN", "MANAGER"].includes(staff.role);
    const { conflicts: typeClassConflicts } = await checkCustomerTypeClassLimits(
      customer.customerProfile.id,
      vehiclesData,
      startDate,
      endDate,
      { bypassLimit, restrictionMode: branchRestrictionMode, branchId: req.branch_Id },
    );
    if (typeClassConflicts.length > 0) {
      const c = typeClassConflicts[0]!;
      const message =
        c.reason === "ANY_VEHICLE"
          ? "This customer already has an active booking at this branch that overlaps the selected dates."
          : `This customer already has an active ${c.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler"} booking that overlaps the selected dates.`;
      return res.status(StatusCode.CONFLICT).json({
        code: "VEHICLE_TYPE_LIMIT_EXCEEDED",
        message,
        conflicts: typeClassConflicts,
      });
    }

    // ── Pricing via PricingEngineService (TASK-010 / TASK-011) ───────────────
    // Fixes the 13-hour bug: PricingEngineService uses DurationCalculatorService
    // which correctly classifies 13 hours as FULL_DAY (not 2 calendar days).

    const items: any[] = [];
    let grandBaseTotal    = 0;
    let grandDiscountTotal = 0;
    let grandTaxTotal      = 0;
    let grandCGSTTotal     = 0;
    let grandSGSTTotal     = 0;
    let grandDeposit       = 0;
    let grandFinalTotal    = 0;

    for (const v of vehiclesData) {
      const pricingResult = await pricingEngine.calculateBookingPrice(
        v.id,
        startDateDt,
        endDateDt,
        v.branchId,
        customer.customerProfile!.id,
        undefined,  // no coupon
        undefined,  // no manualDiscountAmount
        undefined,  // no manualDiscountId
        v.categoryId,  // TASK-001: categoryId already in memory, skip DB lookup
      );

      const baseTotal      = Number(pricingResult.basePrice);
      const discountAmount = Number(pricingResult.discountAmount);
      const discountPercent = Number(pricingResult.discountPercent);
      const deposit        = Number(pricingResult.deposit);
      const taxAmount      = Number(pricingResult.taxAmount);
      const cgstAmount     = Number(pricingResult.cgstAmount);
      const sgstAmount     = Number(pricingResult.sgstAmount);
      const taxRate        = Number(pricingResult.taxRate);
      const days           = pricingResult.pricingBreakdown.duration.days;
      // finalTotal from engine = post-discount base + tax (no deposit).
      // Add deposit to match the existing field semantics for totalFinal.
      const finalTotal     = Number(pricingResult.finalTotal) + deposit;

      items.push({
        vehicleId: v.id,
        make:      v.make,
        model:     v.model,
        category:  v.category?.name,
        image:     v.images[0]?.file?.url,
        regNo:     v.regNo,
        payment_type,
        days,
        baseTotal,
        discountAmount,
        discountPercent,
        deposit,
        taxAmount,
        cgstAmount,
        sgstAmount,
        taxRate,
        finalTotal,
      });

      grandBaseTotal    += baseTotal;
      grandDiscountTotal += discountAmount;
      grandTaxTotal      += taxAmount;
      grandCGSTTotal     += cgstAmount;
      grandSGSTTotal     += sgstAmount;
      grandDeposit       += deposit;
      grandFinalTotal    += finalTotal;
    }

    grandBaseTotal     = Number(grandBaseTotal.toFixed(2));
    grandDiscountTotal = Number(grandDiscountTotal.toFixed(2));
    grandTaxTotal      = Number(grandTaxTotal.toFixed(2));
    grandCGSTTotal     = Number(grandCGSTTotal.toFixed(2));
    grandSGSTTotal     = Number(grandSGSTTotal.toFixed(2));
    grandDeposit       = Number(grandDeposit.toFixed(2));
    grandFinalTotal    = Number(grandFinalTotal.toFixed(2));

    // ── Final revalidation before DB write (TASK-012) ─────────────────────────
    // Prevents race conditions: re-check availability immediately before persisting.

    const finalUnavailable = await getUnavailableVehicleIds(
      vehiclesData.map((v) => v.id),
      startDate,
      endDate,
      vehicleIdToPublicId,
    );
    for (const v of vehiclesData) {
      if (finalUnavailable.has(v.id)) {
        console.log(`[booking] revalidation conflict: vehicle ${v.id} (${v.publicId})`);
        return res.status(StatusCode.CONFLICT).json({
          message: `Vehicle ${v.make} ${v.model} was just booked. Please select different dates or vehicle.`,
        });
      }
    }
    console.log(
      `[booking] revalidation passed: ${vehiclesData.length} vehicles clear before DB write`,
    );

    // ── Payment initiation ────────────────────────────────────────────────────

    let transactionId: string | null = null;
    let paymentURL: string | null = null;

    if (payment_type === "ONLINE") {
      const frontendUrl = process.env.REDIRECT_URL_PAY;
      const employeeRedirectBase = `${frontendUrl}/employee/booking/status`;
      try {
        const paymentDetails = await initiatePhonePePayment(
          grandFinalTotal,
          employeeRedirectBase,
        );
        if (!paymentDetails || !paymentDetails.merchantTransactionId) {
          throw new Error("Invalid payment details received from gateway");
        }
        transactionId = paymentDetails.merchantTransactionId;
        paymentURL = paymentDetails.instrumentResponse.redirectInfo.url;
      } catch (error: any) {
        console.error("Error initiating employee booking payment:", error);
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          message: error.message || "Failed to initiate payment gateway",
        });
      }
    } else {
      transactionId = `CASH_${createID()}`;
    }

    // ── Freeze charge config snapshot ─────────────────────────────────────────

    const frozenChargeConfig = await chargeConfigService.freezeChargeConfig(
      vehiclesData[0]!.branchId,
    );

    // ── DB transaction ────────────────────────────────────────────────────────

    const totalTaxRate = items[0]?.taxRate ?? 0;

    const booking = await prisma.$transaction(async (tx) => {
      // Race-condition guard: re-check inside transaction before committing
      if (!bypassLimit) {
        const { conflicts: txTypeClassConflicts } = await checkCustomerTypeClassLimitsInTx(
          tx as any,
          customer.customerProfile!.id,
          vehiclesData,
          startDate,
          endDate,
          { restrictionMode: branchRestrictionMode, branchId: req.branch_Id },
        );
        if (txTypeClassConflicts.length > 0) {
          const c = txTypeClassConflicts[0]!;
          const msg =
            c.reason === "ANY_VEHICLE"
              ? "This customer already has an active booking at this branch that overlaps the selected dates."
              : `This customer already has an active ${c.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler"} booking that overlaps the selected dates.`;
          throw Object.assign(new Error(msg), {
            code: "VEHICLE_TYPE_LIMIT_EXCEEDED",
            conflicts: txTypeClassConflicts,
          });
        }
      }

      const newBooking = await tx.booking.create({
        data: {
          publicId:     createID(),
          customerId:   customer.customerProfile!.id,
          kycFileId:    kycRecord.fileId!,
          branchId:     vehiclesData[0]!.branchId,
          startAt:      startDate,
          endAt:        endDate,
          days:         items[0]!.days,
          status:       BookingStatus.HOLD,
          holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          paymentStatus: "CREATED",
          depositMethod:
            payment_type === "CASH"
              ? DepositMethod.CASH
              : DepositMethod.ONLINE_RAZORPAY,
          totalBase:    grandBaseTotal,
          totalDiscount: grandDiscountTotal,
          totalDeposit:  grandDeposit,
          totalTax:      grandTaxTotal,
          totalFinal:    grandFinalTotal,
          transactionId,
          frozenChargeConfig: frozenChargeConfig as any,
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
          createdById: staff.id,
        },
      });

      await tx.bookingItem.createMany({
        data: items.map((i) => ({
          bookingId:       newBooking.id,
          vehicleId:       i.vehicleId,
          days:            i.days,
          baseTotal:       i.baseTotal,
          discountAmount:  i.discountAmount,
          discountPercent: i.discountPercent,
          deposit:         i.deposit,
          taxAmount:       i.taxAmount,
          cgstAmount:      i.cgstAmount,
          sgstAmount:      i.sgstAmount,
          taxRate:         i.taxRate,
          finalTotal:      i.finalTotal,
        })),
      });

      return newBooking;
    }, { timeout: 10000 });

    // Staff activity log is non-critical — run outside the transaction so its
    // internal prisma.user lookup doesn't compete for connections while the
    // transaction is open (which caused P2028 timeouts).
    staffActivityService.logFromRequest(req, {
      actionType:  StaffActionType.CREATED,
      entityType:  StaffEntityType.BOOKING,
      entityRef:   booking.publicId,
      description: `Booking ${booking.publicId} created`,
    }).catch((err) => console.error("[createEmployeeBooking] Staff activity log error (non-fatal):", err));

    // Audit log is non-critical — run after the transaction commits to avoid
    // holding the transaction open while the audit service does its own DB write.
    auditService.log({
      actorId: staff.id,
      actorName: staff.name,
      actorRole: staff.role,
      actorBranchId: staff.branchId ?? undefined,
      action: "BOOKING_CREATED",
      category: AuditCategory.BOOKING,
      description: `Booking created for customer ${customer.name} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
      entity: "Booking",
      entityId: booking.publicId,
      entityLabel: booking.publicId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      after: { status: booking.status, totalFinal: grandFinalTotal, vehicles: resolvedVehicleIds },
    }).catch((err) => console.error("[createEmployeeBooking] Audit log error (non-fatal):", err));

    // ── Targeted cache invalidation (TASK-019) ────────────────────────────────
    // Replaces SCAN/DEL of all public:vehicles:* with per-vehicle key deletion.

    try {
      await invalidateVehicleAvailability(redis, vehiclesData.map((v) => v.id));
    } catch (redisErr) {
      console.warn("[booking] Cache invalidation failed (non-fatal):", redisErr);
    }

    const snapshot = booking.pricingSnapshot as any;

    const holdExpiry = 10 * 60; // 600 seconds
    return res.status(StatusCode.OK).json({
      message: "Booking Created Successfully",
      data: {
        bookingId:     booking.publicId,
        paymentURL,
        status:        booking.status,
        startDate:     booking.startAt,
        endDate:       booking.endAt,
        transactionId: booking.transactionId,
        totals:        snapshot?.totals,
        items:         snapshot?.items,
        expiresAt:     new Date(Date.now() + holdExpiry * 1000).toISOString(),
        expiresIn:     holdExpiry,
      },
    });
  } catch (error: any) {
    if (error?.code === "VEHICLE_TYPE_LIMIT_EXCEEDED") {
      return res.status(StatusCode.CONFLICT).json({
        code: "VEHICLE_TYPE_LIMIT_EXCEEDED",
        message: error.message,
        conflicts: error.conflicts ?? [],
      });
    }
    console.error("Create Employee Booking Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Error" });
  }
};

// ── Booking detail ────────────────────────────────────────────────────────────

export const GetBookingDetails = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      select: {
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        totalFinal: true,
        requiresManagerConfirmation: true,
        isAdvancePayment: true,
        advanceAmount: true,
        advancePaidAt: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaymentMode: true,
        remainingPaidDuring: true,
        frozenChargeConfig: true,
        startOdometer: true,
        safetyDeposit: true,
        days: true,
        freeKmLimit: true,
        branchId: true,
        fuelRecord: { select: { pickupFuelLevel: true } },
        branch: {
          select: {
            chargeConfig: { select: { usePaymentSessions: true } },
          },
        },
        customer: {
          select: {
            user: {
              select: { publicId: true, name: true, phone: true },
            },
          },
        },
        items: {
          select: {
            vehicleId: true,
            vehicle: {
              select: {
                publicId: true,
                make: true,
                model: true,
                regNo: true,
                status: true,
                odo: true,
                hasFastag: true,
                images: {
                  where: { isThumbnail: true },
                  take: 1,
                  select: { file: { select: { url: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    // Compute effective km limit — use stored value if available, otherwise fall
    // back to vehicle pricing (same logic as return-charge.service)
    let effectiveFreeKmLimit: number | null = booking.freeKmLimit ?? null;
    let extraKmRate: number | null = null;

    if (effectiveFreeKmLimit === null) {
      const vehicleId = booking.items[0]?.vehicleId;
      if (vehicleId) {
        const customPricing = await prisma.vehicleCustomPricing.findUnique({
          where: { vehicleId },
          select: { freeKm24Hour: true, extraKmRate: true },
        });
        if (customPricing) {
          effectiveFreeKmLimit = customPricing.freeKm24Hour * Math.max(1, booking.days ?? 1);
          extraKmRate = Number(customPricing.extraKmRate);
        } else {
          const vehicle = await prisma.vehicle.findUnique({
            where: { id: vehicleId },
            select: { categoryId: true },
          });
          if (vehicle) {
            const branchPricing = await prisma.branchPricingDefaults.findUnique({
              where: { branchId_categoryId: { branchId: booking.branchId, categoryId: vehicle.categoryId } },
              select: { freeKm24Hour: true, extraKmRate: true },
            });
            if (branchPricing) {
              effectiveFreeKmLimit = branchPricing.freeKm24Hour * Math.max(1, booking.days ?? 1);
              extraKmRate = Number(branchPricing.extraKmRate);
            }
          }
        }
      }
    }

    const { branch, fuelRecord, branchId, items, ...bookingData } = booking;
    return res.status(StatusCode.OK).json({
      message: "Booking details fetched successfully",
      data: {
        ...bookingData,
        items: items.map(({ vehicleId: _vid, ...rest }) => rest),
        pickupFuelLevel: fuelRecord?.pickupFuelLevel ?? null,
        effectiveFreeKmLimit,
        extraKmRate,
        usePaymentSessions: branch?.chargeConfig?.usePaymentSessions ?? false,
      },
    });
  } catch (error) {
    console.error("Error fetching booking details:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error While Fetching Booking Details",
    });
  }
};

// ── Debug endpoint ────────────────────────────────────────────────────────────

export const DebugBookings = async (req: Request, res: Response) => {
  const bookings = await prisma.booking.findMany({
    where: { status: { in: ["CONFIRMED", "PICKED_UP"] } },
    include: { items: { include: { vehicle: true } } },
  });

  const start = TimezoneService.toPrisma(TimezoneService.parseISO("2026-02-14"));
  const end = TimezoneService.toPrisma(
    TimezoneService.endOfDay(TimezoneService.parseISO("2026-02-15")),
  );

  const result = bookings.map((b) => ({
    id: b.publicId,
    start: b.startAt,
    end: b.endAt,
    status: b.status,
    vehicles: b.items.map(
      (i) => `${i.vehicle.make} ${i.vehicle.model} (${i.vehicle.publicId})`,
    ),
    overlapCheck: {
      startLtSearchEnd: b.startAt < end,
      endGtSearchStart: b.endAt > start,
      overlaps: b.startAt < end && b.endAt > start,
    },
  }));

  return res.json({ searchRange: { start, end }, bookings: result });
};
