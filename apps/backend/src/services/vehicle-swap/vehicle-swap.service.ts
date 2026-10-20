/**
 * Vehicle swap — moves a booking onto another car of the same branch.
 *
 * Two stages:
 *  - PRE_PICKUP     booking CONFIRMED (the assigned car isn't handed over yet).
 *                   No readings; the replacement keeps its status until pickup.
 *  - ACTIVE_RENTAL  booking PICKED_UP. The returning car's end odometer + fuel and
 *                   the replacement's start odometer + fuel are required and stored
 *                   on the VehicleSwap row, so the drop can bill km per vehicle.
 *                   The replacement is photographed (BookingPhoto SWAP_DELIVERY,
 *                   linked to the swap) and both cars' FASTag balances are read
 *                   (cars with a FASTag) — see swap-photos.ts for who must send them.
 *
 * An ACTIVE_RENTAL swap with readings also stores the returning car's km by the
 * drop's rule (segment* columns, segment-km.ts): km driven this segment, the
 * free km left for it, the extra km and the extra-km charge. previewSwapKm shows
 * the same figures live while staff type the reading. The drop still bills km
 * once for the whole rental; the snapshot is that car's line of it.
 *
 * Every swap stores the pro-rated price difference of the GST-inclusive rents
 * for the remaining period (never negative) and whether staff chose to bill it
 * (chargeDifference). The drop bill turns a charged difference into a
 * VEHICLE_SWAP line at face value, no GST (item 8).
 *
 * Callers:
 *  - swapVehicle()          the swap screens (Fleet Executive / Branch Manager)
 *  - prepareSwap() + applySwap() + afterSwapCommit()
 *                           the extension SWAP_CURRENT_TO_OTHER commit, which runs
 *                           applySwap inside its own transaction together with
 *                           the extended end (extension-vehicle-allocator.service)
 */
import {
  prisma,
  BookingStatus,
  VehicleStatus,
  SwapReason,
  VehicleSwap,
  Role,
  ExtensionStatus,
  PaymentSessionStatus,
  PaymentSessionType,
  AuditCategory,
  BookingPhotoType,
  Prisma,
} from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { createID } from "../../utils/nanoID.js";
import { bookingPhotoOrderBy } from "../../utils/photo-order.js";
import { auditService } from "../audit/audit.service.js";
import { notifyEvents } from "../notification/notification.events.js";
import { StatusCode } from "../../types/statusCode.js";
import { PricingEngineService, heldToClosingOf, weekendDaysOf } from "../pricing/pricing-engine.service.js";
import { bookingCouponCode } from "../discount/coupon-validation.service.js";
import { recordBookingSpecialRules } from "../pricing/branch-special-rules.service.js";
import {
  DATE_CONFLICT_CODES,
  SWAP_VEHICLE_UNAVAILABLE,
  swapUnavailableMessage,
  type SwapExclusionCode,
  type SwapWindow,
} from "./swap-availability.js";
import { classifyReplacements, swapWindowFor } from "./swap-replacements.js";
import {
  invalidateVehicleAvailability,
  invalidateGroupListingCache,
} from "../../utils/cache/vehicleCacheKeys.js";
import { redis } from "../../lib/redisconfig.js";
import { extensionLockService } from "../extension/extension-lock.service.js";
import { lockBookingForDrop, vehicleStatusAfterDrop } from "../damage/drop-damage.service.js";
import { displayEmail } from "../../utils/customer/identity.js";
import { isPrivateFile, publicFileUrl } from "../../utils/file-url.js";
import { uploadedFromBranch } from "../booking-photo-file.service.js";
import {
  getOdometerSegments,
  pickedUpAtMarker,
  resolveKmAllowance,
  type KmAllowance,
} from "../charges/km-allowance.service.js";
import { swapKmSnapshot, type SwapKmSnapshot } from "../charges/segment-km.js";
import { getFastagLegs } from "../charges/fastag-usage.service.js";
import { fuelBarsToPercent, fuelPercentToBars } from "../charges/fuel-bars.js";
import type { TxClient } from "../payment/paymentSession.service.js";
import {
  fastagBalancesToStore,
  missingFastagBalances,
  normalizeReplacementPhotos,
  parseCaptureFields,
  replacementPhotoShortfall,
  swapPhotoMode,
  swapPhotoRequirement,
  swapPhotosMissing,
  type ReplacementPhotoInput,
  type SwapPhotoRequirement,
} from "./swap-photos.js";

const pricingEngine = new PricingEngineService();

/** Where a swap comes from: the swap screens, or the extension SWAP_CURRENT_TO_OTHER path. */
export type SwapSource = "STAFF" | "EXTENSION";

/** PRE_PICKUP = booking CONFIRMED; ACTIVE_RENTAL = booking PICKED_UP (car with the customer). */
export type SwapStage = "PRE_PICKUP" | "ACTIVE_RENTAL";

/**
 * Initial "Charge customer" toggle per reason: the customer asked for the
 * change, so the screen proposes billing it; company-caused swaps (maintenance,
 * damage, other) are proposed as free upgrades. Only seeds the UI — the server
 * bills a difference only when the request says chargeDifference: true.
 */
const CHARGED_BY_DEFAULT: ReadonlySet<SwapReason> = new Set<SwapReason>([
  SwapReason.CUSTOMER_REQUEST,
  SwapReason.UPGRADE,
]);

export function defaultChargeDifference(reason: SwapReason): boolean {
  return CHARGED_BY_DEFAULT.has(reason);
}

const CHARGE_DIFFERENCE_DEFAULTS = Object.fromEntries(
  Object.values(SwapReason).map((reason) => [reason, defaultChargeDifference(reason)]),
) as Record<SwapReason, boolean>;

const formatIst = (d: Date) =>
  DateTime.fromJSDate(d).setZone("Asia/Kolkata").toFormat("d LLL yyyy, h:mm a");

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * A refused swap. Controllers send `toJSON()` with `status`:
 * `{ success:false, code, message, ...extra }`.
 */
export class VehicleSwapError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "VehicleSwapError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

/** Status + body for any error thrown by this service (500 for unexpected ones). */
export function swapErrorResponse(
  err: unknown,
  fallbackMessage: string,
): { status: number; body: Record<string, unknown> } {
  if (err instanceof VehicleSwapError) return { status: err.status, body: err.toJSON() };
  return {
    status: StatusCode.INTERNAL_SERVER_ERROR,
    body: { success: false, message: errorMessage(err) || fallbackMessage },
  };
}

interface AvailableVehicle {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  status: VehicleStatus;
  categoryId: number;
  categoryName: string;
  categoryRank: number;
  images: Array<{ url: string | null }>;
}

export interface SwapCandidate extends AvailableVehicle {
  /** Current odometer — prefill for the replacement's start odometer */
  odo: number;
  /** Has a FASTag: its balance is read at a mid-rental swap */
  hasFastag: boolean;
  /**
   * Photos of this car a mid-rental swap needs (context.photosRequired): the
   * branch's pickup capture config for its category, else minPhotos photos
   */
  photoRequirement: SwapPhotoRequirement;
  /** Last recorded fuel, as a percent (Vehicle.fuelLevel) */
  fuelLevel: number;
  /** The same reading as fuel bars "1".."10" — prefill for newVehicleFuelLevel; null = unknown (0% included: see fuelPercentToBars) */
  fuelBars: string | null;
  insuranceExpiry: Date;
  /** Same category as the current vehicle (listed first) */
  sameCategory: boolean;
  /** Higher category rank than the current vehicle */
  isUpgrade: boolean;
  /**
   * Difference of the GST-inclusive rents for the remaining period, 2 dp, never
   * negative — billed as is (no GST on top) when charged.
   * null when the vehicles couldn't be priced (see swapContext.pricingError).
   */
  priceDifference: string | null;
}

