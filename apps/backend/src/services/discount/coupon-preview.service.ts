import Decimal from "decimal.js";
import { prisma } from "@repo/database/client";
import { PricingEngineService, rentInclGstFields } from "../pricing/pricing-engine.service.js";
import { TimezoneService } from "../timezone/timezone.service.js";
import { normalizeCouponCode } from "./coupon-validation.service.js";
import {
  getCustomerPaymentMode,
  resolvePaymentOptions,
  resolveEffectiveFlow,
  checkCustomerCouponPlan,
  type PaymentFlow,
  type PaymentOptions,
} from "../payment/payment-flow.service.js";
import {
  parseGroupKey,
  normalizeGroupStr,
  pickGroupRepresentative,
} from "../../utils/booking/groupRepresentative.js";

/**
 * Coupon preview shared by POST /api/user/discount/validate (signed-in
 * customers — per-customer coupons work) and POST /api/public/discount/validate
 * (guests, customerId 0). Prices the exact vehicle the booking would use (the
 * group representative for a make/model group) with the coupon, so the client
 * can show the server's post-coupon breakdown instead of doing its own maths.
 * Nothing is recorded.
 */

const pricingEngine = new PricingEngineService();

export interface CouponPreviewInput {
  couponCode: string;
  vehiclePublicId?: string;
  groupKey?: string;
  startAt: string;
  endAt: string;
  /** 0 = anonymous preview. */
  customerId: number;
  /** Plan the client shows (item 18: there is no choice); omitted = the fixed plan. */
  paymentFlow?: PaymentFlow;
}

export type CouponPreviewResult =
  | { status: 400 | 404; message: string }
  | { status: 200; data: Record<string, unknown> };

const n2 = (d: Decimal) => Number(d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());

export async function previewCoupon(input: CouponPreviewInput): Promise<CouponPreviewResult> {
  const startDt = TimezoneService.parseISO(input.startAt);
  const endDt = TimezoneService.parseISO(input.endAt);
  if (!startDt.isValid || !endDt.isValid) return { status: 400, message: "Invalid date format" };
  if (endDt <= startDt) return { status: 400, message: "End date must be after start date" };

  let vehicle: {
    id: number;
    branchId: number;
    categoryId: number;
    advancePayAmount: Decimal | { toString(): string } | null;
  } | null = null;

  if (input.vehiclePublicId) {
    vehicle = await prisma.vehicle.findUnique({
      where: { publicId: input.vehiclePublicId },
      select: { id: true, branchId: true, categoryId: true, advancePayAmount: true },
    });
  } else if (input.groupKey) {
    const parsed = parseGroupKey(input.groupKey);
    if (!parsed) return { status: 400, message: "Invalid group key" };
    const make = normalizeGroupStr(parsed.make);
    const model = normalizeGroupStr(parsed.model);
    const candidates = (
      await prisma.vehicle.findMany({
        where: {
          branchId: parsed.branchId,
          categoryId: parsed.categoryId,
          status: "AVAILABLE",
          deletedAt: null,
          insuranceExpiry: { gt: new Date() },
        },
        select: {
          id: true, publicId: true, status: true, make: true, model: true,
          branchId: true, categoryId: true, advancePayAmount: true,
        },
        orderBy: { odo: "asc" },
      })
    ).filter((v) => normalizeGroupStr(v.make) === make && normalizeGroupStr(v.model) === model);
    const { representative } = await pickGroupRepresentative(
      candidates,
      TimezoneService.toPrisma(startDt),
      TimezoneService.toPrisma(endDt),
    );
    // All units busy for the dates: still price the group so the coupon can be checked
    vehicle = representative ?? candidates[0] ?? null;
  }

  if (!vehicle) return { status: 404, message: "Vehicle not found" };

  const code = normalizeCouponCode(input.couponCode);
  const mode = await getCustomerPaymentMode(vehicle.branchId);

  // The plan charged depends on the post-coupon total (0 < advance < payable),
  // so the coupon's plan rules are checked below against that plan — same as
  // booking create.
  const pricing = await pricingEngine.calculateBookingPrice(
    vehicle.id,
    startDt,
    endDt,
    vehicle.branchId,
    input.customerId,
    code,
    undefined,
    undefined,
    vehicle.categoryId,
    undefined,
    { deferPaymentPlanCheck: true },
  );

  const evaluation = pricing.discountEvaluation;
  if (!evaluation?.couponValid || !evaluation.couponRule) {
    return {
      status: 200,
      data: {
        valid: false,
        code: evaluation?.couponFailureCode ?? "COUPON_INVALID",
        reason: evaluation?.couponFailureReason ?? "Invalid coupon code.",
      },
    };
  }

  const payableTotal = pricing.finalTotal.add(pricing.deposit);
  const paymentOptions: PaymentOptions = resolvePaymentOptions({
    mode,
    advanceAmount: vehicle.advancePayAmount?.toString() ?? "0",
    payableTotal,
  });
  const effective = resolveEffectiveFlow(input.paymentFlow ?? paymentOptions.defaultFlow, paymentOptions);

  // Plan-specific coupon rules for the plan that would actually be charged
  // (item 18: the advance whenever it's usable — a full-payment-only coupon
  // is refused with the reason, same text as booking create)
  const planCheck = checkCustomerCouponPlan(evaluation.couponRule, paymentOptions);
  if (!planCheck.valid) {
    return {
      status: 200,
      data: { valid: false, code: planCheck.code, reason: planCheck.message },
    };
  }

  return {
    status: 200,
    data: {
      valid: true,
      couponCode: pricing.appliedCouponCode ?? code,
      // Coupon layer only (pre-GST) — kept for older clients
      discountAmount: pricing.couponDiscountAmount.toFixed(2),
      // What the coupon takes off the GST-inclusive rent (item 17) — show this one
      discountInclGst: pricing.gross.couponDiscount.toFixed(2),
      discountType: evaluation.couponRule.discountType,
      discountValue: evaluation.couponRule.value.toString(),
      // The full server-priced breakdown with the coupon applied
      pricing: {
        basePrice: n2(pricing.basePrice),
        durationDiscountAmount: n2(pricing.durationDiscountAmount),
        durationDiscountPercent: n2(pricing.durationDiscountPercent),
        durationDiscountLabel: pricing.durationDiscountLabel,
        durationSuppressed: pricing.durationSuppressed,
        couponDiscountAmount: n2(pricing.couponDiscountAmount),
        discountAmount: n2(pricing.discountAmount),
        taxableAmount: n2(pricing.basePrice.sub(pricing.discountAmount)),
        taxAmount: n2(pricing.taxAmount),
        cgstAmount: n2(pricing.cgstAmount),
        sgstAmount: n2(pricing.sgstAmount),
        taxRate: n2(pricing.taxRate),
        finalTotal: n2(pricing.finalTotal),
        deposit: n2(pricing.deposit),
        payableTotal: n2(payableTotal),
        // GST-inclusive rent view (item 17): rentInclGst − discountInclGst =
        // rentAfterDiscountInclGst = rentWithoutGst + gst
        ...rentInclGstFields(pricing),
      },
      payableTotal: n2(payableTotal),
      paymentFlow: effective.flow,
      paymentFlowAdjusted: input.paymentFlow != null && effective.adjusted,
      paymentOptions,
    },
  };
}
