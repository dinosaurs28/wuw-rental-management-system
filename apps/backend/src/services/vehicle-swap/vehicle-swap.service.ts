/**
 * Vehicle swap — moves a booking onto another car of the same branch.
 *
 * Two stages:
 *  - PRE_PICKUP     booking CONFIRMED (the assigned car isn't handed over yet).
 *                   No readings; the replacement keeps its status until pickup.
 *  - ACTIVE_RENTAL  booking PICKED_UP. The returning car's end odometer + fuel and
 *                   the replacement's start odometer + fuel are required and stored
 *                   on the VehicleSwap row, so the drop can bill km per vehicle.
 *
 * Every swap stores the pro-rated price difference of the GST-inclusive rents
 * for the remaining period (never negative) and whether staff chose to bill it
 * (chargeDifference). The drop bill turns a charged difference into a
 * VEHICLE_SWAP line at face value, no GST (item 8).
 *
 * Callers:
 *  - swapVehicle()          the swap screens (Fleet Executive / Branch Manager)
 *  - performVehicleSwap()   the extension SWAP_CURRENT_TO_OTHER path (positional,
 *                           kept for extension-vehicle-allocator.service)
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
  Prisma,
} from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { createID } from "../../utils/nanoID.js";
import { auditService } from "../audit/audit.service.js";
import { notifyEvents } from "../notification/notification.events.js";
import { StatusCode } from "../../types/statusCode.js";
import { PricingEngineService, heldToClosingOf } from "../pricing/pricing-engine.service.js";
import {
  explainUnavailableVehicles,
  getUnavailableVehicleIds,
} from "../../utils/availability/availabilityBatch.js";
import {
  invalidateVehicleAvailability,
  invalidateGroupListingCache,
} from "../../utils/cache/vehicleCacheKeys.js";
import { redis } from "../../lib/redisconfig.js";
import { extensionLockService } from "../extension/extension-lock.service.js";
import { lockBookingForDrop, vehicleStatusAfterDrop } from "../damage/drop-damage.service.js";
import { displayEmail } from "../../utils/customer/identity.js";
import type { TxClient } from "../payment/paymentSession.service.js";

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
  /** Last recorded fuel, as a percent (Vehicle.fuelLevel) */
  fuelLevel: number;
  /** The same reading as fuel bars "1".."10" — prefill for newVehicleFuelLevel; null = unknown */
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
  };
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
  code:
    | "STATUS_OUT_FOR_RENTAL"
    | "MANUAL_OUT_FOR_RENTAL"
    | "STATUS_MAINTENANCE"
    | "STATUS_INACTIVE"
    | "DAMAGE_REVIEW_PENDING"
    | "INSURANCE_EXPIRES"
    | "LOWER_CATEGORY"
    | "STILL_OUT"
    | "BOOKED"
    | "ON_HOLD";
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
  /** The booking must belong to this branch (staff / manager routes) */
  branchId?: number;
  source?: SwapSource;
  /** Check the replacement up to this end instead of booking.endAt (extension: the extended end) */
  availabilityEndAt?: Date;
}

export interface LegacySwapOptions {
  branchId?: number;
  availabilityEndAt?: Date;
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
} satisfies Prisma.VehicleSwapInclude;

export type VehicleSwapWithRelations = Prisma.VehicleSwapGetPayload<{ include: typeof swapRelations }>;

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

/**
 * Vehicle.fuelLevel holds a percent (both pickup screens send bars × 10), while
 * swap readings are bars "1".."10". Store a reading on the vehicle as a percent.
 */
function fuelBarsToPercent(bars: string): number {
  return Number(bars) * 10;
}

/** Vehicle.fuelLevel (percent) as fuel bars "1".."10"; null when it isn't a whole bar (unknown / legacy). */
function fuelPercentToBars(percent: number | null | undefined): string | null {
  if (percent == null || !Number.isInteger(percent)) return null;
  if (percent < 10 || percent > 100 || percent % 10 !== 0) return null;
  return String(percent / 10);
}