export interface SwapContext {
  bookingId: string;
  bookingStatus: BookingStatus;
  stage: SwapStage;
  /** All four readings are required (ACTIVE_RENTAL) */
  readingsRequired: boolean;
  startAt: Date;
  endAt: Date;
  /** The price difference covers [remainingFrom, endAt]; remainingFrom = max(now, startAt) */
  remainingFrom: Date;
  /** (endAt − remainingFrom) / (endAt − startAt), 4 dp */
  remainingFraction: string;
  currentVehicle: {
    id: number;
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    categoryId: number;
    categoryName: string;
    categoryRank: number;
    odo: number;
    /** Percent (Vehicle.fuelLevel) */
    fuelLevel: number;
    /** fuelLevel as bars "1".."10"; null = unknown */
    fuelBars: string | null;
    /** Has a FASTag: its closing balance is read at a mid-rental swap */
    hasFastag: boolean;
    /**
     * A FASTag balance was recorded for this car on the booking (at pickup, or as
     * the replacement at an earlier swap): its closing balance is asked for too
     * (optional unless hasFastag). Mid-rental only; false otherwise.
     */
    fastagBalanceRecorded: boolean;
  };
  /**
   * The replacement must be photographed (candidate.photoRequirement) and the
   * FASTag balances read before the swap completes (ACTIVE_RENTAL)
   */
  photosRequired: boolean;
  /**
   * Odometer the current vehicle started this rental segment at (pickup reading,
   * or the start reading of the last mid-rental swap). The returning car's end
   * odometer can't be below it. null = unknown / not applicable.
   */
  currentVehicleStartOdometer: number | null;
  pricingAvailable: boolean;
  pricingError: string | null;
  /**
   * Initial "Charge customer" toggle value per reason (UI default only — a
   * request that omits chargeDifference is never billed)
   */
  chargeDifferenceDefaults: Record<SwapReason, boolean>;
}

/**
 * A car of the same type at the branch that can't take over this booking, with
 * the rule it fails (shown collapsed under the candidates, so staff aren't left
 * guessing why a car is missing).
 */
export interface SwapExcludedVehicle {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  categoryName: string;
  code: SwapExclusionCode;
  reason: string;
}

export interface SwapCandidatesResult {
  vehicles: SwapCandidate[];
  /** Same-type cars of the branch that fail a rule below, with the reason. */
  excluded: SwapExcludedVehicle[];
  context: SwapContext;
}

export interface SwapVehicleInput {
  bookingPublicId: string;
  newVehicleId: number;
  swappedById: number;
  reason: SwapReason;
  reasonNotes?: string;
  markOriginalForMaintenance?: boolean;
  originalVehicleNotes?: string;
  /** Readings — required for an ACTIVE_RENTAL swap from the swap screens */
  originalVehicleEndOdometer?: number;
  originalVehicleFuelLevel?: string;
  newVehicleStartOdometer?: number;
  newVehicleFuelLevel?: string;
  /** Bill the difference at drop; omitted (old app builds) = not billed */
  chargeDifference?: boolean;
  /**
   * Photos of the replacement (mid-rental). Sent, even empty = required;
   * omitted (old app builds) = the swap is recorded without photos.
   */
  replacementPhotos?: ReplacementPhotoInput[];
  /** FASTag balances at a mid-rental swap (cars with a FASTag; required with replacementPhotos) */
  oldVehicleFastagBalance?: number;
  newVehicleFastagBalance?: number;
  /** The booking must belong to this branch (staff / manager routes) */
  branchId?: number;
  source?: SwapSource;
  /** Check the replacement up to this end instead of booking.endAt (extension: the extended end) */
  availabilityEndAt?: Date;
  /**
   * Turnaround the replacement must keep either side of the window (default
   * BOOKING_TURNAROUND_MS, 3 h; an extension swap passes its own buffer).
   */
  turnaroundMs?: number;
}

const vehicleSummarySelect = {
  publicId: true,
  make: true,
  model: true,
  regNo: true,
  category: { select: { name: true, rank: true } },
} satisfies Prisma.VehicleSelect;

/** Relations returned with every swap row (history + swap response). */
const swapRelations = {
  booking: { select: { publicId: true, status: true } },
  originalVehicle: { select: vehicleSummarySelect },
  newVehicle: { select: vehicleSummarySelect },
  swappedBy: { select: { publicId: true, name: true, email: true, role: true } },
  photos: {
    select: {
      publicId: true,
      captureLabel: true,
      createdAt: true,
      file: { select: { key: true, url: true, mime: true } },
    },
    // The order the photos were taken (older rows: as saved)
    orderBy: bookingPhotoOrderBy(),
  },
} satisfies Prisma.VehicleSwapInclude;

type VehicleSwapRow = Prisma.VehicleSwapGetPayload<{ include: typeof swapRelations }>;

/** A photo of the replacement taken at the swap, with a viewable link. */
export interface SwapPhotoView {
  publicId: string;
  captureLabel: string | null;
  url: string;
  mime: string;
  createdAt: Date;
}

/** A swap row as the history / swap response sends it. */
export type VehicleSwapWithRelations = Omit<VehicleSwapRow, "photos"> & {
  photos: SwapPhotoView[];
  /** A mid-rental swap with no photo of the replacement (old app build, or the extension path) */
  photosMissing: boolean;
};

/**
 * `pickedUpAt` = the booking's pickup marker, only needed for rows from before
 * bookingStatusAtSwap (see pickupMarkersFor); the same rule as the drop screens.
 */
function toSwapView<T extends VehicleSwapRow>(swap: T, pickedUpAt: Date | null = null): Omit<T, "photos"> & {
  photos: SwapPhotoView[];
  photosMissing: boolean;
} {
  const photos = swap.photos.map((p) => ({
    publicId: p.publicId,
    captureLabel: p.captureLabel,
    url: publicFileUrl(p.file),
    mime: p.file.mime,
    createdAt: p.createdAt,
  }));
  return {
    ...swap,
    photos,
    photosMissing: swapPhotosMissing(swap, pickedUpAt),
  };
}

/**
 * Pickup markers of the bookings that have swap rows without
 * bookingStatusAtSwap (the only rows whose stage needs one).
 */
async function pickupMarkersFor(
  swaps: Array<{ bookingId: number; bookingStatusAtSwap: BookingStatus | null }>,
): Promise<Map<number, Date | null>> {
  const ids = [...new Set(swaps.filter((s) => s.bookingStatusAtSwap == null).map((s) => s.bookingId))];
  const markers = await Promise.all(ids.map(async (id) => [id, await pickedUpAtMarker(id)] as const));
  return new Map(markers);
}

/** Swap photos are uploaded through the pickup photo upload (Fleet and manager screens). */
const SWAP_PHOTO_KEY_PREFIX = "pickup/";

const swapBookingInclude = {
  items: { include: { vehicle: { include: { category: true } } } },
} satisfies Prisma.BookingInclude;

type SwapBooking = Prisma.BookingGetPayload<{ include: typeof swapBookingInclude }>;

type Db = TxClient;

const READING_FIELDS = [
  "originalVehicleEndOdometer",
  "originalVehicleFuelLevel",
  "newVehicleStartOdometer",
  "newVehicleFuelLevel",
] as const;

interface SwapHistoryFilters {
  bookingId?: number;
  vehicleId?: number;
  startDate?: Date;
  endDate?: Date;
  reason?: SwapReason;
}

/** Share of the rental still ahead: (endAt − max(now, startAt)) / (endAt − startAt), in [0, 1]. */
function remainingFraction(startAt: Date, endAt: Date, now: Date): Decimal {
  const total = endAt.getTime() - startAt.getTime();
  if (total <= 0) return new Decimal(0);
  const from = Math.max(now.getTime(), startAt.getTime());
  const remaining = Math.max(0, endAt.getTime() - from);
  return Decimal.min(new Decimal(1), new Decimal(remaining).div(total));
}

