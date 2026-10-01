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
 *
 * After a mid-rental vehicle swap the km driven is the sum over the vehicles
 * used: each swap records the returning car's end reading and the replacement's
 * start reading (getOdometerSegments). Older swaps recorded without readings
 * can't be measured, so extra km falls back to a staff-entered figure.
 */
import { prisma, BookingPhotoType, BookingStatus } from "@repo/database/client";
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

/** Where the billed km came from. */
export type KmSource = "ODOMETER" | "STAFF_ENTERED" | "NONE";

export interface KmCharge {
  /** Start reading of the vehicle handed back now (the replacement's, after a swap). */
  startOdometer: number | null;
  endOdometer: number;
  kmDriven: number;
  /** km on vehicles handed back before the current one (mid-rental swaps). */
  priorKm: number;
  includedKm: number;
  extraKm: number;
  extraKmRate: Decimal;
  extraKmCharge: Decimal;
  extraKmEnabled: boolean;
  autoKmSkipped: AutoKmSkipped | null;
  /** Extra km typed by staff — only after a swap recorded without readings. */
  manualExtraKm: number | null;
  kmSource: KmSource;
}

export interface OdometerSegment {
  /** VehicleSwap.publicId that ended this segment (null = the vehicle handed back now). */
  endedBySwapPublicId: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
  /** null when a reading is missing */
  km: number | null;
}

export interface OdometerSegments {
  /** Swaps made after pickup (the rental moved to another vehicle). */
  swapCount: number;
  /** Post-pickup swaps recorded without odometer readings (older swaps). */
  swapsMissingReadings: number;
  /** Every post-pickup swap has readings, so km driven can be measured. */
  complete: boolean;
  /** Σ km on the vehicles already handed back (0 with no swap; 0 when incomplete). */
  priorKm: number;
  /** Start reading of the current vehicle: the last swap's newVehicleStartOdometer, else booking.startOdometer. */
  currentStartOdometer: number | null;
  /** Fuel bars of the current vehicle at its handover, when a swap recorded them. */
  currentStartFuelLevel: string | null;
  /** Finished segments, oldest first (the current vehicle's segment ends at the drop). */
  segments: OdometerSegment[];
}

/** Neither the pricing engine nor the booking's pricing snapshot can give the allowance. */
export class KmAllowanceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmAllowanceUnavailableError";
  }
}

/** Free km frozen in the booking's pricingSnapshot at confirmation (first vehicle), if any. */
function snapshotFreeKm(pricingSnapshot: unknown): number | null {
  const freeKm = ((pricingSnapshot as any)?.items ?? [])[0]?.pricingBreakdown?.freeKmLimit;
  return typeof freeKm === "number" && Number.isFinite(freeKm) ? freeKm : null;
}

/**
 * Resolves the km allowance for a booking (internal Booking.id).
 * extraKmRate comes from VehicleCustomPricing ?? BranchPricingDefaults (via the
 * pricing engine); extraKmEnabled from BranchChargeConfig (default true).
 * A booking that was never extended never gets fewer free km than its
 * confirmation promised (pricingSnapshot), even if the plan rules changed since.
 */
