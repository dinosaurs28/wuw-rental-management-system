/**
 * Km allowance — how many km a booking includes and what each extra km costs.
 *
 * The included km is the pricing engine's plan-based free-km limit for the
 * booking's (first) vehicle over the ORIGINAL booked period [startAt, end
 * before any extension], plus the free km each extension adds by the #7 rule
 * (extension-km.ts): whole 24 h blocks → freeKm24Hour each, a remaining ≥ 12 h
 * block → freeKm12Hour, other hours → 0. An extension by a few hours therefore
 * adds no km. The extensions counted are the ones on the drop's rental
 * timeline (isLiveExtension), so the timeline's per-extension km add up to it.
 *
 * Used by the drop (return session compute) to bill extra km and by the
 * employee booking detail endpoints to preview it — one source for both.
 *
 * After a mid-rental vehicle swap the km driven is the sum over the vehicles
 * used: each swap records the returning car's end reading and the replacement's
 * start reading (getOdometerSegments). Older swaps recorded without readings
 * can't be measured, so extra km falls back to a staff-entered figure.
 */
import { prisma, BookingPhotoType, BookingStatus, ExtensionStatus } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { PricingEngineService } from "../pricing/pricing-engine.service.js";
import type { TxClient } from "../payment/paymentSession.service.js";
import { isLiveExtension, type TimelineExtensionInput } from "./rental-timeline.service.js";
import { extensionFreeKm, extensionMinutes, loadFreeKmRates, type FreeKmRates } from "./extension-km.js";

const pricingEngine = new PricingEngineService();

export interface KmAllowance {
  /** freeKmOriginal + freeKmExtensions */
  includedKm: number;
  extraKmRate: Decimal;
  extraKmEnabled: boolean;
  /** booking.endAt the allowance was worked out for */
  periodEndAt: Date;
  /** Free km of the original booked period (never below what the confirmation promised). */
  freeKmOriginal: number;
  /** Σ free km the extensions add (#7 rule). */
  freeKmExtensions: number;
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
  /** includedKm = freeKmOriginal + freeKmExtensions (see KmAllowance). */
  freeKmOriginal: number;
  freeKmExtensions: number;
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

/** Booking fields the allowance is worked out from (extensions as the rental timeline loads them). */
function loadAllowanceBooking(bookingId: number) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      startAt: true,
      endAt: true,
      branchId: true,
      activeExtensionId: true,
      pricingSnapshot: true,
      items: {
        orderBy: { id: "asc" },
        take: 1,
        select: { vehicleId: true, vehicle: { select: { categoryId: true } } },
      },
      branch: { select: { chargeConfig: { select: { extraKmEnabled: true } } } },
      extensions: {
        where: {
          extensionStatus: {
            in: [ExtensionStatus.CONFIRMED, ExtensionStatus.PAYMENT_COLLECTED, ExtensionStatus.PENDING_PAYMENT],
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          publicId: true,
          oldEndAt: true,
          requestedEndAt: true,
          actualNewEndAt: true,
          extensionStatus: true,
          resolutionType: true,
          extensionTrigger: true,
          additionalAmount: true,
          taxAmount: true,
          createdAt: true,
        },
      },
    },
  });
}

type AllowanceBooking = NonNullable<Awaited<ReturnType<typeof loadAllowanceBooking>>>;

/**
 * The booked period split the way the drop's rental timeline splits it: the
 * original end is the earliest extension's old end, and each extension that is
 * part of the booked window (isLiveExtension) adds its own minutes. With no
 * such extension the whole booked period is the original one.
 */
function splitBookedPeriod(booking: AllowanceBooking): { originalEndAt: Date; extensionMinutes: number[] } {
  const live = (booking.extensions as TimelineExtensionInput[]).filter((e) =>
    isLiveExtension(e, booking.activeExtensionId),
  );
  if (live.length === 0) return { originalEndAt: booking.endAt, extensionMinutes: [] };
  const earliestOldEnd = Math.min(...live.map((e) => e.oldEndAt.getTime()));
  return {
    originalEndAt: new Date(Math.min(earliestOldEnd, booking.endAt.getTime())),
    extensionMinutes: live.map((e) => extensionMinutes(e.oldEndAt, e.actualNewEndAt ?? e.requestedEndAt)),
  };
}