/** max(0, new − original) × fraction, rounded half-up to 2 dp. */
function proratedDifference(originalTaxable: Decimal, newTaxable: Decimal, fraction: Decimal): Decimal {
  return Decimal.max(new Decimal(0), newTaxable.minus(originalTaxable))
    .mul(fraction)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** A swap checked and priced outside any lock (VehicleSwapService.prepareSwap). */
export interface PreparedSwap {
  input: SwapVehicleInput;
  source: SwapSource;
  now: Date;
  booking: SwapBooking;
  effectiveEndAt: Date;
  originalItem: SwapBooking["items"][number];
  originalVehicle: SwapBooking["items"][number]["vehicle"];
  stage: SwapStage;
  storedReadings: {
    originalVehicleEndOdometer: number | null;
    originalVehicleFuelLevel: string | null;
    newVehicleStartOdometer: number | null;
    newVehicleFuelLevel: string | null;
  };
  replacement: { id: number; regNo: string; categoryId: number; hasFastag: boolean };
  photoMode: ReturnType<typeof swapPhotoMode>;
  replacementPhotos: ReplacementPhotoInput[];
  storedFastag: { oldVehicleFastagBalance: string | null; newVehicleFastagBalance: string | null };
  photosMissing: boolean;
  chargeDifference: boolean;
  priceDifference: Decimal;
  pricingError: string | null;
  /**
   * The free km and rate the drop will bill the returning car's km with (on the
   * replacement — the booking's car from now on). ACTIVE_RENTAL with readings
   * only; null otherwise or when it can't be worked out (no snapshot then).
   */
  kmAllowance: KmAllowance | null;
}

/** The returning car's km at a mid-rental swap, previewed while staff type its odometer. */
export interface SwapKmPreview {
  bookingId: string;
  vehicleRegNo: string;
  /** Car whose pricing gives the free km / rate (the replacement when one is picked) */
  rateVehicleRegNo: string;
  /** The returning car's reading at the start of this segment (pickup, or the last swap) */
  segmentStartOdometer: number | null;
  endOdometer: number;
  /** false: km can't be worked out — see unavailableReason */
  available: boolean;
  unavailableReason: string | null;
  kmDriven: number;
  /** Booking's total free km (null when it can't be worked out) */
  includedKm: number | null;
  /** km already driven on cars handed back at earlier swaps */
  priorKm: number;
  /** Free km left for this car's segment */
  allowanceKm: number | null;
  extraKm: number | null;
  extraKmRate: string | null;
  extraKmCharge: string | null;
  extraKmEnabled: boolean | null;
}

export class VehicleSwapService {

  /**
   * Replacement candidates for a booking, with the price-difference preview.
   *
   * Valid replacement: same branch and vehicle type, not deleted, and free for
   * the rest of the rental by the customer booking rule (swap-availability.ts:
   * eligibility, then CONFIRMED / PICKED_UP bookings with the turnaround grace,
   * checkouts in progress and hand-set Out for Rental over
   * [max(now, startAt), endAt)). Same-category cars first, then upgrades.
   *
   * Refuses (VehicleSwapError) exactly like the swap itself would, so the
   * screen can show why before staff pick a car. The other same-type cars of
   * the branch come back in `excluded` with the rule each one fails.
   */
  async getAvailableVehiclesForSwap(
    bookingId: string,
    branchId: number,
  ): Promise<SwapCandidatesResult> {
    const now = new Date();
    const booking = await this.loadBooking(bookingId, branchId);
    await this.assertSwappable(booking, { source: "STAFF", effectiveEndAt: booking.endAt, now });

    const currentVehicle = booking.items[0]!.vehicle;
    const window = await swapWindowFor(booking, now);

    // Every same-type car of the branch; the rule is applied below so the ones
    // that fail come back in `excluded` with the reason
    const fleet = await prisma.vehicle.findMany({
      where: {
        branchId: booking.branchId,
        deletedAt: null,
        id: { not: currentVehicle.id },
        category: { typeClass: currentVehicle.category.typeClass },
      },
      include: {
        category: true,
        images: {
          where: { isThumbnail: true },
          take: 1,
          select: { file: { select: { url: true } } },
        },
      },
    });

    const { free, excluded: rejected } = await classifyReplacements(fleet, {
      booking,
      currentRank: currentVehicle.category.rank,
      window,
      now,
    });
    const excluded: SwapExcludedVehicle[] = rejected.map(({ vehicle: v, exclusion }) => ({
      id: v.id,
      publicId: v.publicId,
      make: v.make,
      model: v.model,
      regNo: v.regNo,
      categoryName: v.category.name,
      code: exclusion.code,
      reason: exclusion.reason,
    }));
    excluded.sort(
      (a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.regNo.localeCompare(b.regNo),
    );

    // Price difference preview — the same computation the swap stores
    const fraction = remainingFraction(booking.startAt, booking.endAt, now);
    let pricingError: string | null = null;
    let originalTaxable: Decimal | null = null;
    try {
      originalTaxable = await this.taxableRental(booking, currentVehicle.id, currentVehicle.categoryId);
    } catch (err) {
      pricingError = errorMessage(err);
      console.warn(`[vehicle-swap] pricing ${currentVehicle.regNo} failed:`, err);
    }
    const differences = await Promise.all(
      free.map(async (v) => {
        if (!originalTaxable) return null;
        try {
          const newTaxable = await this.taxableRental(booking, v.id, v.categoryId);
          return proratedDifference(originalTaxable, newTaxable, fraction).toFixed(2);
        } catch (err) {
          console.warn(`[vehicle-swap] pricing candidate ${v.regNo} failed:`, err);
          return null;
        }
      }),
    );

    // Photos a mid-rental swap needs of each car: its category's pickup capture config
    const photoRequirements = await this.photoRequirementsByCategory(
      booking.branchId,
      free.map((v) => v.categoryId),
    );

    const candidates: SwapCandidate[] = free.map((vehicle, i) => ({
      id: vehicle.id,
      publicId: vehicle.publicId,
      make: vehicle.make,
      model: vehicle.model,
      regNo: vehicle.regNo,
      status: vehicle.status,
      categoryId: vehicle.categoryId,
      categoryName: vehicle.category.name,
      categoryRank: vehicle.category.rank,
      images: vehicle.images.map((img) => ({ url: img.file.url })),
      odo: vehicle.odo,
      hasFastag: vehicle.hasFastag,
      photoRequirement: photoRequirements.get(vehicle.categoryId) ?? swapPhotoRequirement([]),
      fuelLevel: vehicle.fuelLevel,
      fuelBars: fuelPercentToBars(vehicle.fuelLevel),
      insuranceExpiry: vehicle.insuranceExpiry,
      sameCategory: vehicle.categoryId === currentVehicle.categoryId,
      isUpgrade: vehicle.category.rank > currentVehicle.category.rank,
      priceDifference: differences[i] ?? null,
    }));

    candidates.sort(
      (a, b) =>
        Number(b.sameCategory) - Number(a.sameCategory) ||
        a.categoryRank - b.categoryRank ||
        a.make.localeCompare(b.make) ||
        a.model.localeCompare(b.model),
    );

    const stage: SwapStage =
      booking.status === BookingStatus.PICKED_UP ? "ACTIVE_RENTAL" : "PRE_PICKUP";

    return {
      vehicles: candidates,
      excluded,
      context: {
        bookingId: booking.publicId,
        bookingStatus: booking.status,
        stage,
        readingsRequired: stage === "ACTIVE_RENTAL",
        startAt: booking.startAt,
        endAt: booking.endAt,
        remainingFrom: new Date(Math.max(now.getTime(), booking.startAt.getTime())),
        remainingFraction: fraction.toFixed(4),
        currentVehicle: {
          id: currentVehicle.id,
          publicId: currentVehicle.publicId,
          make: currentVehicle.make,
          model: currentVehicle.model,
          regNo: currentVehicle.regNo,
          categoryId: currentVehicle.categoryId,
          categoryName: currentVehicle.category.name,
          categoryRank: currentVehicle.category.rank,
          odo: currentVehicle.odo,
          fuelLevel: currentVehicle.fuelLevel,
          fuelBars: fuelPercentToBars(currentVehicle.fuelLevel),
          hasFastag: currentVehicle.hasFastag,
          fastagBalanceRecorded:
            stage === "ACTIVE_RENTAL" &&
            (await getFastagLegs(booking.id, null)).at(-1)?.startBalance != null,
        },
        photosRequired: stage === "ACTIVE_RENTAL",
        currentVehicleStartOdometer:
          stage === "ACTIVE_RENTAL" ? await this.segmentStartOdometer(booking) : null,
        pricingAvailable: originalTaxable !== null,
        pricingError,
        chargeDifferenceDefaults: CHARGE_DIFFERENCE_DEFAULTS,
      },
    };
  }

  /**
   * Swap the booking's vehicle. Under the booking + vehicle row locks it
   * re-checks the booking and the replacement, moves the booking item, sets
   * both cars' statuses (and odometer / fuel from the readings), and writes the
   * VehicleSwap row with the readings and the price difference, plus an audit
   * log. Vehicle availability caches are cleared after commit.
   */
  async swapVehicle(input: SwapVehicleInput): Promise<VehicleSwapWithRelations> {
    const prepared = await this.prepareSwap(input);
    const { source, originalVehicle, replacement } = prepared;

    // Serialise with extension commits and other swaps on either car (the
    // extension path already holds them); the row locks below are the backstop
    const lockedVehicleIds: number[] = [];
    if (source === "STAFF") {
      const ids = [originalVehicle.id, replacement.id];
      let acquired: { acquired: number[]; failed: number[] } | null = null;
      try {
        acquired = await extensionLockService.acquireMultipleLocks(ids);
      } catch (err) {
        // Redis down — the database row locks below still serialise swaps
        console.warn("[vehicle-swap] extension lock unavailable, continuing with row locks:", err);
      }
      if (acquired && acquired.failed.length > 0) {
        throw new VehicleSwapError(
          StatusCode.CONFLICT,
          "VEHICLE_BUSY",
          "One of these vehicles is being swapped or extended right now. Try again in a moment.",
        );
      }
      if (acquired) lockedVehicleIds.push(...acquired.acquired);
    }

    let swap: VehicleSwapWithRelations;
    try {
      swap = await prisma.$transaction((tx) => this.applySwap(tx, prepared), { maxWait: 5000, timeout: 15000 });
    } finally {
      if (lockedVehicleIds.length > 0) {
        await extensionLockService.releaseMultipleLocks(lockedVehicleIds).catch((err) => {
          console.warn("[vehicle-swap] releasing extension locks failed:", err);
        });
      }
    }

    await this.afterSwapCommit(prepared, swap);
    return swap;
  }

  /**
   * The checks and work a swap does before any lock: loads and checks the
   * booking and the replacement, the readings, photos and FASTag balances, and
   * the price difference (the engine is slow). swapVehicle runs it and then
   * applySwap in its own transaction; the extension commit runs it before its
   * transaction and applySwap inside it, so the vehicle move and the extended
   * end commit together (extension-vehicle-allocator.service).
   */
  async prepareSwap(input: SwapVehicleInput): Promise<PreparedSwap> {
    const source: SwapSource = input.source ?? "STAFF";
    if (!input.bookingPublicId || !input.newVehicleId || !input.swappedById) {
      throw new VehicleSwapError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", "Missing required parameters");
    }

    const now = new Date();
    const booking = await this.loadBooking(input.bookingPublicId, input.branchId);
    const effectiveEndAt = this.effectiveEnd(booking.endAt, input.availabilityEndAt);
    await this.assertSwappable(booking, { source, effectiveEndAt, now });

    const originalItem = booking.items[0]!;
    const originalVehicle = originalItem.vehicle;
    if (input.newVehicleId === originalVehicle.id) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "SAME_VEHICLE",
        `${originalVehicle.regNo} is already the vehicle on this booking. Pick a different vehicle.`,
      );
    }

    const stage: SwapStage =
      booking.status === BookingStatus.PICKED_UP ? "ACTIVE_RENTAL" : "PRE_PICKUP";

    // Readings: required for a mid-rental swap from the swap screens; ignored before pickup
    const readings = {
      originalVehicleEndOdometer: input.originalVehicleEndOdometer ?? null,
      originalVehicleFuelLevel: input.originalVehicleFuelLevel ?? null,
      newVehicleStartOdometer: input.newVehicleStartOdometer ?? null,
      newVehicleFuelLevel: input.newVehicleFuelLevel ?? null,
    };
    if (stage === "ACTIVE_RENTAL" && source === "STAFF") {
      const missing = READING_FIELDS.filter((field) => readings[field] == null);
      if (missing.length > 0) {
        throw new VehicleSwapError(
          StatusCode.BAD_REQUEST,
          "READINGS_REQUIRED",
          "Enter the returning vehicle's odometer and fuel, and the replacement's start odometer and fuel, to swap during a rental.",
          { missing },
        );
      }
    }
    const storedReadings =
      stage === "ACTIVE_RENTAL"
        ? readings
        : {
            originalVehicleEndOdometer: null,
            originalVehicleFuelLevel: null,
            newVehicleStartOdometer: null,
            newVehicleFuelLevel: null,
          };

    const replacement = await prisma.vehicle.findFirst({
      where: { id: input.newVehicleId, branchId: booking.branchId },
      select: { id: true, regNo: true, categoryId: true, hasFastag: true },
    });
    if (!replacement) {
      throw new VehicleSwapError(
        StatusCode.NOT_FOUND,
        "VEHICLE_NOT_FOUND",
        "Replacement vehicle not found in this branch",
      );
    }

    // Photos of the replacement and both cars' FASTag balances: required from
    // current clients (they send replacementPhotos), optional from old app builds
    const photoMode = swapPhotoMode({ stage, source, replacementPhotos: input.replacementPhotos });
    let replacementPhotos: ReplacementPhotoInput[] = [];
    if (photoMode === "STRICT" && input.replacementPhotos) {
      const requirement =
        (await this.photoRequirementsByCategory(booking.branchId, [replacement.categoryId])).get(
          replacement.categoryId,
        ) ?? swapPhotoRequirement([]);
      const normalized = normalizeReplacementPhotos(input.replacementPhotos, requirement.fields);
      if (normalized.duplicates.length > 0) {
        throw new VehicleSwapError(
          StatusCode.BAD_REQUEST,
          "SWAP_PHOTOS_INVALID",
          "Two photos were sent for the same shot of the replacement vehicle. Remove the extra one and try again.",
          { fileIds: normalized.duplicates },
        );
      }
      replacementPhotos = normalized.photos;
      const shortfall = replacementPhotoShortfall(replacementPhotos, requirement);
      if (shortfall) {
        throw new VehicleSwapError(
          StatusCode.BAD_REQUEST,
          "SWAP_PHOTOS_REQUIRED",
          "Take photos of the replacement vehicle before completing the swap.",
          { ...shortfall, regNo: replacement.regNo },
        );
      }
    }
    const fastagInput = {
      stage,
      oldVehicleHasFastag: originalVehicle.hasFastag,
      newVehicleHasFastag: replacement.hasFastag,
      oldVehicleFastagBalance: input.oldVehicleFastagBalance,
      newVehicleFastagBalance: input.newVehicleFastagBalance,
    };
    const missingFastag = missingFastagBalances(photoMode, fastagInput);
    if (missingFastag.length > 0) {
      const regNos = missingFastag.map((field) =>
        field === "oldVehicleFastagBalance" ? originalVehicle.regNo : replacement.regNo,
      );
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "FASTAG_BALANCE_REQUIRED",
        `Enter the FASTag balance of ${regNos.join(" and ")} to swap during a rental.`,
        { missing: missingFastag },
      );
    }
    const fastagBalances = fastagBalancesToStore(fastagInput);
    const storedFastag = {
      oldVehicleFastagBalance:
        fastagBalances.oldVehicleFastagBalance != null
          ? new Decimal(fastagBalances.oldVehicleFastagBalance).toFixed(2)
          : null,
      newVehicleFastagBalance:
        fastagBalances.newVehicleFastagBalance != null
          ? new Decimal(fastagBalances.newVehicleFastagBalance).toFixed(2)
          : null,
    };
    const photosMissing = stage === "ACTIVE_RENTAL" && replacementPhotos.length === 0;

    // Price difference (outside the locks — the engine is slow). Under the lock
    // the booking is re-checked to still be on the same car and window.
    // Billing is only ever an explicit choice: an omitted chargeDifference (old
    // app builds, which never show the amount or the toggle) stores the
    // difference for audit but never bills it. The per-reason defaults only seed
    // the "Charge customer" toggle (swapContext.chargeDifferenceDefaults).
    const chargeDifference = source === "EXTENSION" ? false : input.chargeDifference === true;
    let priceDifference = new Decimal(0);
    let pricingError: string | null = null;
    try {
      const [originalTaxable, newTaxable] = await Promise.all([
        this.taxableRental(booking, originalVehicle.id, originalVehicle.categoryId),
        this.taxableRental(booking, replacement.id, replacement.categoryId),
      ]);
      priceDifference = proratedDifference(
        originalTaxable,
        newTaxable,
        remainingFraction(booking.startAt, booking.endAt, now),
      );
    } catch (err) {
      pricingError = errorMessage(err);
      console.warn(`[vehicle-swap] pricing failed for booking ${booking.publicId}:`, err);
      if (chargeDifference) {
        throw new VehicleSwapError(
          StatusCode.CONFLICT,
          "PRICE_DIFFERENCE_UNAVAILABLE",
          `Couldn't work out the price difference for this swap (${pricingError}). Turn off "Charge customer" to swap without billing a difference.`,
        );
      }
    }

    // Free km + rate for the returning car's km snapshot (outside the locks — the
    // engine is slow): worked out on the replacement, the car the drop will
    // price the booking's km on. A failure only skips the snapshot.
    let kmAllowance: KmAllowance | null = null;
    if (stage === "ACTIVE_RENTAL" && storedReadings.originalVehicleEndOdometer != null) {
      try {
        kmAllowance = await resolveKmAllowance(booking.id, {
          vehicleId: replacement.id,
          categoryId: replacement.categoryId,
        });
      } catch (err) {
        console.warn(`[vehicle-swap] km allowance unavailable for booking ${booking.publicId}:`, err);
      }
    }

    return {
      input,
      source,
      now,
      booking,
      effectiveEndAt,
      originalItem,
      originalVehicle,
      stage,
      storedReadings,
      replacement,
      photoMode,
      replacementPhotos,
      storedFastag,
      photosMissing,
      chargeDifference,
      priceDifference,
      pricingError,
      kmAllowance,
    };
  }

  /**
   * The returning car's km for a mid-rental swap, by the rule the drop bills it
   * with (segment-km.ts) — shown live next to its odometer field. `newVehicleId`
   * (optional) prices the free km / rate on the replacement, as the swap
   * records it; without it the current car's are used.
   */
  async previewSwapKm(
    bookingPublicId: string,
    branchId: number,
    opts: { endOdometer: number; newVehicleId?: number },
  ): Promise<SwapKmPreview> {
    const booking = await this.loadBooking(bookingPublicId, branchId);
    const current = booking.items[0]?.vehicle;
    if (booking.status !== BookingStatus.PICKED_UP || !current) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "SWAP_KM_NOT_APPLICABLE",
        "Km are only worked out for a swap during a rental.",
        { bookingStatus: booking.status },
      );
    }
    const replacement =
      opts.newVehicleId != null && opts.newVehicleId !== current.id
        ? await prisma.vehicle.findFirst({
            where: { id: opts.newVehicleId, branchId: booking.branchId },
            select: { id: true, regNo: true, categoryId: true },
          })
        : null;
    if (opts.newVehicleId != null && opts.newVehicleId !== current.id && !replacement) {
      throw new VehicleSwapError(StatusCode.NOT_FOUND, "VEHICLE_NOT_FOUND", "Replacement vehicle not found in this branch");
    }

    const segments = await getOdometerSegments(booking.id);
    const segmentStart = segments.complete ? segments.currentStartOdometer : await this.segmentStartOdometer(booking);
    if (segmentStart != null && opts.endOdometer < segmentStart) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "ODOMETER_BELOW_START",
        `${current.regNo}'s odometer (${opts.endOdometer} km) can't be below its start reading for this rental (${segmentStart} km).`,
        { segmentStartOdometer: segmentStart },
      );
    }
    const kmDriven = Math.max(0, opts.endOdometer - (segmentStart ?? opts.endOdometer));
    const base = {
      bookingId: booking.publicId,
      vehicleRegNo: current.regNo,
      rateVehicleRegNo: replacement?.regNo ?? current.regNo,
      segmentStartOdometer: segmentStart,
      endOdometer: opts.endOdometer,
      kmDriven,
      priorKm: segments.priorKm,
    };
    const unavailable = (reason: string): SwapKmPreview => ({
      ...base,
      available: false,
      unavailableReason: reason,
      includedKm: null,
      allowanceKm: null,
      extraKm: null,
      extraKmRate: null,
      extraKmCharge: null,
      extraKmEnabled: null,
    });
    if (!segments.complete) {
      return unavailable(
        "An earlier swap on this booking was recorded without odometer readings, so the km can't be worked out — staff enter the extra km at drop.",
      );
    }

    let allowance: KmAllowance;
    try {
      allowance = await resolveKmAllowance(
        booking.id,
        replacement ? { vehicleId: replacement.id, categoryId: replacement.categoryId } : undefined,
      );
    } catch (err) {
      console.warn(`[vehicle-swap] km preview: allowance unavailable for ${booking.publicId}:`, err);
      return unavailable("The free-km allowance for this booking can't be worked out — check the vehicle's pricing setup.");
    }
    const snapshot = swapKmSnapshot({
      priorSegmentKms: segments.segments.map((s) => s.km),
      segmentStartOdometer: segmentStart,
      endOdometer: opts.endOdometer,
      allowance,
    });
    if (!snapshot) return unavailable("The km can't be worked out for this booking.");
    return {
      ...base,
      available: true,
      unavailableReason: null,
      kmDriven: snapshot.segmentKmDriven,
      includedKm: snapshot.segmentIncludedKm,
      allowanceKm: snapshot.segmentAllowanceKm,
      extraKm: snapshot.segmentExtraKm,
      extraKmRate: snapshot.segmentExtraKmRate,
      extraKmCharge: snapshot.segmentExtraKmCharge,
      extraKmEnabled: snapshot.segmentExtraKmEnabled,
    };
  }

  /**
   * The swap itself, inside `tx`: locks the booking row, then both vehicle rows
   * (FOR UPDATE, id order), re-checks the booking and the replacement (the swap
   * availability rule over the rest of the rental, to `availabilityEndAt` on
   * the extension path), moves the booking item, sets both cars' statuses and
   * readings, and writes the VehicleSwap row, its photos and the audit log.
   * Run afterSwapCommit once `tx` has committed.
   */
  async applySwap(tx: Prisma.TransactionClient, prepared: PreparedSwap): Promise<VehicleSwapWithRelations> {
    const {
      input,
      source,
      now,
      booking,
      effectiveEndAt,
      originalItem,
      originalVehicle,
      stage,
      storedReadings,
      replacement,
      photoMode,
      replacementPhotos,
      storedFastag,
      photosMissing,
      chargeDifference,
      priceDifference,
      pricingError,
      kmAllowance,
    } = prepared;
    const db = tx as unknown as Db;
    // Lock order: booking, then vehicles by id — same as the drop and extension paths
    await lockBookingForDrop(db, booking.id);
    const locked = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: swapBookingInclude,
    });
    const lockedItem = locked.items[0];
    if (
      !lockedItem ||
      lockedItem.id !== originalItem.id ||
      lockedItem.vehicleId !== originalVehicle.id ||
      locked.startAt.getTime() !== booking.startAt.getTime() ||
      locked.endAt.getTime() !== booking.endAt.getTime() ||
      locked.status !== booking.status
    ) {
      throw new VehicleSwapError(
        StatusCode.CONFLICT,
        "BOOKING_CHANGED",
        "This booking changed while the swap was being prepared. Reload and try again.",
      );
    }
    await this.assertSwappable(locked, { source, effectiveEndAt, now }, db);

    for (const id of [originalVehicle.id, replacement.id].sort((a, b) => a - b)) {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${id} FOR UPDATE`;
    }
    const [lockedOriginal, newVehicle] = await Promise.all([
      tx.vehicle.findUniqueOrThrow({ where: { id: originalVehicle.id }, include: { category: true } }),
      tx.vehicle.findUniqueOrThrow({ where: { id: replacement.id }, include: { category: true } }),
    ]);

    // The rest of the rental (to the extension end on the extension path),
    // checked by the customer booking rule now the rows are locked: a
    // concurrent swap, booking or checkout for the car has committed or waits
    const window = await swapWindowFor(locked, now, input.availabilityEndAt, tx, { turnaroundMs: input.turnaroundMs });
    await this.assertReplacementValid(tx, locked, lockedOriginal, newVehicle, window, now);

    // The returning car can't come back below the reading it started this segment at
    if (stage === "ACTIVE_RENTAL" && storedReadings.originalVehicleEndOdometer != null) {
      const segmentStart = await this.segmentStartOdometer(locked, db);
      if (segmentStart != null && storedReadings.originalVehicleEndOdometer < segmentStart) {
        throw new VehicleSwapError(
          StatusCode.BAD_REQUEST,
          "ODOMETER_BELOW_START",
          `${lockedOriginal.regNo}'s odometer (${storedReadings.originalVehicleEndOdometer} km) can't be below its start reading for this rental (${segmentStart} km).`,
          { segmentStartOdometer: segmentStart },
        );
      }
    }

    // The returning car's km, recorded with the swap by the drop's rule: its
    // segment after the cars handed back at earlier swaps (read under the lock)
    let kmSnapshot: SwapKmSnapshot | null = null;
    if (stage === "ACTIVE_RENTAL" && storedReadings.originalVehicleEndOdometer != null && kmAllowance) {
      const segments = await getOdometerSegments(locked.id, db);
      kmSnapshot = swapKmSnapshot({
        priorSegmentKms: segments.segments.map((s) => s.km),
        segmentStartOdometer: segments.currentStartOdometer,
        endOdometer: storedReadings.originalVehicleEndOdometer,
        allowance: segments.complete ? kmAllowance : null,
      });
    }

    // …and the replacement can't start below its own recorded reading: a
    // mistyped low reading would roll the fleet odometer back and become
    // the start of the drop's last km segment.
    if (
      stage === "ACTIVE_RENTAL" &&
      storedReadings.newVehicleStartOdometer != null &&
      storedReadings.newVehicleStartOdometer < newVehicle.odo
    ) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "ODOMETER_BELOW_RECORDED",
        `${newVehicle.regNo}'s start odometer (${storedReadings.newVehicleStartOdometer} km) can't be below its last recorded reading (${newVehicle.odo} km). Check the dashboard; if the recorded reading is wrong, ask the branch manager to correct it.`,
        { recordedOdometer: newVehicle.odo, vehicleId: newVehicle.id },
      );
    }

    // The photos must be fresh pickup-photo uploads not saved anywhere yet
    const photoFileIds =
      replacementPhotos.length > 0
        ? await this.claimSwapPhotoFiles(db, replacementPhotos, locked.branchId)
        : new Map<string, number>();

    await tx.bookingItem.update({
      where: { id: lockedItem.id },
      data: { vehicleId: newVehicle.id },
    });
    // Festival rules: today's touching the window both cars were priced over
    // join the booking's stored ones (a stored version wins)
    await recordBookingSpecialRules(tx, locked.id, locked.startAt, locked.endAt);

    // ── Vehicle statuses / readings ──────────────────────────────────
    let originalStatusAfter: VehicleStatus;
    let maintenanceNotApplied = false;
    if (stage === "ACTIVE_RENTAL") {
      // Pending drop damage on the returning car → MANAGER_REPORTED (manager decides)
      const damageStatus = await vehicleStatusAfterDrop(locked.id, lockedOriginal.id, db);
      originalStatusAfter =
        damageStatus && damageStatus !== VehicleStatus.AVAILABLE
          ? damageStatus
          : input.markOriginalForMaintenance
            ? VehicleStatus.MAINTENANCE
            : VehicleStatus.AVAILABLE;

      await tx.vehicle.update({
        where: { id: newVehicle.id },
        data: {
          status: VehicleStatus.OUT_FOR_RENTAL,
          ...(storedReadings.newVehicleStartOdometer != null && { odo: storedReadings.newVehicleStartOdometer }),
          ...(storedReadings.newVehicleFuelLevel != null && { fuelLevel: fuelBarsToPercent(storedReadings.newVehicleFuelLevel) }),
        },
      });
    } else {
      // Before pickup the replacement keeps its status (pickup marks it
      // OUT_FOR_RENTAL). The original is only touched when flagged for
      // maintenance, and never while it is still out on another rental.
      const onOtherRental = await tx.bookingItem.findFirst({
        where: {
          vehicleId: lockedOriginal.id,
          booking: { status: BookingStatus.PICKED_UP, id: { not: locked.id } },
        },
        select: { id: true },
      });
      maintenanceNotApplied = !!onOtherRental && input.markOriginalForMaintenance === true;
      originalStatusAfter =
        !onOtherRental && input.markOriginalForMaintenance
          ? VehicleStatus.MAINTENANCE
          : lockedOriginal.status;
    }

    const originalData: Prisma.VehicleUpdateInput = {};
    if (originalStatusAfter !== lockedOriginal.status) originalData.status = originalStatusAfter;
    if (storedReadings.originalVehicleEndOdometer != null) originalData.odo = storedReadings.originalVehicleEndOdometer;
    if (storedReadings.originalVehicleFuelLevel != null) originalData.fuelLevel = fuelBarsToPercent(storedReadings.originalVehicleFuelLevel);
    if (Object.keys(originalData).length > 0) {
      await tx.vehicle.update({ where: { id: lockedOriginal.id }, data: originalData });
    }

    const createdRow = await tx.vehicleSwap.create({
      data: {
        publicId: createID(),
        bookingId: locked.id,
        originalVehicleId: lockedOriginal.id,
        newVehicleId: newVehicle.id,
        swappedById: input.swappedById,
        reason: input.reason,
        reasonNotes: input.reasonNotes,
        originalVehicleStatus: originalStatusAfter,
        originalVehicleNotes: input.originalVehicleNotes,
        swappedAt: new Date(),
        bookingStatusAtSwap: locked.status,
        ...storedReadings,
        priceDifference: priceDifference.toFixed(2),
        chargeDifference,
        ...storedFastag,
        ...(kmSnapshot ?? {}),
      },
      select: { id: true },
    });
    if (replacementPhotos.length > 0) {
      await tx.bookingPhoto.createMany({
        // As sent (normalized) = the order the photos were taken
        data: replacementPhotos.map((photo, i) => ({
          publicId: createID(),
          bookingId: locked.id,
          fileId: photoFileIds.get(photo.fileId)!,
          type: BookingPhotoType.SWAP_DELIVERY,
          captureLabel: photo.label ?? null,
          swapId: createdRow.id,
          vehicleId: newVehicle.id,
          captureOrder: i,
        })),
      });
    }
    const created = await tx.vehicleSwap.findUniqueOrThrow({
      where: { id: createdRow.id },
      include: swapRelations,
    });

    const actor = await tx.user.findUnique({
      where: { id: input.swappedById },
      select: { name: true, role: true, branchId: true },
    });
    const differenceNote = priceDifference.gt(0)
      ? `; price difference ₹${priceDifference.toFixed(2)} ${chargeDifference ? "to be billed at drop" : "waived"}`
      : "";
    const kmNote =
      kmSnapshot && kmSnapshot.segmentExtraKm > 0
        ? `; extra km on ${lockedOriginal.regNo}: ${kmSnapshot.segmentExtraKm} km${kmSnapshot.segmentExtraKmEnabled ? ` · ₹${kmSnapshot.segmentExtraKmCharge}` : ""} — billed at drop`
        : "";
    const photoNote = photosMissing
      ? `; no photos of ${newVehicle.regNo} were taken at the swap${photoMode === "LEGACY" ? " (older app build)" : ""}`
      : "";
    await auditService.log(
      {
        actorId: input.swappedById,
        actorName: actor?.name ?? "Unknown",
        actorRole: actor?.role ?? Role.STAFF,
        actorBranchId: actor?.branchId ?? undefined,
        action: "VEHICLE_SWAP",
        category: AuditCategory.VEHICLE,
        description:
          `Vehicle swapped from ${lockedOriginal.regNo} to ${newVehicle.regNo} on booking ${locked.publicId} ` +
          `(${stage === "ACTIVE_RENTAL" ? "during the rental" : "before pickup"}) — reason: ${input.reason}${differenceNote}${kmNote}${photoNote}`,
        entity: "Booking",
        entityId: locked.publicId,
        metadata: {
          swapPublicId: created.publicId,
          source,
          stage,
          bookingStatusAtSwap: locked.status,
          originalVehicle: { publicId: lockedOriginal.publicId, regNo: lockedOriginal.regNo },
          newVehicle: { publicId: newVehicle.publicId, regNo: newVehicle.regNo },
          reason: input.reason,
          markOriginalForMaintenance: input.markOriginalForMaintenance === true,
          maintenanceNotApplied,
          originalVehicleStatus: originalStatusAfter,
          readings: storedReadings,
          priceDifference: priceDifference.toFixed(2),
          chargeDifference,
          pricingError,
          photoMode,
          replacementPhotoCount: replacementPhotos.length,
          photosMissing,
          fastagBalances: storedFastag,
          kmSnapshot,
        },
      },
      tx,
    );

    return toSwapView(created);
  }

  /** After the swap's transaction committed: clear availability caches, notify. */
  async afterSwapCommit(prepared: PreparedSwap, swap: Pick<VehicleSwap, "id">): Promise<void> {
    const { input, originalVehicle, replacement } = prepared;
    try {
      await invalidateVehicleAvailability(redis, [originalVehicle.id, replacement.id]);
      await invalidateGroupListingCache(redis as any);
    } catch (err) {
      console.warn("[vehicle-swap] cache invalidation failed (non-fatal):", err);
    }

    void notifyEvents.vehicleSwapped({ swapId: swap.id, actorUserId: input.swappedById });

  }

  /**
   * Get swap history for a booking (newest first)
   */
  async getSwapHistory(bookingId: number): Promise<VehicleSwapWithRelations[]> {
    const swaps = await prisma.vehicleSwap.findMany({
      where: { bookingId },
      include: swapRelations,
      orderBy: { swappedAt: 'desc' }
    });
    const markers = await pickupMarkersFor(swaps);
    return swaps.map((swap) => toSwapView(swap, markers.get(swap.bookingId) ?? null));
  }

  /**
   * Swap history for a booking of this branch, by publicId (or the numeric id
   * older manager screens send). 404 when it isn't this branch's booking.
   */
  async getBookingSwapHistory(
    bookingRef: string,
    branchId: number,
  ): Promise<VehicleSwapWithRelations[]> {
    const numericId = /^\d+$/.test(bookingRef) ? Number(bookingRef) : null;
    const booking = await prisma.booking.findFirst({
      where: {
        branchId,
        OR: [{ publicId: bookingRef }, ...(numericId != null ? [{ id: numericId }] : [])],
      },
      select: { id: true },
    });
    if (!booking) {
      throw new VehicleSwapError(StatusCode.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking not found");
    }
    return this.getSwapHistory(booking.id);
  }

  /**
   * Get swaps by date range with optional filters
   */
  async getSwapsByDateRange(
    branchId: number,
    startDate: Date,
    endDate: Date,
    filters?: SwapHistoryFilters,
    limit?: number,
  ) {
    const where: any = {
      swappedAt: {
        gte: startDate,
        lte: endDate
      },
      booking: {
        branchId: branchId
      }
    };

    if (filters?.bookingId) {
      where.bookingId = filters.bookingId;
    }

    if (filters?.vehicleId) {
      where.OR = [
        { originalVehicleId: filters.vehicleId },
        { newVehicleId: filters.vehicleId }
      ];
    }

    if (filters?.reason) {
      where.reason = filters.reason;
    }

    const swaps = await prisma.vehicleSwap.findMany({
      where,
      include: {
        ...swapRelations,
        booking: {
          select: {
            publicId: true,
            status: true,
            customer: {
              select: {
                user: {
                  select: {
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        },
      },
      orderBy: { swappedAt: 'desc' },
      ...(limit != null && { take: limit }),
    });

    const markers = await pickupMarkersFor(swaps);
    // Walk-in placeholder emails are never shown
    return swaps.map((swap) => ({
      ...toSwapView(swap, markers.get(swap.bookingId) ?? null),
      booking: {
        ...swap.booking,
        customer: {
          ...swap.booking.customer,
          user: {
            ...swap.booking.customer.user,
            email: displayEmail(swap.booking.customer.user.email),
          },
        },
      },
    }));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Photos a mid-rental swap needs of a car, per category: the branch's pickup
   * capture config for it (VehiclePhotoCaptureConfig), else minPhotos photos.
   */
  private async photoRequirementsByCategory(
    branchId: number,
    categoryIds: number[],
  ): Promise<Map<number, SwapPhotoRequirement>> {
    const ids = [...new Set(categoryIds)];
    const configs =
      ids.length > 0
        ? await prisma.vehiclePhotoCaptureConfig.findMany({
            where: { branchId, categoryId: { in: ids } },
            select: { categoryId: true, fields: true },
          })
        : [];
    const fieldsOf = new Map(configs.map((c) => [c.categoryId, parseCaptureFields(c.fields)]));
    return new Map(ids.map((id) => [id, swapPhotoRequirement(fieldsOf.get(id) ?? [])]));
  }

  /**
   * The swap photos' files (FileObject publicIds) → their ids. Each must be a
   * pickup-photo upload (public, pickup/ key) uploaded from the booking's
   * branch (or before uploads recorded one), not yet saved with any booking
   * and not kept in a paused pickup / drop; otherwise SWAP_PHOTOS_INVALID.
   */
  private async claimSwapPhotoFiles(
    db: Db,
    photos: ReplacementPhotoInput[],
    branchId: number,
  ): Promise<Map<string, number>> {
    const publicIds = photos.map((p) => p.fileId);
    const files = await db.fileObject.findMany({
      where: { publicId: { in: publicIds } },
      select: {
        id: true,
        publicId: true,
        key: true,
        url: true,
        uploadedBranchId: true,
        _count: { select: { bookingPhotos: true } },
      },
    });
    const byPublicId = new Map(files.map((f) => [f.publicId, f]));
    const unusable = publicIds.filter((id) => {
      const file = byPublicId.get(id);
      return (
        !file ||
        isPrivateFile(file) ||
        !file.key.startsWith(SWAP_PHOTO_KEY_PREFIX) ||
        !uploadedFromBranch(file, branchId) ||
        file._count.bookingPhotos > 0
      );
    });
    // OperationDraft.data = { schemaVersion, data, photos: [{ fileId, label }] }
    const inDraft =
      unusable.length === 0
        ? await db.operationDraft.findMany({
            where: {
              OR: publicIds.map((fileId) => ({
                data: { path: ["photos"], array_contains: [{ fileId }] },
              })),
            },
            select: { data: true },
          })
        : [];
    for (const draft of inDraft) {
      const draftPhotos = (draft.data as { photos?: Array<{ fileId?: unknown }> } | null)?.photos ?? [];
      for (const p of draftPhotos) {
        if (typeof p?.fileId === "string" && publicIds.includes(p.fileId) && !unusable.includes(p.fileId)) {
          unusable.push(p.fileId);
        }
      }
    }
    if (unusable.length > 0) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "SWAP_PHOTOS_INVALID",
        "Some photos of the replacement vehicle couldn't be used. Remove them and take them again.",
        { fileIds: unusable },
      );
    }
    return new Map(files.map((f) => [f.publicId, f.id]));
  }

  /** Booking by publicId, scoped to the branch when one is given (staff / manager routes). */
  private async loadBooking(bookingPublicId: string, branchId?: number): Promise<SwapBooking> {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingPublicId, ...(branchId != null && { branchId }) },
      include: swapBookingInclude,
    });
    if (!booking) {
      throw new VehicleSwapError(StatusCode.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking not found");
    }
    return booking;
  }

  /** The end the replacement must be free until: the booking's end, or a later extension end. */
  private effectiveEnd(endAt: Date, availabilityEndAt?: Date): Date {
    return availabilityEndAt && availabilityEndAt.getTime() > endAt.getTime() ? availabilityEndAt : endAt;
  }

  /**
   * Booking-level refusals. Run once before any work and again under the
   * booking row lock.
   *  - status must be CONFIRMED or PICKED_UP, with a vehicle
   *  - no pickup / return waiting for manager confirmation
   *  - not past its end (overdue rentals are extended first)
   *  - swap screens only: no pickup session past OPEN on a CONFIRMED booking
   *    (its handover readings belong to the current car), no drop bill started
   *    (RETURN session) and no committed-but-unpaid extension — both are
   *    priced on the current car
   */
  private async assertSwappable(
    booking: SwapBooking,
    opts: { source: SwapSource; effectiveEndAt: Date; now: Date },
    db: Db = prisma,
  ): Promise<void> {
    if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.PICKED_UP) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "SWAP_NOT_ELIGIBLE",
        `Only confirmed or active rentals can have their vehicle swapped. This booking is ${booking.status}.`,
        { bookingStatus: booking.status },
      );
    }

    if (!booking.items[0]) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "SWAP_NOT_ELIGIBLE",
        "This booking has no vehicle to swap.",
        { bookingStatus: booking.status },
      );
    }

    if (booking.requiresManagerConfirmation) {
      throw new VehicleSwapError(
        StatusCode.CONFLICT,
        "MANAGER_CONFIRMATION_PENDING",
        booking.status === BookingStatus.PICKED_UP
          ? "This return is waiting for the branch manager's confirmation, so the vehicle can't be swapped."
          : "This pickup is waiting for the branch manager's confirmation. Swap the vehicle after the manager has confirmed it.",
      );
    }

    if (opts.effectiveEndAt.getTime() <= opts.now.getTime()) {
      throw new VehicleSwapError(
        StatusCode.CONFLICT,
        "BOOKING_OVERDUE",
        booking.status === BookingStatus.PICKED_UP
          ? `This rental was due back on ${formatIst(booking.endAt)}. Extend the booking first, then swap the vehicle.`
          : `This booking's rental period ended on ${formatIst(booking.endAt)}, so its vehicle can't be swapped.`,
        { endAt: booking.endAt.toISOString() },
      );
    }

    if (opts.source !== "STAFF") return;

    // Unified Payments pickup already started: initiating the pickup session
    // saved the current car's handover readings (booking.startOdometer, its
    // odo/fuel, the fuel record, handover photos) and the payment flips that
    // booking's car to OUT_FOR_RENTAL. A pre-pickup swap now would leave those
    // readings on the wrong car, so the pickup is finished first and the car is
    // swapped mid-rental (with readings) instead.
    if (booking.status === BookingStatus.CONFIRMED) {
      const pickupSession = await db.paymentSession.findFirst({
        where: {
          bookingId: booking.id,
          sessionType: PaymentSessionType.PICKUP,
          status: { notIn: [PaymentSessionStatus.OPEN, PaymentSessionStatus.ABANDONED] },
        },
        select: { status: true },
      });
      if (pickupSession) {
        const regNo = booking.items[0]?.vehicle.regNo;
        throw new VehicleSwapError(
          StatusCode.CONFLICT,
          "PICKUP_IN_PROGRESS",
          `The pickup for this booking has already been started${regNo ? ` with ${regNo}` : ""} — its handover readings are saved and the payment is open. Complete the pickup, then swap the vehicle from the drop screen.`,
          { pickupSessionStatus: pickupSession.status },
        );
      }
    }

    const returnSession = await db.paymentSession.findFirst({
      where: {
        bookingId: booking.id,
        sessionType: PaymentSessionType.RETURN,
        status: { not: PaymentSessionStatus.ABANDONED },
      },
      select: { status: true },
    });
    if (returnSession) {
      throw new VehicleSwapError(
        StatusCode.CONFLICT,
        "RETURN_IN_PROGRESS",
        "The drop bill for this booking has already been started. Finish the drop instead of swapping the vehicle.",
        { returnSessionStatus: returnSession.status },
      );
    }

    if (booking.activeExtensionId != null) {
      const extension = await db.bookingExtension.findUnique({
        where: { id: booking.activeExtensionId },
        select: {
          publicId: true,
          extensionStatus: true,
          resolutionType: true,
          gatewayTransactionId: true,
          paymentTransactionId: true,
        },
      });
      const isOpen =
        extension?.extensionStatus === ExtensionStatus.PENDING_PAYMENT ||
        extension?.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED;
      // A quote that was never committed holds no vehicle slot and no money
      const isUncommittedQuote =
        extension?.extensionStatus === ExtensionStatus.PENDING_PAYMENT &&
        extension.resolutionType === null &&
        extension.gatewayTransactionId === null &&
        extension.paymentTransactionId === null;
      if (extension && isOpen && !isUncommittedQuote) {
        throw new VehicleSwapError(
          StatusCode.CONFLICT,
          "EXTENSION_PENDING",
          extension.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED
            ? "This booking's extension payment is waiting for the branch manager's confirmation. Swap the vehicle after it is confirmed."
            : "This booking has an extension waiting for payment. Collect or cancel the extension before swapping the vehicle.",
          {
            pendingExtensionPublicId: extension.publicId,
            pendingExtensionStatus: extension.extensionStatus,
          },
        );
      }
    }
  }

  /**
   * Replacement checks under the vehicle row locks: same branch and vehicle
   * type, not deleted, and free for `window` by the swap rule
   * (classifyReplacements — the candidate list's rule, read through the
   * transaction). Taken for part of the window → 409 SWAP_VEHICLE_UNAVAILABLE.
   */
  private async assertReplacementValid(
    tx: Prisma.TransactionClient,
    booking: SwapBooking,
    original: SwapBooking["items"][number]["vehicle"],
    replacement: SwapBooking["items"][number]["vehicle"],
    window: SwapWindow,
    now: Date,
  ): Promise<void> {
    if (replacement.branchId !== booking.branchId) {
      throw new VehicleSwapError(
        StatusCode.NOT_FOUND,
        "VEHICLE_NOT_FOUND",
        "Replacement vehicle not found in this branch",
      );
    }
    if (replacement.deletedAt) {
      throw new VehicleSwapError(
        StatusCode.CONFLICT,
        "VEHICLE_NOT_AVAILABLE",
        `${replacement.regNo} has been removed from the fleet.`,
        { vehicleId: replacement.id, regNo: replacement.regNo },
      );
    }
    if (replacement.category.typeClass !== original.category.typeClass) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "VEHICLE_TYPE_MISMATCH",
        `${replacement.regNo} is a different type of vehicle from ${original.regNo}.`,
      );
    }

    const { excluded } = await classifyReplacements([replacement], {
      booking,
      currentRank: original.category.rank,
      window,
      now,
      db: tx,
    });
    const exclusion = excluded[0]?.exclusion;
    if (!exclusion) return;
    if (exclusion.code === "LOWER_CATEGORY") {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "CATEGORY_DOWNGRADE",
        "Cannot swap to a lower category vehicle",
      );
    }
    const extra = {
      vehicleId: replacement.id,
      regNo: replacement.regNo,
      reasonCode: exclusion.code,
      reason: exclusion.reason,
    };
    if (DATE_CONFLICT_CODES.has(exclusion.code)) {
      throw new VehicleSwapError(
        StatusCode.CONFLICT,
        SWAP_VEHICLE_UNAVAILABLE,
        swapUnavailableMessage(replacement.regNo, exclusion),
        extra,
      );
    }
    throw new VehicleSwapError(
      StatusCode.CONFLICT,
      "VEHICLE_NOT_AVAILABLE",
      `${replacement.regNo} can't take over this booking: ${exclusion.reason}.`,
      extra,
    );
  }

  /**
   * Odometer the booking's current vehicle started its segment at: the pickup
   * reading, or the start reading of the last mid-rental swap. null when it
   * can't be known (no pickup reading, or a legacy swap row without readings).
   */
  private async segmentStartOdometer(booking: SwapBooking, db: Db = prisma): Promise<number | null> {
    const lastSwap = await db.vehicleSwap.findFirst({
      where: { bookingId: booking.id },
      orderBy: { swappedAt: "desc" },
      select: { bookingStatusAtSwap: true, newVehicleStartOdometer: true },
    });
    if (!lastSwap || lastSwap.bookingStatusAtSwap === BookingStatus.CONFIRMED) {
      return booking.startOdometer ?? null;
    }
    if (lastSwap.bookingStatusAtSwap === BookingStatus.PICKED_UP) {
      return lastSwap.newVehicleStartOdometer ?? null;
    }
    return null;
  }

  /**
   * Engine price of the booking's full window [startAt, endAt] on a vehicle:
   * the GST-INCLUSIVE rent after discounts (item 17 — rents are inclusive, and a
   * swap difference is billed at that face value with no GST added, item 8).
   * Same customer and coupon inputs for both cars,
   * as the extension pricing does, so coupon effects cancel out in the delta.
   * The booking's own coupon is locked in exactly like extension pricing: its
   * own usage row isn't counted against it, its validity window / usage limits
   * aren't re-checked, and it is checked against the booking's payment plan —
   * otherwise a single-use or since-expired coupon would drop out of both
   * prices and the difference would be the undiscounted one. The coupon is
   * found by its rule id, so a code changed since the booking still resolves.
   */
  private async taxableRental(booking: SwapBooking, vehicleId: number, categoryId: number): Promise<Decimal> {
    const couponCode = await bookingCouponCode(booking);
    const result = await pricingEngine.calculateBookingPrice(
      vehicleId,
      DateTime.fromJSDate(booking.startAt),
      DateTime.fromJSDate(booking.endAt),
      booking.branchId,
      booking.customerId,
      couponCode,
      undefined,
      undefined,
      categoryId,
      undefined,
      {
        paymentPlan: booking.isAdvancePayment ? "ADVANCE" : "FULL",
        excludeBookingId: booking.id,
        couponLockedIn: Boolean(couponCode),
        // Booked as 12 hours held to closing (item 6): both cars billed as 12 h
        heldToClosing: heldToClosingOf(booking.pricingSnapshot),
        // Weekend blocks by the weekend days it was booked with (none before weekend rates)
        weekendDays: weekendDaysOf(booking.pricingSnapshot),
        // Festival rules: today's for both cars (no specialRules), like today's rates;
        // the confirmed swap stores them on the booking (recordBookingSpecialRules)
      },
    );
    // finalTotal = the post-discount rent incl. GST (what the customer pays for it)
    return new Decimal(result.finalTotal.toString());
  }
}
