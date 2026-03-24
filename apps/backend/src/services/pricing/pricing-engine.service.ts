import { prisma } from "@repo/database/client";
import { DateTime } from "luxon";
import Decimal from "decimal.js";
import {
  DurationCalculatorService,
  RentalPeriodType,
  RentalDuration,
} from "./duration-calculator.service.js";
import {
  discountEvaluationEngine,
  type DiscountEvaluationInput,
  type DiscountEvaluationResult,
} from "../discount/discount-evaluation-engine.service.js";

/**
 * Vehicle pricing configuration
 */
export interface VehiclePricing {
  hourlyRate: Decimal | null;
  price12Hour: Decimal | null;
  price24Hour: Decimal;
  priceMonthly: Decimal | null;
  freeKm12Hour: number;
  freeKm24Hour: number;
  freeKmMonthly: number;
  extraKmRate: Decimal;
  extraHourRate: Decimal;
}

/**
 * Pricing calculation result — expanded with discount breakdown layers.
 */
export interface PricingResult {
  // Base pricing (before any discount)
  basePrice: Decimal;

  // Layer 1 — duration discount
  durationDiscountAmount: Decimal;
  durationDiscountPercent: Decimal;

  // Layer 2 — coupon discount
  couponDiscountAmount: Decimal;
  couponDiscountPercent: Decimal;
  appliedCouponCode?: string;
  couponRuleId?: number;

  // Layer 3 — manual discount
  manualDiscountAmount: Decimal;

  // Combined discount totals (kept for backward compat with booking fields)
  discountAmount: Decimal;
  discountPercent: Decimal;

  // Deposits & fees
  deposit: Decimal;

  // Tax breakdown (always on post-discount base)
  taxAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  taxRate: Decimal;

  // Final amounts
  finalTotal: Decimal;

  // Distance limits
  freeKmLimit: number;
  extraKmRate: Decimal;

  // Full evaluation result (for DiscountApplication recording)
  discountEvaluation?: DiscountEvaluationResult;

  // Breakdown details
  pricingBreakdown: {
    periodType: RentalPeriodType;
    duration: RentalDuration;
    applicablePrice: Decimal;
    priceSource: "vehicle_custom" | "branch_default" | "fallback";
  };
}

/**
 * Tax calculation result
 */
interface TaxResult {
  totalTax: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  rate: Decimal;
}

/**
 * Service for calculating booking prices.
 * Calculation order: Base Amount → Duration Discount → Coupon/Manual Discount → GST
 */
export class PricingEngineService {
  /**
   * Calculate complete booking price with optional coupon discount.
   *
   * @param vehicleId     - ID of the vehicle
   * @param startAt       - Rental start datetime (IST)
   * @param endAt         - Rental end datetime (IST)
   * @param branchId      - Branch ID
   * @param customerId    - Customer ID (required for coupon eligibility checks)
   * @param couponCode    - Optional coupon code to evaluate
   * @param manualDiscountAmount - Optional manager override amount
   * @param manualDiscountId     - FK to ManualDiscount record
   */
  async calculateBookingPrice(
    vehicleId: number,
    startAt: DateTime,
    endAt: DateTime,
    branchId: number,
    customerId?: number,
    couponCode?: string,
    manualDiscountAmount?: Decimal,
    manualDiscountId?: number,
  ): Promise<PricingResult> {
    // 1. Calculate rental duration
    const duration = DurationCalculatorService.calculate(startAt, endAt);

    // 2. Get vehicle pricing (custom or branch default)
    const pricing = await this.getVehiclePricing(vehicleId, branchId);

    // 3. Determine base price based on duration
    const { basePrice, freeKmLimit, priceSource } =
      await this.determineBasePrice(pricing, duration, vehicleId, branchId);

    // 4. Get deposit amount
    const deposit = await this.getDepositAmount(vehicleId, branchId);

    // 5. Get vehicle category for coupon eligibility checks
    const vehicleCategoryId = await this.getVehicleCategoryId(vehicleId);

    // 6. Evaluate all discounts (duration + coupon + manual) in strict order
    const ZERO = new Decimal(0);
    let discountEvaluation: DiscountEvaluationResult | undefined;

    if (customerId) {
      const evalInput: DiscountEvaluationInput = {
        branchId,
        customerId,
        vehicleId,
        baseAmount: basePrice,
        rentalDays: duration.days,
        vehicleCategoryId,
        paymentPlan: "FULL", // default; caller can override via revalidateWithCoupon
        couponCode,
        manualDiscountAmount,
        manualDiscountId,
      };
      discountEvaluation = await discountEvaluationEngine.evaluate(evalInput);
    }

    const postDiscountBase = discountEvaluation?.finalAmount ?? basePrice;
    const durationDiscountAmount = discountEvaluation?.durationDiscount.discountAmount ?? ZERO;
    const durationDiscountPercent = discountEvaluation?.durationDiscount.discountPercent ?? ZERO;
    const couponDiscountAmount = discountEvaluation?.couponDiscountAmount ?? ZERO;
    const couponDiscountPercent = discountEvaluation?.couponDiscountPercent ?? ZERO;
    const actualManualDiscount = discountEvaluation?.manualDiscountAmount ?? ZERO;
    const totalDiscountAmount = discountEvaluation?.totalDiscountAmount ?? ZERO;
    const totalDiscountPercent = basePrice.gt(0)
      ? totalDiscountAmount.div(basePrice).mul(100).toDecimalPlaces(4)
      : ZERO;

    // 7. Calculate GST on post-discount amount (never on original base)
    const taxResult = await this.calculateTax(postDiscountBase, branchId);

    // 8. Final total
    const finalTotal = postDiscountBase.add(taxResult.totalTax);

    return {
      basePrice,
      durationDiscountAmount,
      durationDiscountPercent,
      couponDiscountAmount,
      couponDiscountPercent,
      appliedCouponCode: discountEvaluation?.appliedCouponCode,
      couponRuleId: discountEvaluation?.couponRule?.id,
      manualDiscountAmount: actualManualDiscount,
      discountAmount: totalDiscountAmount,
      discountPercent: totalDiscountPercent,
      deposit,
      taxAmount: taxResult.totalTax,
      cgstAmount: taxResult.cgst,
      sgstAmount: taxResult.sgst,
      taxRate: taxResult.rate,
      finalTotal,
      freeKmLimit,
      extraKmRate: pricing.extraKmRate,
      discountEvaluation,
      pricingBreakdown: {
        periodType: duration.periodType,
        duration,
        applicablePrice: basePrice,
        priceSource: pricing.source as any,
      },
    };
  }