/** Σ free km the extensions add at the vehicle's slab rates (throws when the rates are missing). */
async function sumExtensionFreeKm(booking: AllowanceBooking, extensionMinutesList: number[]): Promise<number> {
  if (extensionMinutesList.length === 0) return 0;
  const item = booking.items[0];
  const rates: FreeKmRates | null = item
    ? await loadFreeKmRates({ vehicleId: item.vehicleId, categoryId: item.vehicle.categoryId }, booking.branchId)
    : null;
  if (!rates) throw new Error("The vehicle's free-km rates aren't configured");
  return extensionMinutesList.reduce((sum, minutes) => sum + extensionFreeKm(minutes, rates).km, 0);
}

/**
 * Resolves the km allowance for a booking (internal Booking.id).
 * extraKmRate comes from VehicleCustomPricing ?? BranchPricingDefaults (via the
 * pricing engine); extraKmEnabled from BranchChargeConfig (default true).
 * includedKm = the engine's free km for the original booked period — never
 * fewer than the confirmation promised (pricingSnapshot, which describes that
 * period), even if the plan rules changed since — plus the free km of every
 * extension by the #7 rule.
 */
export async function getKmAllowance(bookingId: number): Promise<KmAllowance> {
  const booking = await loadAllowanceBooking(bookingId);
  if (!booking) throw new Error("Booking not found");

  const item = booking.items[0];
  if (!item) throw new Error("Booking has no vehicle assigned");

  const period = splitBookedPeriod(booking);
  const pricing = await pricingEngine.calculateBookingPrice(
    item.vehicleId,
    DateTime.fromJSDate(booking.startAt, { zone: "Asia/Kolkata" }),
    DateTime.fromJSDate(period.originalEndAt, { zone: "Asia/Kolkata" }),
    booking.branchId,
    undefined,
    undefined,
    undefined,
    undefined,
    item.vehicle.categoryId,
  );

  const freeKmOriginal = Math.max(pricing.freeKmLimit, snapshotFreeKm(booking.pricingSnapshot) ?? 0);
  const freeKmExtensions = await sumExtensionFreeKm(booking, period.extensionMinutes);

  return {
    includedKm: freeKmOriginal + freeKmExtensions,
    extraKmRate: new Decimal(pricing.extraKmRate.toString()),
    extraKmEnabled: booking.branch.chargeConfig?.extraKmEnabled ?? true,
    periodEndAt: booking.endAt,
    freeKmOriginal,
    freeKmExtensions,
  };
}

/**
 * getKmAllowance, falling back to the free km + rate frozen in the booking's
 * pricingSnapshot when the pricing engine can't price the booking (e.g. the
 * pricing config was removed). The snapshot describes the original booked
 * period; extensions add their free km on top when the vehicle's slab free
 * km can still be read.
 * Throws KmAllowanceUnavailableError when neither source works.
 */
export async function resolveKmAllowance(bookingId: number): Promise<KmAllowance> {
  try {
    return await getKmAllowance(bookingId);
  } catch (pricingErr) {
    console.warn(`[km-allowance] Pricing engine failed for booking ${bookingId}:`, pricingErr);

    const booking = await loadAllowanceBooking(bookingId);
    const snapshotItem = ((booking?.pricingSnapshot as any)?.items ?? [])[0];
    const freeKmLimit = snapshotItem?.pricingBreakdown?.freeKmLimit;
    const extraKmRate = snapshotItem?.pricingBreakdown?.extraKmRate;

    if (
      booking &&
      typeof freeKmLimit === "number" &&
      extraKmRate != null &&
      !Number.isNaN(Number(extraKmRate))
    ) {
      let freeKmExtensions: number | null = null;
      try {
        freeKmExtensions = await sumExtensionFreeKm(booking, splitBookedPeriod(booking).extensionMinutes);
      } catch (extensionErr) {
        console.warn(`[km-allowance] Extension free km unavailable for booking ${bookingId}:`, extensionErr);
      }
      if (freeKmExtensions != null) {
        return {
          includedKm: freeKmLimit + freeKmExtensions,
          extraKmRate: new Decimal(String(extraKmRate)),
          extraKmEnabled: booking.branch.chargeConfig?.extraKmEnabled ?? true,
          periodEndAt: booking.endAt,
          freeKmOriginal: freeKmLimit,
          freeKmExtensions,
        };
      }
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
    freeKmOriginal: allowance.freeKmOriginal,
    freeKmExtensions: allowance.freeKmExtensions,
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
    // includedKm = free km of the original period + free km the extensions add (#7)
    freeKmOriginal: km.freeKmOriginal,
    freeKmExtensions: km.freeKmExtensions,
    swapCount: segments?.swapCount ?? 0,
    segments: (segments?.segments ?? []).map((s) => ({
      endedBySwapPublicId: s.endedBySwapPublicId,
      startOdometer: s.startOdometer,
      endOdometer: s.endOdometer,
      km: s.km,
    })),
  };
}