export async function getKmAllowance(bookingId: number): Promise<KmAllowance> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      startAt: true,
      endAt: true,
      branchId: true,
      extensionCount: true,
      pricingSnapshot: true,
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

  const promisedFreeKm = booking.extensionCount === 0 ? snapshotFreeKm(booking.pricingSnapshot) : null;

  return {
    includedKm: Math.max(pricing.freeKmLimit, promisedFreeKm ?? 0),
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
 * Earliest pickup marker (licence collected, fuel captured, handover photos) —
 * how swaps recorded before bookingStatusAtSwap existed are told apart.
 */
async function pickedUpAtMarker(bookingId: number, db: TxClient): Promise<Date | null> {
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
  return markers.length > 0 ? new Date(Math.min(...markers.map((d) => d.getTime()))) : null;
}

/**
 * The booking's odometer segments across mid-rental swaps. A swap counts as
 * mid-rental when it was recorded with bookingStatusAtSwap = PICKED_UP; older
 * rows (no status) count when made at/after the pickup marker, or always when
 * there is no marker. km of a segment = the returning car's end reading − the
 * segment's start reading (booking.startOdometer for the first segment, the
 * replacement's start reading after each swap).
 */
export async function getOdometerSegments(bookingId: number, tx?: TxClient): Promise<OdometerSegments> {
  const db = tx ?? prisma;
  const [booking, swaps] = await Promise.all([
    db.booking.findUnique({ where: { id: bookingId }, select: { startOdometer: true } }),
    db.vehicleSwap.findMany({
      where: { bookingId },
      orderBy: { swappedAt: "asc" },
      select: {
        publicId: true,
        swappedAt: true,
        bookingStatusAtSwap: true,
        originalVehicleEndOdometer: true,
        newVehicleStartOdometer: true,
        newVehicleFuelLevel: true,
      },
    }),
  ]);

  let pickedUpAt: Date | null | undefined;
  const postPickup: typeof swaps = [];
  for (const swap of swaps) {
    if (swap.bookingStatusAtSwap === BookingStatus.PICKED_UP) {
      postPickup.push(swap);
    } else if (swap.bookingStatusAtSwap == null) {
      if (pickedUpAt === undefined) pickedUpAt = await pickedUpAtMarker(bookingId, db);
      if (!pickedUpAt || swap.swappedAt >= pickedUpAt) postPickup.push(swap);
    }
  }

  const startOdometer = booking?.startOdometer ?? null;
  if (postPickup.length === 0) {
    return {
      swapCount: 0,
      swapsMissingReadings: 0,
      complete: true,
      priorKm: 0,
      currentStartOdometer: startOdometer,
      currentStartFuelLevel: null,
      segments: [],
    };
  }

  const segments: OdometerSegment[] = [];
  let segmentStart: number | null = startOdometer;
  let swapsMissingReadings = 0;
  for (const swap of postPickup) {
    const end = swap.originalVehicleEndOdometer;
    if (end == null || swap.newVehicleStartOdometer == null) swapsMissingReadings += 1;
    segments.push({
      endedBySwapPublicId: swap.publicId,
      startOdometer: segmentStart,
      endOdometer: end,
      // A missing pickup reading counts as no km driven, as for an unswapped booking
      km: end == null ? null : segmentStart == null ? 0 : Math.max(0, end - segmentStart),
    });
    segmentStart = swap.newVehicleStartOdometer;
  }

  const complete = swapsMissingReadings === 0;
  const last = postPickup[postPickup.length - 1]!;
  return {
    swapCount: postPickup.length,
    swapsMissingReadings,
    complete,
    priorKm: complete ? segments.reduce((sum, s) => sum + (s.km ?? 0), 0) : 0,
    currentStartOdometer: last.newVehicleStartOdometer ?? null,
    currentStartFuelLevel: last.newVehicleFuelLevel ?? null,
    segments,
  };
}

/**
 * True when the booking's vehicle was swapped after pickup — the start odometer
 * then belongs to the old car. Kept for callers that only need the yes/no; km
 * billing uses getOdometerSegments.
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
 * to whole rupees (the taxable value — GST is added on the drop bill).
 * A missing start odometer counts as no km driven.
 *
 *  - priorKm: km on vehicles handed back at mid-rental swaps (with readings);
 *    startOdometer is then the current vehicle's start reading.
 *  - vehicleSwapped: a mid-rental swap without readings — km can't be measured,
 *    nothing is charged automatically (autoKmSkipped) and only a staff-entered
 *    manualExtraKm is billed, at the allowance rate.
 */
export function calculateKmCharge(
  startOdometer: number | null,
  endOdometer: number,
  allowance: KmAllowance,
  vehicleSwapped = false,
  opts: { priorKm?: number; manualExtraKm?: number | null } = {},
): KmCharge {
  const manualExtraKm = vehicleSwapped && opts.manualExtraKm != null ? Math.max(0, Math.floor(opts.manualExtraKm)) : null;
  const priorKm = vehicleSwapped ? 0 : Math.max(0, opts.priorKm ?? 0);
  const kmDriven = vehicleSwapped ? 0 : priorKm + Math.max(0, endOdometer - (startOdometer ?? endOdometer));
  const extraKm = vehicleSwapped ? manualExtraKm ?? 0 : Math.max(0, kmDriven - allowance.includedKm);
  const extraKmCharge = allowance.extraKmEnabled
    ? allowance.extraKmRate.mul(extraKm).ceil()
    : new Decimal(0);

  return {
    startOdometer,
    endOdometer,
    kmDriven,
    priorKm,
    includedKm: allowance.includedKm,
    extraKm,
    extraKmRate: allowance.extraKmRate,
    extraKmCharge,
    extraKmEnabled: allowance.extraKmEnabled,
    autoKmSkipped: vehicleSwapped ? "VEHICLE_SWAPPED" : null,
    manualExtraKm,
    kmSource: !vehicleSwapped ? "ODOMETER" : manualExtraKm != null ? "STAFF_ENTERED" : "NONE",
  };
}

/** JSON shape of a km charge for clients, session metadata and legacy responses. */
export function serializeKmCharge(km: KmCharge, segments?: OdometerSegments | null) {
  return {
    startOdometer: km.startOdometer,
    endOdometer: km.endOdometer,
    kmDriven: km.kmDriven,
    priorKm: km.priorKm,
    includedKm: km.includedKm,
    extraKm: km.extraKm,
    extraKmRate: km.extraKmRate.toFixed(2),
    extraKmCharge: km.extraKmCharge.toFixed(2),
    extraKmEnabled: km.extraKmEnabled,
    autoKmSkipped: km.autoKmSkipped,
    manualExtraKm: km.manualExtraKm,
    kmSource: km.kmSource,
    swapCount: segments?.swapCount ?? 0,
    segments: (segments?.segments ?? []).map((s) => ({
      endedBySwapPublicId: s.endedBySwapPublicId,
      startOdometer: s.startOdometer,
      endOdometer: s.endOdometer,
      km: s.km,
    })),
  };
}