  /**
   * Calculate limited pricing for listing pages.
   * Skips taxes, deposits, and coupon evaluation overhead.
   */
  async calculateListingPrice(
    vehicleId: number,
    startAt: DateTime,
    endAt: DateTime,
    branchId: number,
  ): Promise<{ price: Decimal; finalPrice: Decimal; type: RentalPeriodType }> {
    const duration = DurationCalculatorService.calculate(startAt, endAt);
    const pricing = await this.getVehiclePricing(vehicleId, branchId);
    const { basePrice } = await this.determineBasePrice(pricing, duration, vehicleId, branchId);

    // Apply duration discount only (no coupon on listing)
    const evalInput: DiscountEvaluationInput = {
      branchId,
      customerId: 0, // listing does not have customer context
      vehicleId,
      baseAmount: basePrice,
      rentalDays: duration.days,
      vehicleCategoryId: await this.getVehicleCategoryId(vehicleId),
      paymentPlan: "FULL",
    };
    const evaluation = await discountEvaluationEngine.evaluate(evalInput);

    return {
      price: basePrice,
      finalPrice: evaluation.finalAmount,
      type: duration.periodType,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getVehicleCategoryId(vehicleId: number): Promise<number> {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { categoryId: true },
    });
    if (!vehicle) throw new Error("Vehicle not found");
    return vehicle.categoryId;
  }

  private async getVehiclePricing(
    vehicleId: number,
    branchId: number,
  ): Promise<VehiclePricing & { source: "vehicle_custom" | "branch_default" }> {
    const customPricing = await prisma.vehicleCustomPricing.findUnique({
      where: { vehicleId },
    });

    if (customPricing && customPricing.enabled) {
      return {
        hourlyRate: customPricing.hourlyRate ? new Decimal(customPricing.hourlyRate.toString()) : null,
        price12Hour: customPricing.price12Hour ? new Decimal(customPricing.price12Hour.toString()) : null,
        price24Hour: new Decimal(customPricing.price24Hour.toString()),
        priceMonthly: customPricing.priceMonthly ? new Decimal(customPricing.priceMonthly.toString()) : null,
        freeKm12Hour: customPricing.freeKm12Hour,
        freeKm24Hour: customPricing.freeKm24Hour,
        freeKmMonthly: customPricing.freeKmMonthly,
        extraKmRate: new Decimal(customPricing.extraKmRate.toString()),
        extraHourRate: new Decimal(customPricing.extraHourRate.toString()),
        source: "vehicle_custom",
      };
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { categoryId: true },
    });
    if (!vehicle) throw new Error("Vehicle not found");

    const branchDefaults = await prisma.branchPricingDefaults.findUnique({
      where: { branchId_categoryId: { branchId, categoryId: vehicle.categoryId } },
    });
    if (!branchDefaults) {
      throw new Error(`No pricing configured for this vehicle category at branch ${branchId}`);
    }