/** max(0, new − original) × fraction, rounded half-up to 2 dp. */
function proratedDifference(originalTaxable: Decimal, newTaxable: Decimal, fraction: Decimal): Decimal {
  return Decimal.max(new Decimal(0), newTaxable.minus(originalTaxable))
    .mul(fraction)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export class VehicleSwapService {

  /**
   * Replacement candidates for a booking, with the price-difference preview.
   *
   * Valid replacement: same branch and vehicle type, AVAILABLE, not deleted,
   * insurance valid past the booking's end, category rank ≥ the current car's,
   * not out on any PICKED_UP booking (covers overdue rentals), and no
   * CONFIRMED/PICKED_UP booking or checkout hold overlapping
   * [max(now, startAt), endAt). Same-category cars first, then upgrades.
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
    const windowStart = new Date(Math.max(now.getTime(), booking.startAt.getTime()));
    const windowEnd = booking.endAt;

    // Every same-type car of the branch; the rules above are applied below so
    // the ones that fail come back in `excluded` with the reason
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
    // Still out with a customer (incl. overdue rentals past their endAt)
    const outOnRental = new Set(
      (
        await prisma.bookingItem.findMany({
          where: { vehicleId: { in: fleet.map((v) => v.id) }, booking: { status: BookingStatus.PICKED_UP } },
          select: { vehicleId: true },
        })
      ).map((i) => i.vehicleId),
    );

    const excluded: SwapExcludedVehicle[] = [];
    const exclude = (v: (typeof fleet)[number], code: SwapExcludedVehicle["code"], reason: string) =>
      excluded.push({
        id: v.id,
        publicId: v.publicId,
        make: v.make,
        model: v.model,
        regNo: v.regNo,
        categoryName: v.category.name,
        code,
        reason,
      });

    const vehicles = fleet.filter((v) => {
      if (v.status !== VehicleStatus.AVAILABLE) {
        if (v.status === VehicleStatus.OUT_FOR_RENTAL) {
          if (outOnRental.has(v.id)) exclude(v, "STATUS_OUT_FOR_RENTAL", "Out on another rental");
          else exclude(v, "MANUAL_OUT_FOR_RENTAL", "Set Out for Rental by the branch manager");
        } else if (v.status === VehicleStatus.MAINTENANCE) exclude(v, "STATUS_MAINTENANCE", "In maintenance");
        else if (v.status === VehicleStatus.MANAGER_REPORTED) {
          exclude(v, "DAMAGE_REVIEW_PENDING", "Damage review pending with the branch manager");
        } else exclude(v, "STATUS_INACTIVE", "Inactive");
        return false;
      }
      if (v.insuranceExpiry.getTime() <= windowEnd.getTime()) {
        exclude(v, "INSURANCE_EXPIRES", `Insurance expires on ${formatIst(v.insuranceExpiry)}, before this rental ends`);
        return false;
      }
      if (v.category.rank < currentVehicle.category.rank) {
        exclude(v, "LOWER_CATEGORY", `Lower category (${v.category.name})`);
        return false;
      }
      if (outOnRental.has(v.id)) {
        exclude(v, "STILL_OUT", "Still out on another rental");
        return false;
      }
      return true;
    });

    // Bookings and checkout holds in the rest of the rental (the same checks as
    // getUnavailableVehicleIds, with the reason)
    const unavailable = await explainUnavailableVehicles(
      vehicles.map((v) => v.id),
      windowStart,
      windowEnd,
      new Map(vehicles.map((v) => [v.id, v.publicId])),
    );
    const free = vehicles.filter((v) => {
      const why = unavailable.get(v.id);
      if (!why) return true;
      if (why.code === "ON_HOLD") exclude(v, "ON_HOLD", "Being booked by a customer for part of this rental");
      else if (why.code === "BOOKED") {
        exclude(v, "BOOKED", `Booked ${formatIst(why.startAt)} – ${formatIst(why.endAt)}, during this rental`);
      } else exclude(v, "STILL_OUT", "Still out on another rental");
      return false;
    });
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
        remainingFrom: windowStart,
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
        },
        currentVehicleStartOdometer:
          stage === "ACTIVE_RENTAL" ? await this.segmentStartOdometer(booking) : null,
        pricingAvailable: originalTaxable !== null,
        pricingError,
        chargeDifferenceDefaults: CHARGE_DIFFERENCE_DEFAULTS,
      },
    };
  }

  /**
   * Extension SWAP_CURRENT_TO_OTHER entry point (positional signature kept for
   * extension-vehicle-allocator.service). The caller already holds the
   * extension vehicle locks; readings are optional and the difference is never
   * billed — the company moved the customer to free the original car.
   */
  async performVehicleSwap(
    bookingId: string,
    newVehicleId: number,
    swappedById: number,
    reason: SwapReason,
    reasonNotes?: string,
    markOriginalForMaintenance: boolean = false,
    originalVehicleNotes?: string,
    options: LegacySwapOptions = {},
  ): Promise<VehicleSwap> {
    return this.swapVehicle({
      bookingPublicId: bookingId,
      newVehicleId,
      swappedById,
      reason,
      reasonNotes,
      markOriginalForMaintenance,
      originalVehicleNotes,
      branchId: options.branchId,
      availabilityEndAt: options.availabilityEndAt,
      source: "EXTENSION",
    });
  }

  /**
   * Swap the booking's vehicle. Under the booking + vehicle row locks it
   * re-checks the booking and the replacement, moves the booking item, sets
   * both cars' statuses (and odometer / fuel from the readings), and writes the
   * VehicleSwap row with the readings and the price difference, plus an audit
   * log. Vehicle availability caches are cleared after commit.
   */
  async swapVehicle(input: SwapVehicleInput): Promise<VehicleSwapWithRelations> {
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
      select: { id: true, regNo: true, categoryId: true },
    });
    if (!replacement) {
      throw new VehicleSwapError(
        StatusCode.NOT_FOUND,
        "VEHICLE_NOT_FOUND",
        "Replacement vehicle not found in this branch",
      );
    }

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

    // Serialise with extension commits on either car (the extension path already holds them)
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
          "One of these vehicles is being processed by an extension right now. Try again in a moment.",
        );
      }
      if (acquired) lockedVehicleIds.push(...acquired.acquired);
    }

    let swap: VehicleSwapWithRelations;
    try {
      swap = await prisma.$transaction(
        async (tx) => {
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

          const windowStart = new Date(Math.max(now.getTime(), locked.startAt.getTime()));
          await this.assertReplacementValid(db, locked, lockedOriginal, newVehicle, windowStart, effectiveEndAt);

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

          await tx.bookingItem.update({
            where: { id: lockedItem.id },
            data: { vehicleId: newVehicle.id },
          });

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

          const created = await tx.vehicleSwap.create({
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
            },
            include: swapRelations,
          });

          const actor = await tx.user.findUnique({
            where: { id: input.swappedById },
            select: { name: true, role: true, branchId: true },
          });
          const differenceNote = priceDifference.gt(0)
            ? `; price difference ₹${priceDifference.toFixed(2)} ${chargeDifference ? "to be billed at drop" : "waived"}`
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
                `(${stage === "ACTIVE_RENTAL" ? "during the rental" : "before pickup"}) — reason: ${input.reason}${differenceNote}`,
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
              },
            },
            tx,
          );

          return created;
        },
        { maxWait: 5000, timeout: 15000 },
      );
    } finally {
      if (lockedVehicleIds.length > 0) {
        await extensionLockService.releaseMultipleLocks(lockedVehicleIds).catch((err) => {
          console.warn("[vehicle-swap] releasing extension locks failed:", err);
        });
      }
    }

    try {
      await invalidateVehicleAvailability(redis, [originalVehicle.id, replacement.id]);
      await invalidateGroupListingCache(redis as any);
    } catch (err) {
      console.warn("[vehicle-swap] cache invalidation failed (non-fatal):", err);
    }

    void notifyEvents.vehicleSwapped({ swapId: swap.id, actorUserId: input.swappedById });

    return swap;
  }

  /**
   * Get swap history for a booking (newest first)
   */
  async getSwapHistory(bookingId: number): Promise<VehicleSwapWithRelations[]> {
    return await prisma.vehicleSwap.findMany({
      where: { bookingId },
      include: swapRelations,
      orderBy: { swappedAt: 'desc' }
    });
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

    // Walk-in placeholder emails are never shown
    return swaps.map((swap) => ({
      ...swap,
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
   * type, AVAILABLE, not deleted, insurance valid past the end, rank ≥ the
   * current car, not out on any PICKED_UP booking, and no CONFIRMED/PICKED_UP
   * booking or checkout hold overlapping [windowStart, windowEnd).
   */
  private async assertReplacementValid(
    db: Db,
    booking: SwapBooking,
    original: SwapBooking["items"][number]["vehicle"],
    replacement: SwapBooking["items"][number]["vehicle"],
    windowStart: Date,
    windowEnd: Date,
  ): Promise<void> {
    const unavailable = (message: string) =>
      new VehicleSwapError(StatusCode.CONFLICT, "VEHICLE_NOT_AVAILABLE", message, {
        vehicleId: replacement.id,
        regNo: replacement.regNo,
      });

    if (replacement.branchId !== booking.branchId) {
      throw new VehicleSwapError(
        StatusCode.NOT_FOUND,
        "VEHICLE_NOT_FOUND",
        "Replacement vehicle not found in this branch",
      );
    }
    if (replacement.deletedAt) {
      throw unavailable(`${replacement.regNo} has been removed from the fleet.`);
    }
    if (replacement.status !== VehicleStatus.AVAILABLE) {
      throw unavailable(`${replacement.regNo} is not available right now (status: ${replacement.status}).`);
    }
    if (replacement.insuranceExpiry.getTime() <= windowEnd.getTime()) {
      throw unavailable(
        `${replacement.regNo}'s insurance expires on ${formatIst(replacement.insuranceExpiry)}, before this rental ends.`,
      );
    }
    if (replacement.category.typeClass !== original.category.typeClass) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "VEHICLE_TYPE_MISMATCH",
        `${replacement.regNo} is a different type of vehicle from ${original.regNo}.`,
      );
    }
    if (replacement.category.rank < original.category.rank) {
      throw new VehicleSwapError(
        StatusCode.BAD_REQUEST,
        "CATEGORY_DOWNGRADE",
        "Cannot swap to a lower category vehicle",
      );
    }

    const [outOnRental, overlapping] = await Promise.all([
      db.bookingItem.findFirst({
        where: {
          vehicleId: replacement.id,
          booking: { status: BookingStatus.PICKED_UP, id: { not: booking.id } },
        },
        select: { id: true },
      }),
      db.bookingItem.findFirst({
        where: {
          vehicleId: replacement.id,
          booking: {
            id: { not: booking.id },
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP] },
            startAt: { lt: windowEnd },
            endAt: { gt: windowStart },
          },
        },
        select: { id: true },
      }),
    ]);
    if (outOnRental) {
      throw unavailable(`${replacement.regNo} is still out on another rental.`);
    }
    if (overlapping) {
      throw unavailable(`${replacement.regNo} is booked for part of this rental period.`);
    }

    // Checkout holds live in Redis (falls back to the database check above if Redis is down)
    const held = await getUnavailableVehicleIds(
      [replacement.id],
      windowStart,
      windowEnd,
      new Map([[replacement.id, replacement.publicId]]),
    );
    if (held.has(replacement.id)) {
      throw unavailable(`${replacement.regNo} is being booked by a customer for part of this rental period.`);
    }
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
   * prices and the difference would be the undiscounted one.
   */
  private async taxableRental(booking: SwapBooking, vehicleId: number, categoryId: number): Promise<Decimal> {
    const result = await pricingEngine.calculateBookingPrice(
      vehicleId,
      DateTime.fromJSDate(booking.startAt),
      DateTime.fromJSDate(booking.endAt),
      booking.branchId,
      booking.customerId,
      booking.couponCode ?? undefined,
      undefined,
      undefined,
      categoryId,
      undefined,
      {
        paymentPlan: booking.isAdvancePayment ? "ADVANCE" : "FULL",
        excludeBookingId: booking.id,
        couponLockedIn: Boolean(booking.couponCode),
        // Booked as 12 hours held to closing (item 6): both cars billed as 12 h
        heldToClosing: heldToClosingOf(booking.pricingSnapshot),
      },
    );
    // finalTotal = the post-discount rent incl. GST (what the customer pays for it)
    return new Decimal(result.finalTotal.toString());
  }
}
