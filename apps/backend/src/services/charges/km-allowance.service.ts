/**
 * Km allowance — how many km a booking includes and what each extra km costs.
 *
 * The included km is the pricing engine's plan-based free-km limit for the
 * booking's (first) vehicle over the booked period [startAt, endAt]. endAt
 * already carries confirmed extensions, so an extended booking earns the
 * allowance of the longer plan.
 *
 * Used by the drop (return session compute) to bill extra km and by the
 * employee booking detail endpoints to preview it — one source for both.
 */
import { prisma, BookingPhotoType } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { PricingEngineService } from "../pricing/pricing-engine.service.js";
import type { TxClient } from "../payment/paymentSession.service.js";

const pricingEngine = new PricingEngineService();

export interface KmAllowance {
  includedKm: number;
  extraKmRate: Decimal;
  extraKmEnabled: boolean;
  /** booking.endAt the allowance was worked out for */
  periodEndAt: Date;
}

/** Why the extra-km charge wasn't calculated automatically (null = it was). */
export type AutoKmSkipped = "VEHICLE_SWAPPED";

export interface KmCharge {
  startOdometer: number | null;
  endOdometer: number;
  kmDriven: number;
  includedKm: number;
  extraKm: number;
  extraKmRate: Decimal;
  extraKmCharge: Decimal;
  extraKmEnabled: boolean;
  autoKmSkipped: AutoKmSkipped | null;
}

/** Neither the pricing engine nor the booking's pricing snapshot can give the allowance. */
export class KmAllowanceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmAllowanceUnavailableError";
  }
}

/**
 * Resolves the km allowance for a booking (internal Booking.id).
 * extraKmRate comes from VehicleCustomPricing ?? BranchPricingDefaults (via the
 * pricing engine); extraKmEnabled from BranchChargeConfig (default true).
 */
export async function getKmAllowance(bookingId: number): Promise<KmAllowance> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      startAt: true,
      endAt: true,
      branchId: true,
      items: {
        orderBy: { id: "asc" },
        take: 1,
        select: { vehicleId: true, vehicle: { select: { categoryId: true } } },
      },
      branch: { select: { chargeConfig: { select: { extraKmEnabled: true } } } },
    },
  });
  if (!booking) throw new Error("Booking not found");

  const item = booking.items[0];
  if (!item) throw new Error("Booking has no vehicle assigned");

  const pricing = await pricingEngine.calculateBookingPrice(
    item.vehicleId,
    DateTime.fromJSDate(booking.startAt, { zone: "Asia/Kolkata" }),
    DateTime.fromJSDate(booking.endAt, { zone: "Asia/Kolkata" }),
    booking.branchId,
    undefined,
    undefined,
    undefined,
    undefined,
    item.vehicle.categoryId,
  );

  return {
    includedKm: pricing.freeKmLimit,
    extraKmRate: new Decimal(pricing.extraKmRate.toString()),
    extraKmEnabled: booking.branch.chargeConfig?.extraKmEnabled ?? true,
    periodEndAt: booking.endAt,
  };
}

/**
 * getKmAllowance, falling back to the free km + rate frozen in the booking's
 * pricingSnapshot when the pricing engine can't price the booking (e.g. the
 * pricing config was removed). The snapshot describes the period as booked,
 * so it is only used while the booking has never been extended.
 * Throws KmAllowanceUnavailableError when neither source works.
 */
export async function resolveKmAllowance(bookingId: number): Promise<KmAllowance> {
  try {
    return await getKmAllowance(bookingId);
  } catch (pricingErr) {
    console.warn(`[km-allowance] Pricing engine failed for booking ${bookingId}:`, pricingErr);

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        endAt: true,
        extensionCount: true,
        pricingSnapshot: true,
        branch: { select: { chargeConfig: { select: { extraKmEnabled: true } } } },
      },
    });
    const snapshotItem = ((booking?.pricingSnapshot as any)?.items ?? [])[0];
    const freeKmLimit = snapshotItem?.pricingBreakdown?.freeKmLimit;
    const extraKmRate = snapshotItem?.pricingBreakdown?.extraKmRate;

    if (
      booking &&
      booking.extensionCount === 0 &&
      typeof freeKmLimit === "number" &&
      extraKmRate != null &&
      !Number.isNaN(Number(extraKmRate))
    ) {
      return {
        includedKm: freeKmLimit,
        extraKmRate: new Decimal(String(extraKmRate)),
        extraKmEnabled: booking.branch.chargeConfig?.extraKmEnabled ?? true,
        periodEndAt: booking.endAt,
      };
    }

    throw new KmAllowanceUnavailableError(
      "The free-km allowance for this booking can't be worked out — check the vehicle's pricing setup, then try again.",
    );
  }
}

/**
 * True when the booking's vehicle was swapped after pickup — the start odometer
 * then belongs to the old car, so km driven can't be worked out automatically.
 * Pickup time is the earliest pickup marker (licence collected, fuel captured,
 * handover photos); with no marker at all, any swap counts.
 */
export async function wasVehicleSwappedAfterPickup(bookingId: number, tx?: TxClient): Promise<boolean> {
  const db = tx ?? prisma;
  const [booking, firstHandoverPhoto] = await Promise.all([
    db.booking.findUnique({
      where: { id: bookingId },
      select: { licenseCollectedAt: true, fuelRecord: { select: { pickupAt: true } } },
    }),
    db.bookingPhoto.findFirst({
      where: { bookingId, type: BookingPhotoType.PRE_DELIVERY },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  const markers = [
    booking?.licenseCollectedAt,
    booking?.fuelRecord?.pickupAt,
    firstHandoverPhoto?.createdAt,
  ].filter((d): d is Date => d instanceof Date);
  const pickedUpAt = markers.length > 0
    ? new Date(Math.min(...markers.map((d) => d.getTime())))
    : null;

  const swap = await db.vehicleSwap.findFirst({
    where: { bookingId, ...(pickedUpAt && { swappedAt: { gte: pickedUpAt } }) },
    select: { id: true },
  });
  return swap != null;
}

/**
 * Pure km math for a drop: km driven beyond the allowance × rate, rounded up
 * to whole rupees. A missing start odometer counts as no km driven. After a
 * mid-rental vehicle swap nothing is charged automatically (autoKmSkipped).
 */
export function calculateKmCharge(
  startOdometer: number | null,
  endOdometer: number,
  allowance: KmAllowance,
  vehicleSwapped = false,
): KmCharge {
  const kmDriven = vehicleSwapped ? 0 : Math.max(0, endOdometer - (startOdometer ?? endOdometer));
  const extraKm = Math.max(0, kmDriven - allowance.includedKm);
  const extraKmCharge = allowance.extraKmEnabled
    ? allowance.extraKmRate.mul(extraKm).ceil()
    : new Decimal(0);

  return {
    startOdometer,
    endOdometer,
    kmDriven,
    includedKm: allowance.includedKm,
    extraKm,
    extraKmRate: allowance.extraKmRate,
    extraKmCharge,
    extraKmEnabled: allowance.extraKmEnabled,
    autoKmSkipped: vehicleSwapped ? "VEHICLE_SWAPPED" : null,
  };
}