    return {
      hourlyRate: branchDefaults.hourlyRate ? new Decimal(branchDefaults.hourlyRate.toString()) : null,
      price12Hour: branchDefaults.price12Hour ? new Decimal(branchDefaults.price12Hour.toString()) : null,
      price24Hour: new Decimal(branchDefaults.price24Hour.toString()),
      priceMonthly: branchDefaults.priceMonthly ? new Decimal(branchDefaults.priceMonthly.toString()) : null,
      freeKm12Hour: branchDefaults.freeKm12Hour,
      freeKm24Hour: branchDefaults.freeKm24Hour,
      freeKmMonthly: branchDefaults.freeKmMonthly,
      extraKmRate: new Decimal(branchDefaults.extraKmRate.toString()),
      extraHourRate: new Decimal(branchDefaults.extraHourRate.toString()),
      source: "branch_default",
    };
  }

  private async determineBasePrice(
    pricing: VehiclePricing & { source: string },
    duration: RentalDuration,
    vehicleId: number,
    branchId: number,
  ): Promise<{ basePrice: Decimal; freeKmLimit: number; priceSource: string }> {
    let basePrice: Decimal;
    let freeKmLimit: number;

    /**
     * Hourly-first rule:
     * If an hourlyRate is configured and > 0, use granular per-hour billing for
     * ALL durations (including HALF_DAY, FULL_DAY, MULTI_DAY, MONTHLY).
     * This is the intended behaviour when a business wants pure hourly billing.
     *
     * When hourlyRate is 0 or null, fall through to slab-based billing
     * (HALF_DAY / FULL_DAY / MULTI_DAY / MONTHLY), rounding up to the
     * nearest configured slab.
     *
     * Example: 29 hours, hourlyRate = ₹100 → 29 × 100 = ₹2900
     * Example: 29 hours, hourlyRate = null → MULTI_DAY, 2 days × daily = ₹X
     */
    if (pricing.hourlyRate && pricing.hourlyRate.gt(0)) {
      const billableHours = Math.max(1, Math.ceil(duration.actualDuration));
      return {
        basePrice:   pricing.hourlyRate.mul(billableHours),
        freeKmLimit: Math.floor(billableHours * 8),
        priceSource: pricing.source,
      };
    }

    // Hourly not configured — use slab-based billing
    switch (duration.periodType) {
      case RentalPeriodType.HOURLY:
        // Fallback: theoretically unreachable if hourlyRate is null, but kept for safety
        throw new Error("Hourly rental not available for this vehicle (hourlyRate not configured)");

      case RentalPeriodType.HALF_DAY:
        if (!pricing.price12Hour) throw new Error("12-hour rental not available for this vehicle");
        basePrice = pricing.price12Hour;
        freeKmLimit = pricing.freeKm12Hour;
        break;

      case RentalPeriodType.FULL_DAY:
        basePrice = pricing.price24Hour;
        freeKmLimit = pricing.freeKm24Hour;
        break;

      case RentalPeriodType.MULTI_DAY:
        basePrice = pricing.price24Hour.mul(duration.days);
        freeKmLimit = pricing.freeKm24Hour * duration.days;
        break;

      case RentalPeriodType.MONTHLY:
        if (pricing.priceMonthly) {
          basePrice = pricing.priceMonthly;
          freeKmLimit = pricing.freeKmMonthly;
        } else {
          basePrice = pricing.price24Hour.mul(30);
          freeKmLimit = pricing.freeKm24Hour * 30;
        }
        break;

      default:
        throw new Error("Invalid rental period type");
    }

    return { basePrice, freeKmLimit, priceSource: pricing.source };
  }

  private async getDepositAmount(vehicleId: number, branchId: number): Promise<Decimal> {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { categoryId: true },
    });
    if (!vehicle) throw new Error("Vehicle not found");

    const depositSetting = await prisma.categoryDepositSetting.findUnique({
      where: { branchId_categoryId: { branchId, categoryId: vehicle.categoryId } },
    });
    return depositSetting ? new Decimal(depositSetting.amount.toString()) : new Decimal(0);
  }

  private async calculateTax(amount: Decimal, branchId: number): Promise<TaxResult> {
    const gstRule = await prisma.gSTRule.findUnique({ where: { branchId } });
    if (!gstRule) throw new Error("GST rules not configured for this branch");

    const cgstRate = new Decimal(gstRule.cgstRate.toString());
    const sgstRate = new Decimal(gstRule.sgstRate.toString());
    const cgst = amount.mul(cgstRate).div(100);
    const sgst = amount.mul(sgstRate).div(100);

    return { totalTax: cgst.add(sgst), cgst, sgst, rate: cgstRate.add(sgstRate) };
  }

  calculateExtraKmCharges(kmDriven: number, freeKmLimit: number, extraKmRate: Decimal): Decimal {
    return extraKmRate.mul(Math.max(0, kmDriven - freeKmLimit));
  }

  calculateExtraHourCharges(extraHours: number, hourlyRate: Decimal): Decimal {
    return hourlyRate.mul(extraHours);
  }
}

export default PricingEngineService;
