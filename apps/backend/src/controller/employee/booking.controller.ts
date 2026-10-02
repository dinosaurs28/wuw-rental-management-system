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
import { parseGroupKey, normalizeStr } from "./vehicle.controller.js";
import { assertBookingWindow, BookingWindowError } from "../../utils/booking/bookingWindow.js";
import { bookingPeriodFields } from "../../utils/booking/rentalPeriod.js";
import { MONTHLY_MIN_DAYS } from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { chargeConfigService } from "../../services/charges/charge-config.service.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import {
  resolveKmAllowance,
  getOdometerSegments,
  type KmAllowance,
  type OdometerSegments,
} from "../../services/charges/km-allowance.service.js";
import { getRentalTimeline } from "../../services/charges/rental-timeline.service.js";
import { getBranchGstRates, computeLineGst, GstRuleMissingError } from "../../services/tax/gst.service.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import {
  getMissingProfileFields,
  profileFieldsOf,
  profileIncompleteMessage,
} from "../../utils/customer/identity.js";
import {
  checkBookingQrPhotoId,
  getBookingQrPhotoFields,
} from "../../services/qr-photo/customer-qr-photo.service.js";
import {
  parseBookingListType,
  bookingTypeWhere,
  bookingListTypeOf,
  INVALID_BOOKING_TYPE,
} from "../../utils/booking/bookingTypeFilter.js";
import { createRazorpayOrder } from "../../services/payment/razorpay.service.js";
import {
  assertOpenShift,
  validateNewUtr,
  CounterGuardError,
} from "../../services/payment/counter-guard.service.js";
import {
  assertDlFree,
  lockAndAssertDlFree,
  DlInUseError,
} from "../../services/booking/dl-in-use.service.js";

const pricingEngine = new PricingEngineService();

// ── Booking list (GET /bookings) ──────────────────────────────────────────────

