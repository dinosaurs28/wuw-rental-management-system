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
import { createRazorpayOrder } from "../../services/payment/razorpay.service.js";
import { createID } from "../../utils/nanoID.js";
import jwt from "jsonwebtoken";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import { chargeConfigService } from "../../services/charges/charge-config.service.js";
import Decimal from "decimal.js";
import {
  getBranchGstRatesCached,
  isGstRuleMissing,
  GST_RULE_MISSING,
  GST_RULE_MISSING_MESSAGE,
} from "../../services/tax/gst.service.js";
import { assertBookingWindow, BookingWindowError } from "../../utils/booking/bookingWindow.js";
import { MAX_BOOKING_DAYS } from "@repo/schemas";
import { pickGroupRepresentative } from "../../utils/booking/groupRepresentative.js";
import {
  getCustomerPaymentMode,
  resolvePaymentOptions,
  resolveEffectiveFlow,
  type PaymentFlow,
} from "../../services/payment/payment-flow.service.js";
import { couponValidationService, normalizeCouponCode } from "../../services/discount/coupon-validation.service.js";

const pricingEngine = new PricingEngineService();

/** A coupon the booking can't use any more — answered as 422 { couponRejected: true }. */
class CouponRejectedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CouponRejectedError";
  }
}

/** Order details the client needs to open Razorpay Checkout. */
type RazorpayCheckoutPayload = {
  orderId: string;
  keyId: string;
  amount: number;
  amountInRupees: number;
  currency: string;
};