// Pickup queue. `?type=DAILY|MONTHLY` splits it into tabs (#17): Daily keeps the
// per-day (IST) scope, Monthly lists every CONFIRMED monthly booking whatever the
// date. No cache — a picked-up booking must leave the queue on the next fetch.
export const BookingController = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { date } = req.query;

    const parsedType = parseBookingListType(req.query.type);
    if (!parsedType.ok) {
      return res.status(StatusCode.BAD_REQUEST).json(INVALID_BOOKING_TYPE);
    }
    const type = parsedType.type;

    let dateFilter: any = {};

    if (date) {
      const parsedDateDt = TimezoneService.parseISO(date as string);
      if (parsedDateDt.isValid) {
        const startOfDayDt = TimezoneService.startOfDay(parsedDateDt);
        const endOfDayDt = TimezoneService.endOfDay(parsedDateDt);

        dateFilter = {
          gte: TimezoneService.toPrisma(startOfDayDt),
          lte: TimezoneService.toPrisma(endOfDayDt),
        };
      }
    }

    if (Object.keys(dateFilter).length === 0) {
      const nowDt = TimezoneService.getCurrentTime();
      const startOfDayDt = TimezoneService.startOfDay(nowDt);
      dateFilter = { gte: TimezoneService.toPrisma(startOfDayDt) };
    }

    const dailyWhere = {
      branchId,
      startAt: dateFilter,
      status: BookingStatus.CONFIRMED,
      ...bookingTypeWhere("DAILY"),
    };
    const monthlyWhere = {
      branchId,
      status: BookingStatus.CONFIRMED,
      ...bookingTypeWhere("MONTHLY"),
    };
    const listWhere =
      type === "MONTHLY"
        ? monthlyWhere
        : type === "DAILY"
          ? dailyWhere
          : { branchId, startAt: dateFilter, status: BookingStatus.CONFIRMED };

    const [dailyCount, monthlyCount] = await Promise.all([
      prisma.booking.count({ where: dailyWhere }),
      prisma.booking.count({ where: monthlyWhere }),
    ]);

    const rows = await prisma.booking.findMany({
      where: listWhere,
      select: {
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        rentalPeriodType: true,
        dlStatus: true,
        dlDepositNote: true,
        days: true,
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
    const bookings = rows.map((row) => ({ ...row, bookingType: bookingListTypeOf(row.rentalPeriodType) }));
    const counts = { daily: dailyCount, monthly: monthlyCount };

    // Old app builds (no ?type) treat 404 as an empty queue; tabbed clients get 200 + [].
    if (bookings.length === 0 && !type) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "No Upcoming Bookings Found",
        counts,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Upcoming bookings fetched successfully",
      data: bookings,
      type: type ?? null,
      counts,
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
      utr,
    } = req.body;

    const hasVehicles = Array.isArray(vehicles) && vehicles.length > 0;
    const hasGroupKey = typeof group_key === "string" && group_key.length > 0;

    if (
      (!hasVehicles && !hasGroupKey) ||
      !customer_public_id ||
      !start ||
      !end ||
      !["CASH", "ONLINE", "UPI"].includes(payment_type)
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

    // Every counter booking lands in the staff member's cash shift.
    await assertOpenShift(staff);

    // UPI (UTR): checked now so a bad or reused UTR fails before the hold is
    // created; re-checked when the payment-status poll confirms the booking.
    const upiUtr = payment_type === "UPI" ? await validateNewUtr(utr) : null;

    const customer = await prisma.user.findUnique({
      where: { publicId: customer_public_id },
      include: { customerProfile: true },
    });
    if (!customer || !customer.customerProfile) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Customer not found" });
    }

    // #1: DL + Aadhaar numbers (and the rest of the profile) are required before
    // any counter booking. Derived from the stored values so the API can't skip
    // the gate the staff UIs enforce.
    const missingProfileFields = getMissingProfileFields(
      profileFieldsOf(customer, customer.customerProfile),
    );
    if (missingProfileFields.length > 0) {
      return res.status(StatusCode.UNPROCESSABLE_ENTITY).json({
        success: false,
        code: "CUSTOMER_PROFILE_INCOMPLETE",
        missingFields: missingProfileFields,
        message: profileIncompleteMessage(missingProfileFields, "staff"),
      });
    }

    // Customer QR code photo (#4): optional for old builds; when sent it must be
    // the customer's current photo (409 QR_PHOTO_MISMATCH otherwise).
    const qrPhotoProblem = await checkBookingQrPhotoId(
      req.body.qr_photo_id,
      customer.customerProfile.qrPhotoFileId,
    );
    if (qrPhotoProblem) {
      return res.status(qrPhotoProblem.status).json(qrPhotoProblem.body);
    }

    // KYC picture (X2): optional — the DL + Aadhaar NUMBERS above gate the
    // booking. Omitted / blank / null ⇒ no KYC document on the booking; when
    // sent it must be one of this customer's documents.
    const kycIdInput: unknown =
      typeof customer_kyc_id === "string" ? customer_kyc_id.trim() : customer_kyc_id;
    let kycFileId: number | null = null;
    if (kycIdInput != null && kycIdInput !== "") {
      const kycRecord =
        typeof kycIdInput === "string"
          ? await prisma.customerKyc.findUnique({
              where: { publicId: kycIdInput },
              select: { fileId: true, customerId: true },
            })
          : null;
      if (!kycRecord || !kycRecord.fileId) {
        return res
          .status(StatusCode.BAD_REQUEST)
          .json({ message: "Invalid KYC ID or Document missing" });
      }
      // The KYC document must belong to the customer being booked.
      if (kycRecord.customerId !== customer.customerProfile.id) {
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          code: "KYC_CUSTOMER_MISMATCH",
          message: "This KYC document belongs to a different customer. Select one of this customer's documents.",
        });
      }
      kycFileId = kycRecord.fileId;
    }

    // Parse dates (IST) — used as Luxon DateTime for pricing engine
    const startDateDt = TimezoneService.parseISO(start);
    const endDateDt = TimezoneService.parseISO(end);
    if (!startDateDt.isValid || !endDateDt.isValid) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid dates" });
    }
    const startDate = TimezoneService.toPrisma(startDateDt);
    const endDate = TimezoneService.toPrisma(endDateDt);

    // ── Rental plan + period rules (#15 / #17) ───────────────────────────────
    // plan 'MONTHLY' is the counter-only monthly plan (30–180 days, pickup within
    // the 15-day window). Omitted (old app builds) or 'STANDARD' = a normal
    // booking, held to the 15-day window. No staff bypass.
    const rawPlan: unknown = req.body.plan;
    if (rawPlan != null && rawPlan !== "STANDARD" && rawPlan !== "MONTHLY") {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_PLAN",
        message: "plan must be 'STANDARD' or 'MONTHLY'",
      });
    }
    const isMonthlyPlan = rawPlan === "MONTHLY";

    if (endDate <= startDate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_DATES",
        message: "Return must be after pickup",
      });
    }
    if (TimezoneService.startOfDay(startDateDt) < TimezoneService.startOfDay(TimezoneService.getCurrentTime())) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_DATES",
        message: "Pickup date cannot be in the past",
      });
    }
    try {
      assertBookingWindow(startDate, endDate, { monthly: isMonthlyPlan });
    } catch (windowErr) {
      if (windowErr instanceof BookingWindowError) {
        const body = windowErr.toJSON();
        const spanDays = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
        if (!isMonthlyPlan && spanDays >= MONTHLY_MIN_DAYS) {
          body.message = `${body.message} For ${MONTHLY_MIN_DAYS} days or more, choose the Monthly rental plan.`;
        }
        return res.status(StatusCode.BAD_REQUEST).json(body);
      }
      throw windowErr;
    }
    const periodFields = bookingPeriodFields(startDate, endDate, { monthly: isMonthlyPlan });

    // ── One vehicle per driving licence (X3) — re-checked under a lock below ──
    await assertDlFree({
      dlNumber: customer.customerProfile.drivingLicenceNumber,
      mode: "create",
      window: { startAt: startDate, endAt: endDate },
    });

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
      const branchVehicles = await prisma.vehicle.findMany({
        where: { categoryId, branchId, status: "AVAILABLE", deletedAt: null, insuranceExpiry: { gt: new Date() } },
        select: { id: true, publicId: true, make: true, model: true },
        orderBy: { odo: "asc" },
      });

      const targetMake = normalizeStr(make);
      const targetModel = normalizeStr(model);
      const candidates = branchVehicles.filter(
        (v) => normalizeStr(v.make) === targetMake && normalizeStr(v.model) === targetModel,
      );

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
    // Fleet Executives (the only role this route admits) are always bound by
    // the branch's office hours — there is no bypass.
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
          // Never offer an adjusted return past the booking-period limit
          try {
            assertBookingWindow(startDate, verdict.adjustedReturn, { monthly: isMonthlyPlan });
          } catch (windowErr) {
            if (windowErr instanceof BookingWindowError) {
              return res.status(StatusCode.BAD_REQUEST).json({
                ...windowErr.toJSON(),
                message: `The branch is closed at the chosen return time, and the next open return (${verdict.nextOpenLabel ?? "next available time"}) is past the booking-period limit. Please choose an earlier return.`,
              });
            }
            throw windowErr;
          }
          return res.status(StatusCode.BAD_REQUEST).json({
            code: "BRANCH_SCHEDULE_RETURN_ADJUSTED",
            message: `Return time adjusted to ${verdict.nextOpenLabel ?? "next available time"} due to branch operating hours.`,
            verdict,
          });
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
        // Duration-slab layer (walk-ins take no coupon — the whole discount is the slab)
        durationDiscountAmount: Number(pricingResult.durationDiscountAmount.toFixed(2)),
        durationDiscountLabel:  pricingResult.durationDiscountLabel,
        durationSlabId:         pricingResult.durationSlabId,
        deposit,
        taxAmount,
        cgstAmount,
        sgstAmount,
        taxRate,
        // Frozen CGST/SGST % (invoice, summaries, bookingGstRates)
        cgstRate: Number(pricingResult.cgstRate.toString()),
        sgstRate: Number(pricingResult.sgstRate.toString()),
        finalTotal,
        // Same snapshot shape as the customer path — km-allowance falls back to
        // freeKmLimit/extraKmRate here, and billedAs records the slab charged.
        pricingBreakdown: {
          periodType:    pricingResult.pricingBreakdown.periodType,
          billedAs:      pricingResult.pricingBreakdown.billedAs,
          billedAsType:  pricingResult.pricingBreakdown.billedAsType,
          billableHours: pricingResult.pricingBreakdown.duration.billableDuration,
          actualHours:   pricingResult.pricingBreakdown.duration.actualDuration,
          freeKmLimit:   pricingResult.freeKmLimit,
          extraKmRate:   Number(pricingResult.extraKmRate.toString()),
        },
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
    let razorpay: {
      orderId: string;
      keyId: string;
      amount: number;
      amountInRupees: number;
      currency: string;
    } | null = null;

    if (payment_type === "ONLINE") {
      // Razorpay Checkout is opened by the client with this order id — no
      // hosted page to redirect to, so no redirect URL is built here.
      try {
        const order = await createRazorpayOrder(grandFinalTotal);
        transactionId = order.orderId;
        razorpay = {
          orderId: order.orderId,
          keyId: order.keyId,
          amount: order.amount,
          amountInRupees: order.amountInRupees,
          currency: order.currency,
        };
      } catch (error: any) {
        console.error("Error initiating employee booking payment:", error);
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          message: error.message || "Failed to initiate payment gateway",
        });
      }
    } else if (payment_type === "UPI") {
      transactionId = `UPI_${createID()}`;
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
      // Same driving licence on two concurrent bookings: serialised here, one wins (X3)
      await lockAndAssertDlFree(
        { customerId: customer.customerProfile!.id, mode: "create", window: { startAt: startDate, endAt: endDate } },
        tx,
      );

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

      // Snapshot the customer's current QR code photo (#4). Re-read inside the
      // transaction so the id can't point at a file released by a replace.
      const qrSnapshot = await tx.customer.findUnique({
        where: { id: customer.customerProfile!.id },
        select: { qrPhotoFileId: true },
      });

      const newBooking = await tx.booking.create({
        data: {
          publicId:     createID(),
          customerId:   customer.customerProfile!.id,
          kycFileId,
          qrPhotoFileId: qrSnapshot?.qrPhotoFileId ?? null,
          branchId:     vehiclesData[0]!.branchId,
          startAt:      startDate,
          endAt:        endDate,
          days:         items[0]!.days,
          // Period columns (#5/#17) — MONTHLY for the counter monthly plan
          rentalPeriodType: periodFields.rentalPeriodType,
          actualHours:      periodFields.actualHours,
          billableHours:    periodFields.billableHours,
          status:       BookingStatus.HOLD,
          holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          paymentStatus: "CREATED",
          depositMethod:
            payment_type === "CASH"
              ? DepositMethod.CASH
              : payment_type === "UPI"
                ? DepositMethod.UPI
                : DepositMethod.ONLINE_RAZORPAY,
          // 2-dp strings: Prisma stores a JS number in these unscaled Decimal
          // columns with float noise (8885.2 → 8885.200000000001)
          totalBase:    grandBaseTotal.toFixed(2),
          totalDiscount: grandDiscountTotal.toFixed(2),
          totalDeposit:  grandDeposit.toFixed(2),
          totalTax:      grandTaxTotal.toFixed(2),
          totalFinal:    grandFinalTotal.toFixed(2),
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
              cgstRate: items[0]?.cgstRate ?? 0,
              sgstRate: items[0]?.sgstRate ?? 0,
              grandFinalTotal,
              // Discount layers (they add up to grandDiscountTotal)
              grandDurationDiscountTotal: Number(
                items.reduce((s, i) => s + (i.durationDiscountAmount ?? 0), 0).toFixed(2),
              ),
              grandCouponDiscountTotal: 0,
              durationDiscountLabel: items.find((i) => i.durationDiscountLabel)?.durationDiscountLabel ?? null,
            },
            // Read back by confirmBookingPayment to record the UPI transaction
            ...(upiUtr && { upi: { utr: upiUtr } }),
          },
          createdById: staff.id,
        },
      });

      await tx.bookingItem.createMany({
        data: items.map((i) => ({
          bookingId:       newBooking.id,
          vehicleId:       i.vehicleId,
          days:            i.days,
          // String(n) is the exact decimal the number prints as (no float noise)
          baseTotal:       String(i.baseTotal),
          discountAmount:  String(i.discountAmount),
          discountPercent: String(i.discountPercent),
          deposit:         String(i.deposit),
          taxAmount:       String(i.taxAmount),
          cgstAmount:      String(i.cgstAmount),
          sgstAmount:      String(i.sgstAmount),
          taxRate:         String(i.taxRate),
          finalTotal:      String(i.finalTotal),
        })),
      });

      // Duration-slab discount on record (summaries, reports, counter-coupon stacking)
      if (grandDiscountTotal > 0) {
        const durationTotal = items.reduce((s, i) => s + (i.durationDiscountAmount ?? 0), 0);
        await tx.discountApplication.create({
          data: {
            publicId: createID(),
            bookingId: newBooking.id,
            originalAmount: grandBaseTotal.toFixed(2),
            durationDiscountAmount: durationTotal.toFixed(2),
            durationDiscountPercent: grandBaseTotal > 0
              ? ((durationTotal / grandBaseTotal) * 100).toFixed(4)
              : "0",
            durationSlabId: items.find((i) => i.durationSlabId)?.durationSlabId ?? null,
            couponDiscountAmount: "0.00",
            totalDiscountAmount: grandDiscountTotal.toFixed(2),
            finalAmount: (grandBaseTotal - grandDiscountTotal).toFixed(2),
            paymentPlan: "FULL",
          },
        });
      }

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
        status:        booking.status,
        startDate:     booking.startAt,
        endDate:       booking.endAt,
        transactionId: booking.transactionId,
        razorpay,
        totals:        snapshot?.totals,
        items:         snapshot?.items,
        expiresAt:     new Date(Date.now() + holdExpiry * 1000).toISOString(),
        expiresIn:     holdExpiry,
        rentalPeriodType: booking.rentalPeriodType,
        plan:          isMonthlyPlan ? "MONTHLY" : "STANDARD",
      },
    });
  } catch (error: any) {
    if (error instanceof CounterGuardError) {
      return res.status(error.status).json(error.toJSON());
    }
    if (error instanceof BookingWindowError) {
      return res.status(error.status).json(error.toJSON());
    }
    // Staff see which booking holds the licence (conflictingBooking)
    if (error instanceof DlInUseError) {
      return res.status(error.status).json(error.toJSON("staff"));
    }
    if (error?.code === "VEHICLE_TYPE_LIMIT_EXCEEDED") {
      return res.status(StatusCode.CONFLICT).json({
        code: "VEHICLE_TYPE_LIMIT_EXCEEDED",
        message: error.message,
        conflicts: error.conflicts ?? [],
      });
    }
    // Branch has no GST rule — pricing refuses to guess a rate (#23)
    if (error?.code === "GST_RULE_MISSING") {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "GST_RULE_MISSING",
        message: "GST is not configured for this branch. Ask the branch manager to set the GST rule before continuing.",
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
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: req.branch_Id },
      select: {
        id: true,
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        totalFinal: true,
        requiresManagerConfirmation: true,
        licenseCollectedAt: true,
        licenseReturnedAt: true,
        // Original licence custody (#3) — null = not recorded (old pickups)
        dlStatus: true,
        dlDepositNote: true,
        dlStatusUpdatedAt: true,
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
        // Actual vehicle return time (set when the drop completes)
        returnedAt: true,
        fuelRecord: { select: { pickupFuelLevel: true } },
        branch: {
          select: {
            chargeConfig: { select: { usePaymentSessions: true } },
          },
        },
        customer: {
          select: {
            // Full DL number (staff only, X2): checked against the card at
            // pickup; null ⇒ staff must enter it before the handover.
            drivingLicenceNumber: true,
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
                fuelBar: true,
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

    // Km allowance — the same plan-based free km + rate the drop bills with.
    // If pricing can't be resolved, report no allowance rather than a guessed one.
    let kmAllowance: KmAllowance | null = null;
    try {
      kmAllowance = await resolveKmAllowance(booking.id);
    } catch (allowanceErr) {
      console.warn(`[booking-details] Km allowance unavailable for ${booking.publicId}:`, allowanceErr);
    }
    // Km across mid-rental swaps: swaps with readings are measured segment by segment;
    // a swap recorded without readings stops automatic extra km (staff enter it at drop)
    const segments: OdometerSegments | null =
      booking.status === BookingStatus.PICKED_UP ? await getOdometerSegments(booking.id) : null;
    const vehicleSwapped = segments != null && !segments.complete;
    const effectiveFreeKmLimit: number | null = kmAllowance?.includedKm ?? booking.freeKmLimit ?? null;
    const extraKmRate: number | null = kmAllowance ? kmAllowance.extraKmRate.toNumber() : null;

    // Original / extended / late rental time for the drop screen
    const rentalTimeline = await getRentalTimeline(booking.id);

    // Vehicle-swap differences staff chose to bill — added to the drop bill as taxable lines
    const chargedSwaps = await prisma.vehicleSwap.findMany({
      where: { bookingId: booking.id, chargeDifference: true, priceDifference: { gt: 0 } },
      orderBy: { swappedAt: "asc" },
      select: {
        publicId: true,
        swappedAt: true,
        priceDifference: true,
        originalVehicle: { select: { regNo: true } },
        newVehicle: { select: { regNo: true } },
      },
    });
    let swapRates: Awaited<ReturnType<typeof getBranchGstRates>> | null = null;
    let swapGstUnavailableReason: string | null = null;
    if (chargedSwaps.length > 0) {
      try {
        swapRates = await getBranchGstRates(booking.branchId);
      } catch (ratesErr) {
        if (!(ratesErr instanceof GstRuleMissingError)) throw ratesErr;
        swapGstUnavailableReason = ratesErr.code;
      }
    }
    const swapCharges = chargedSwaps.map((swap) => {
      const gst = swapRates ? computeLineGst(swap.priceDifference.toString(), swapRates) : null;
      return {
        swapPublicId: swap.publicId,
        swappedAt: swap.swappedAt.toISOString(),
        label: `Vehicle upgrade: ${swap.originalVehicle.regNo} → ${swap.newVehicle.regNo}`,
        taxable: swap.priceDifference.toFixed(2),
        cgst: gst ? gst.cgst.toFixed(2) : null,
        sgst: gst ? gst.sgst.toFixed(2) : null,
        gst: gst ? gst.gst.toFixed(2) : null,
        total: gst ? gst.total.toFixed(2) : null,
        gstUnavailableReason: swapGstUnavailableReason,
      };
    });

    // Customer QR code photo (#4): booking snapshot, else the customer's current one.
    const qrPhotoFields = await getBookingQrPhotoFields({ id: booking.id });

    const { id: _id, branch, fuelRecord, branchId, items, ...bookingData } = booking;
    return res.status(StatusCode.OK).json({
      message: "Booking details fetched successfully",
      data: {
        ...qrPhotoFields,
        ...bookingData,
        items: items.map(({ vehicleId: _vid, ...rest }) => rest),
        // The fuel the vehicle being handed back started with: after a mid-rental swap
        // with readings, the replacement's fuel at the swap
        pickupFuelLevel: segments?.currentStartFuelLevel ?? fuelRecord?.pickupFuelLevel ?? null,
        originalPickupFuelLevel: fuelRecord?.pickupFuelLevel ?? null,
        effectiveFreeKmLimit,
        extraKmRate,
        kmAllowance: kmAllowance
          ? {
              includedKm: kmAllowance.includedKm,
              extraKmRate: kmAllowance.extraKmRate.toFixed(2),
              extraKmEnabled: kmAllowance.extraKmEnabled,
              autoKmSkipped: vehicleSwapped ? "VEHICLE_SWAPPED" : null,
              // Staff type the extra km at drop only when a swap left km unmeasurable
              manualExtraKmAllowed: vehicleSwapped,
            }
          : null,
        // Odometer segments across mid-rental swaps (null unless PICKED_UP)
        kmSegments: segments
          ? {
              swapCount: segments.swapCount,
              swapsMissingReadings: segments.swapsMissingReadings,
              complete: segments.complete,
              priorKm: segments.priorKm,
              currentStartOdometer: segments.currentStartOdometer,
              segments: segments.segments,
            }
          : null,
        rentalTimeline,
        swapCharges,
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