function normalizeStr(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
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

/**
 * Atomically resolves a groupKey to the best available vehicle within a Prisma transaction.
 * Checks only DB-level CONFIRMED/PICKED_UP conflicts — Redis holds are checked outside.
 * Selects the lowest-odometer candidate to distribute fleet wear evenly, trying
 * the pre-priced representative (preferredVehicleId) first so the unit booked
 * is the one whose price and advance were quoted.
 */
async function resolveVehicleFromGroup(
  groupKey: string,
  startDate: Date,
  endDate: Date,
  tx: typeof prisma,
  preferredVehicleId?: number,
): Promise<NonNullable<Awaited<ReturnType<typeof prisma.vehicle.findFirst>>>> {
  const parsed = parseGroupKey(groupKey);
  if (!parsed) throw Object.assign(new Error("Invalid groupKey format"), { code: "INVALID_GROUP_KEY", status: 400 });

  const { make, model, categoryId, branchId } = parsed;

  const branchVehicles = await tx.vehicle.findMany({
    where: { categoryId, branchId, status: "AVAILABLE", deletedAt: null, insuranceExpiry: { gt: new Date() } },
    include: {
      category: true,
      branch: { include: { pricingSetting: true } },
      pricingOverride: true,
      customPricing: true,
    },
    orderBy: { odo: "asc" },
  });

  const targetMake = normalizeStr(make);
  const targetModel = normalizeStr(model);
  const candidates = branchVehicles
    .filter((v) => normalizeStr(v.make) === targetMake && normalizeStr(v.model) === targetModel)
    .sort((a, b) => Number(b.id === preferredVehicleId) - Number(a.id === preferredVehicleId))
    .slice(0, 10);

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

    // The file must be one of the caller's own KYC documents: a file that isn't
    // linked to any KYC row (e.g. a pickup photo) is rejected too.
    const kycOwners = (kycFile.customerKycs ?? []).map((k) => k.customer?.userId);
    if (kycOwners.length === 0) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "KYC_DOCUMENT_INVALID",
        message: "Invalid KYC document. Select one of your uploaded KYC documents.",
      });
    }
    if (!kycOwners.includes(userData.id)) {
      return res.status(StatusCode.FORBIDDEN).json({
        success: false,
        code: "KYC_NOT_OWNED",
        message: "KYC document does not belong to your account",
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

    // ── 15-day booking window (#15) — customers can't choose a monthly plan ──
    try {
      assertBookingWindow(startDate, endDate);
    } catch (windowErr) {
      if (windowErr instanceof BookingWindowError) {
        return res.status(StatusCode.BAD_REQUEST).json(windowErr.toJSON());
      }
      throw windowErr;
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
    if (!bookingBranchId) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Could not resolve the branch for this booking" });
    }
    // No silent 9/9 fallback: a branch without a GST rule fails with
    // GST_RULE_MISSING (answered as 409 in the catch below).
    const { cgstRate, sgstRate, rate: totalTaxRate } = await getBranchGstRatesCached(bookingBranchId);

    let grandBaseTotal = 0;
    let grandDiscountTotal = 0;
    let grandTaxTotal = 0;
    let grandCGSTTotal = 0;
    let grandSGSTTotal = 0;
    let grandDeposit = 0;
    let grandFinalTotal = 0;
    let grandAdvanceAmount = 0; // sum of per-vehicle fixed advance amounts
    let grandDurationDiscountTotal = 0;
    let grandCouponDiscountTotal = 0;
    let durationDiscountLabel: string | null = null;

    // ── Payment plan + coupon context ──────────────────────────────────────────
    // The branch's customerPaymentMode and the amounts decide the plan
    // (converted, never rejected): ADVANCE only when 0 < advance < payable
    // total, which needs the post-coupon totals. So the coupon is priced
    // without its payment-plan rules here, and they are checked below against
    // the plan actually charged (an ADVANCE_ONLY branch with no advance on the
    // vehicle charges in full, so a full-payment coupon is valid there).
    const customerPaymentMode = await getCustomerPaymentMode(bookingBranchId);
    const requestedFlow: PaymentFlow = payment_flow === "ADVANCE" ? "ADVANCE" : "FULL";
    // One coupon per booking: it is priced on the first vehicle only
    const requestedCoupon = couponCode ? normalizeCouponCode(couponCode) : undefined;
    let couponItemPriced = false;
    let appliedCouponRule: import("@repo/database/client").DiscountRule | undefined;
    const couponFor = () => {
      if (!requestedCoupon || couponItemPriced) return undefined;
      couponItemPriced = true;
      return requestedCoupon;
    };
    const couponItem = (): any => items.find((i: any) => i.appliedCouponCode);
    const rejectIfCouponInvalid = (pr: Awaited<ReturnType<typeof pricingEngine.calculateBookingPrice>>, couponSent: string | undefined) => {
      if (!couponSent) return;
      if (!pr.discountEvaluation.couponValid) {
        throw new CouponRejectedError(
          pr.discountEvaluation.couponFailureCode ?? "COUPON_INVALID",
          pr.discountEvaluation.couponFailureReason ?? "This coupon can't be used for this booking.",
        );
      }
      appliedCouponRule = pr.discountEvaluation.couponRule;
    };

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

    // ── Branch schedule + restriction mode ───────────────────────────────────
    let branchRestrictionMode: "NONE" | "SAME_CATEGORY" | "ANY_VEHICLE" = "SAME_CATEGORY";

    if (bookingBranchId) {
      const branchData = await prisma.branch.findUnique({
        where: { id: bookingBranchId },
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
          // Never offer an adjusted return past the 15-day limit
          try {
            assertBookingWindow(startDate, verdict.adjustedReturn);
          } catch (windowErr) {
            if (windowErr instanceof BookingWindowError) {
              return res.status(StatusCode.BAD_REQUEST).json({
                ...windowErr.toJSON(),
                message: `The branch is closed at the chosen return time, and the next open return (${verdict.nextOpenLabel ?? "next available time"}) is past the ${MAX_BOOKING_DAYS}-day limit. Please choose an earlier return.`,
              });
            }
            throw windowErr;
          }
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
      { restrictionMode: branchRestrictionMode, branchId: bookingBranchId ?? undefined },
    );
    if (typeClassConflicts.length > 0) {
      const c = typeClassConflicts[0]!;
      const message =
        c.reason === "ANY_VEHICLE"
          ? "You already have an active booking at this branch that overlaps the selected dates. Only one vehicle booking is allowed at a time."
          : `You already have an active ${c.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler"} booking that overlaps the selected dates. Only one ${c.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler"} booking is allowed at a time.`;
      return res.status(StatusCode.CONFLICT).json({
        code: "VEHICLE_TYPE_LIMIT_EXCEEDED",
        message,
        conflicts: typeClassConflicts,
      });
    }

    for (const v of vehiclesData) {

      // Calculate pricing via Phase 2 Pricing Engine
      const itemCoupon = couponFor();
      const pricingResult = await pricingEngine.calculateBookingPrice(
        v.id,
        startDateDt,
        endDateDt,
        v.branchId,
        customerId,
        itemCoupon,
        undefined,
        undefined,
        undefined,
        undefined,
        { deferPaymentPlanCheck: true },
      );
      // A coupon that no longer applies is rejected, never silently dropped
      rejectIfCouponInvalid(pricingResult, itemCoupon);

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
        durationDiscountAmount: Number(pricingResult.durationDiscountAmount.toFixed(2)),
        durationDiscountLabel: pricingResult.durationDiscountLabel,
        durationSlabId: pricingResult.durationSlabId,
        couponDiscountAmount: Number(pricingResult.couponDiscountAmount.toFixed(2)),
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
          billedAs: pricingResult.pricingBreakdown.billedAs,
          billedAsType: pricingResult.pricingBreakdown.billedAsType,
        },
      });

      grandBaseTotal += baseTotal;
      grandDiscountTotal += discountAmount;
      grandDurationDiscountTotal += Number(pricingResult.durationDiscountAmount.toString());
      grandCouponDiscountTotal += Number(pricingResult.couponDiscountAmount.toString());
      durationDiscountLabel ??= pricingResult.durationDiscountLabel;
      grandTaxTotal += taxAmount;
      grandCGSTTotal += cgstAmount;
      grandSGSTTotal += sgstAmount;
      grandDeposit += deposit;
      grandFinalTotal += finalTotal;
      grandAdvanceAmount += Number(v.advancePayAmount ?? 0);
    }

    // Pre-price group vehicles so grand totals are correct before payment initiation.
    // The representative is picked by the same rule as the public group page
    // (lowest-odometer unit free for the dates, Redis holds included), and the
    // transaction tries that unit first, so the price and advance shown are charged.
    const groupRepVehicleIds: number[] = [];
    let groupCouponIndex = -1; // which group slot carries the booking's coupon
    if (resolvedGroupKeys.length > 0) {
      for (const [gkIndex, gk] of resolvedGroupKeys.entries()) {
        const gkParsed = parseGroupKey(gk)!;
        console.log(`[booking] resolving group key: ${gk} → make:${gkParsed.make} model:${gkParsed.model} categoryId:${gkParsed.categoryId} branchId:${gkParsed.branchId}`);
        const targetMake = normalizeStr(gkParsed.make);
        const targetModel = normalizeStr(gkParsed.model);
        const candidates = await prisma.vehicle.findMany({
          where: {
            categoryId: gkParsed.categoryId,
            branchId: gkParsed.branchId,
            status: "AVAILABLE",
            deletedAt: null,
            insuranceExpiry: { gt: new Date() },
          },
          select: { id: true, publicId: true, status: true, make: true, model: true, branchId: true, advancePayAmount: true },
          orderBy: { odo: "asc" },
        });
        const { representative: repVehicle } = await pickGroupRepresentative(
          candidates.filter(
            (v) =>
              normalizeStr(v.make) === targetMake &&
              normalizeStr(v.model) === targetModel &&
              !groupRepVehicleIds.includes(v.id),
          ),
          startDate,
          endDate,
        );
        if (!repVehicle) {
          return res.status(StatusCode.CONFLICT).json({
            code: "NO_VEHICLE_AVAILABLE",
            message: `No ${gkParsed.make} ${gkParsed.model} is available for the selected dates. Please try different dates or refresh to see current availability.`,
          });
        }
        groupRepVehicleIds.push(repVehicle.id);
        console.log(`[booking] repVehicle id:${repVehicle.id} branchId:${repVehicle.branchId}`);
        const groupCoupon = couponFor();
        if (groupCoupon) groupCouponIndex = gkIndex;
        const pr = await pricingEngine.calculateBookingPrice(
          repVehicle.id, startDateDt, endDateDt, repVehicle.branchId, customerId, groupCoupon,
          undefined, undefined, undefined, undefined, { deferPaymentPlanCheck: true },
        );
        rejectIfCouponInvalid(pr, groupCoupon);
        console.log(`[booking] pricing for vehicle ${repVehicle.id}: base:${pr.basePrice} discount:${pr.discountAmount} tax:${pr.taxAmount} deposit:${pr.deposit} finalTotal:${pr.finalTotal}`);
        grandBaseTotal     += Number(pr.basePrice.toString());
        grandDiscountTotal += Number(pr.discountAmount.toString());
        grandDurationDiscountTotal += Number(pr.durationDiscountAmount.toString());
        grandCouponDiscountTotal   += Number(pr.couponDiscountAmount.toString());
        durationDiscountLabel ??= pr.durationDiscountLabel;
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
    grandDurationDiscountTotal = Number(grandDurationDiscountTotal.toFixed(2));
    grandCouponDiscountTotal = Number(grandCouponDiscountTotal.toFixed(2));

    // Effective plan: the branch mode, then the amounts — the advance is valid
    // only if 0 < advance < full payable (rental after discounts + GST + deposit).
    // A plan the branch/amounts don't allow is converted, never rejected.
    const paymentOptions = resolvePaymentOptions({
      mode: customerPaymentMode,
      advanceAmount: grandAdvanceAmount,
      payableTotal: grandFinalTotal,
    });
    const effectiveFlow = resolveEffectiveFlow(requestedFlow, paymentOptions);
    if (effectiveFlow.adjusted) {
      console.warn(
        `[booking] payment_flow ${requestedFlow} → ${effectiveFlow.flow} (${effectiveFlow.reason}) ` +
        `branch=${bookingBranchId} mode=${customerPaymentMode} advance=${grandAdvanceAmount} total=${grandFinalTotal}`,
      );
    }
    const isAdvancePayment = effectiveFlow.flow === "ADVANCE";

    // The coupon's payment-plan rules, against the plan actually charged
    if (appliedCouponRule) {
      const planCheck = couponValidationService.checkPaymentPlan(appliedCouponRule, effectiveFlow.flow);
      if (!planCheck.valid) {
        throw new CouponRejectedError(
          planCheck.failureCode ?? "COUPON_PAYMENT_PLAN_MISMATCH",
          planCheck.failureReason ?? "This coupon is not valid for this payment plan.",
        );
      }
      const minAdvance = appliedCouponRule.minAdvanceAfterDiscount;
      if (isAdvancePayment && minAdvance != null && grandAdvanceAmount < Number(minAdvance)) {
        throw new CouponRejectedError(
          "COUPON_PAYMENT_PLAN_MISMATCH",
          `This coupon needs an advance of at least ₹${Number(minAdvance).toFixed(2)}` +
            (paymentOptions.allowedFlows.includes("FULL") ? "; pay the full amount to use it." : "."),
        );
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
    let razorpay: RazorpayCheckoutPayload | null = null;
    let encryptedFinalPrice: string | null = null;
    if (parsed.data.payment_type === "ONLINE") {
      // Razorpay Checkout opens in-app/in-page, so there is no redirect URL to
      // build — the client only needs the order id and the public key id.
      try {
        const order = await createRazorpayOrder(chargeAmount, {
          customerPublicId: customerpubId,
        });
        transactionId = order.orderId;
        razorpay = {
          orderId: order.orderId,
          keyId: order.keyId,
          amount: order.amount,
          amountInRupees: order.amountInRupees,
          currency: order.currency,
        };
      } catch (error: any) {
        console.error("Error initiating payment:", error);
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          message: `Payment failed (charge: ₹${chargeAmount}): ${error.message || "Failed to initiate payment gateway"}`,
        });
      }
    } else {
      transactionId = createID();
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
      for (const [gkIndex, gk] of resolvedGroupKeys.entries()) {
        try {
          const resolved = await resolveVehicleFromGroup(gk, startDate, endDate, tx as any, groupRepVehicleIds[gkIndex]);
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
      for (const [gvIndex, v] of resolvedGroupVehicles.entries()) {
        const groupCoupon = gvIndex === groupCouponIndex ? requestedCoupon : undefined;
        const pricingResult = await pricingEngine.calculateBookingPrice(
          v.id,
          startDateDt,
          endDateDt,
          v.branchId,
          customerId,
          groupCoupon,
          undefined,
          undefined,
          undefined,
          undefined,
          { paymentPlan: effectiveFlow.flow },
        );
        rejectIfCouponInvalid(pricingResult, groupCoupon);

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
          durationDiscountAmount: Number(pricingResult.durationDiscountAmount.toFixed(2)),
          durationDiscountLabel:  pricingResult.durationDiscountLabel,
          durationSlabId:         pricingResult.durationSlabId,
          couponDiscountAmount:   Number(pricingResult.couponDiscountAmount.toFixed(2)),
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
            billedAs:      pricingResult.pricingBreakdown.billedAs,
            billedAsType:  pricingResult.pricingBreakdown.billedAsType,
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
        { restrictionMode: branchRestrictionMode, branchId: bookingBranchId ?? undefined },
      );
      if (txTypeClassConflicts.length > 0) {
        const c = txTypeClassConflicts[0]!;
        const msg =
          c.reason === "ANY_VEHICLE"
            ? "You already have an active booking at this branch that overlaps the selected dates."
            : `You already have an active ${c.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler"} booking that overlaps the selected dates.`;
        throw Object.assign(new Error(msg), {
          code: "VEHICLE_TYPE_LIMIT_EXCEEDED",
          conflicts: txTypeClassConflicts,
        });
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
          ...(couponItem()?.appliedCouponCode
            ? {
                couponCode: couponItem().appliedCouponCode,
                discountRuleId: couponItem().couponRuleId ?? undefined,
              }
            : {}),
          // 2-dp strings: Prisma stores a JS number in these unscaled Decimal
          // columns with float noise (8885.2 → 8885.200000000001)
          totalBase: grandBaseTotal.toFixed(2),
          totalDiscount: grandDiscountTotal.toFixed(2),
          totalDeposit: grandDeposit.toFixed(2),
          totalTax: grandTaxTotal.toFixed(2),
          totalFinal: grandFinalTotal.toFixed(2),
          isAdvancePayment: isAdvancePayment,
          advanceAmount: isAdvancePayment ? grandAdvanceAmount.toFixed(2) : 0,
          remainingBalance: remainingBalance.toFixed(2),
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
              cgstRate,
              sgstRate,
              grandFinalTotal,
              // Discount layers (they add up to grandDiscountTotal)
              grandDurationDiscountTotal,
              grandCouponDiscountTotal,
              durationDiscountLabel,
              couponCode: couponItem()?.appliedCouponCode ?? null,
              paymentFlowRequested: requestedFlow,
              paymentFlow: effectiveFlow.flow,
              customerPaymentMode,
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
          // String(n) is the exact decimal the number prints as (no float noise)
          baseTotal: String(i.baseTotal),
          discountAmount: String(i.discountAmount),
          discountPercent: String(i.discountPercent),
          deposit: String(i.deposit),
          taxAmount: String(i.taxAmount),
          cgstAmount: String(i.cgstAmount),
          sgstAmount: String(i.sgstAmount),
          taxRate: String(i.taxRate),
          finalTotal: String(i.finalTotal),
        })),
      });

      // Record coupon usage log so totalUsageLimit / perUserLimit checks are enforced.
      // Lock the rule and re-check the limits first: two holds racing for the last
      // use of a limited coupon serialise here and the second is rejected.
      const appliedCouponRuleId: number | null = couponItem()?.couponRuleId ?? null;
      if (appliedCouponRuleId && appliedCouponRule) {
        await couponValidationService.lockRule(tx, appliedCouponRuleId);
        const usage = await couponValidationService.checkUsageLimits(
          appliedCouponRule,
          { customerId, branchId: newBooking.branchId, bookingId: newBooking.id },
          tx,
        );
        if (!usage.valid) {
          throw new CouponRejectedError(
            usage.failureCode ?? "COUPON_USAGE_LIMIT_EXCEEDED",
            usage.failureReason ?? "This coupon has reached its usage limit.",
          );
        }
        await tx.couponUsageLog.create({
          data: {
            discountRuleId: appliedCouponRuleId,
            bookingId: newBooking.id,
            customerId,
            branchId: newBooking.branchId,
            // Only the coupon layer — the duration slab is not coupon savings
            discountedAmount: new Decimal(grandCouponDiscountTotal),
          },
        });
      }

      // Discount layers on record (duration slab / coupon) for summaries and reports
      if (grandDiscountTotal > 0 || appliedCouponRuleId) {
        const firstSlabId = items.find((i: any) => i.durationSlabId)?.durationSlabId ?? null;
        await tx.discountApplication.create({
          data: {
            publicId: createID(),
            bookingId: newBooking.id,
            originalAmount: new Decimal(grandBaseTotal).toFixed(2),
            durationDiscountAmount: new Decimal(grandDurationDiscountTotal).toFixed(2),
            durationDiscountPercent: grandBaseTotal > 0
              ? new Decimal(grandDurationDiscountTotal).div(grandBaseTotal).mul(100).toDecimalPlaces(4).toString()
              : "0",
            durationSlabId: firstSlabId,
            couponDiscountAmount: new Decimal(grandCouponDiscountTotal).toFixed(2),
            couponDiscountPercent: grandBaseTotal - grandDurationDiscountTotal > 0
              ? new Decimal(grandCouponDiscountTotal).div(grandBaseTotal - grandDurationDiscountTotal).mul(100).toDecimalPlaces(4).toString()
              : "0",
            discountRuleId: appliedCouponRuleId,
            manualDiscountAmount: "0.00",
            totalDiscountAmount: new Decimal(grandDiscountTotal).toFixed(2),
            finalAmount: new Decimal(grandBaseTotal).sub(grandDiscountTotal).toFixed(2),
            paymentPlan: effectiveFlow.flow,
          },
        });
      }

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
      // The plan actually charged (may differ from the one requested — see paymentFlowAdjusted)
      payment_flow: effectiveFlow.flow,
      paymentFlowRequested: requestedFlow,
      paymentFlowAdjusted: effectiveFlow.adjusted,
      paymentFlowAdjustReason: effectiveFlow.reason,
      paymentFlowAdjustMessage: effectiveFlow.message,
      paymentOptions,
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
          cgstRate,
          sgstRate,
          grandFinalTotal,
          grandDurationDiscountTotal,
          grandCouponDiscountTotal,
          durationDiscountLabel,
          appliedCouponCode: couponItem()?.appliedCouponCode ?? null,
          advanceAmount: isAdvancePayment ? grandAdvanceAmount : grandFinalTotal,
          // Charged now (Razorpay order amount) and what stays due at pickup
          payNowAmount: chargeAmount,
          dueAtPickup: remainingBalance,
          remainingBalance,
          encryptedFinalPrice,
          transactionId,
          razorpay,
        },
      },
    });
  } catch (e: any) {
    if (e instanceof CouponRejectedError) {
      // Raised before the Razorpay order (or rolled back with the hold): the
      // customer is never charged an amount without the coupon they saw.
      return res.status(StatusCode.UNPROCESSABLE_ENTITY).json({
        success: false,
        code: e.code,
        message: e.message,
        couponRejected: true,
      });
    }
    if (e?.code === "NO_VEHICLE_AVAILABLE") {
      return res.status(409).json({ code: "NO_VEHICLE_AVAILABLE", message: e.message });
    }
    if (isGstRuleMissing(e)) {
      return res.status(StatusCode.CONFLICT).json({ success: false, code: GST_RULE_MISSING, message: GST_RULE_MISSING_MESSAGE });
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
