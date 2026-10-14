/**
 * FASTag usage billed at the drop (Oct 15 2026 client item) — the pure rules,
 * no database.
 *
 * Staff read the FASTag balance when the customer gets a car (pickup, or a
 * mid-rental swap's replacement) and when the car comes back (a swap's
 * returning car, or the drop). The customer is charged what the tags were
 * used for, summed over the cars they had:
 *
 *   no swap:   pickup balance − balance at the drop
 *   swapped:   (car A at pickup − car A at the swap) + (car B at the swap − car B at the drop) …
 *
 * A leg whose balance went UP (the tag was recharged) counts as ₹0, with a note.
 * A car without a FASTag adds nothing. When a car with a FASTag is missing a
 * reading (older bookings, legacy pickups, swaps or drops on older app
 * builds) the usage can't be measured: the whole booking falls back to the
 * FASTag charge staff type by hand, as before. No GST (item 8).
 */
import Decimal from "decimal.js";
import { z } from "zod";
import { FASTAG_BALANCE_MAX } from "@repo/schemas";

/**
 * Request field for a FASTag balance (₹): 0 … 1,00,000 with at most 2 decimals;
 * absent / '' / null = not sent (older app builds). Same rule as the shared
 * fastagBalanceSchema, on the backend's zod.
 */
export const fastagBalanceField = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.coerce
    .number({ message: "FASTag balance must be an amount" })
    .min(0, "FASTag balance can't be negative")
    .max(FASTAG_BALANCE_MAX, "FASTag balance looks too large — check the figure")
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "FASTag balance can have at most 2 decimals")
    .optional(),
);

/**
 * A car counts as a FASTag car for this booking when it is marked as having a
 * FASTag, or when a FASTag balance was recorded for it on the booking (at pickup,
 * or at a swap) — many cars carry a tag the fleet record doesn't show yet. A
 * drop reading alone doesn't make a car count (nothing to measure it against).
 */
export function countsAsFastagCar(
  vehicleHasFastag: boolean,
  recordedBalances: Array<Decimal | number | string | null | undefined>,
): boolean {
  return vehicleHasFastag || recordedBalances.some((b) => b != null);
}

/** One car the customer had, from when they got it to when it came back. */
export interface FastagLeg {
  regNo: string | null;
  /**
   * The car counts as a FASTag car for this booking (countsAsFastagCar) — no
   * tag = no tolls on it, never a missing reading.
   */
  hasFastag: boolean;
  /** The car is marked as having a FASTag (Vehicle.hasFastag) — its readings are required. */
  vehicleHasFastag?: boolean;
  /** Balance when the customer got the car: the pickup's, or a swap's replacement reading. */
  startBalance: Decimal | null;
  /** Balance when the car came back: a swap's returning-car reading, or the drop's. */
  endBalance: Decimal | null;
  /** VehicleSwap.publicId that ended this leg (null = the car handed back at the drop). */
  endedBySwapPublicId: string | null;
}

interface FastagVehicleRef {
  regNo: string;
  hasFastag: boolean;
}

/**
 * Legs from a booking's readings, oldest first: the pickup car from the pickup
 * balance, each mid-rental swap's returning-car / replacement balances, and the
 * car handed back at the drop ending at `dropBalance`. Each car counts as a
 * FASTag car by countsAsFastagCar (marked, or a balance recorded for it).
 */
export function buildFastagLegs(input: {
  pickupBalance: Decimal | null;
  /** The booking's car now (used when there was no mid-rental swap) */
  currentVehicle: FastagVehicleRef | null;
  midRentalSwaps: Array<{
    publicId: string;
    originalVehicle: FastagVehicleRef;
    newVehicle: FastagVehicleRef;
    oldVehicleFastagBalance: Decimal | null;
    newVehicleFastagBalance: Decimal | null;
  }>;
  dropBalance: Decimal | null;
}): FastagLeg[] {
  const { pickupBalance, currentVehicle, midRentalSwaps, dropBalance } = input;
  if (midRentalSwaps.length === 0) {
    return [{
      regNo: currentVehicle?.regNo ?? null,
      hasFastag: countsAsFastagCar(currentVehicle?.hasFastag ?? false, [pickupBalance]),
      vehicleHasFastag: currentVehicle?.hasFastag ?? false,
      startBalance: pickupBalance,
      endBalance: dropBalance,
      endedBySwapPublicId: null,
    }];
  }
  const legs: FastagLeg[] = [];
  let start = pickupBalance;
  for (const swap of midRentalSwaps) {
    legs.push({
      regNo: swap.originalVehicle.regNo,
      hasFastag: countsAsFastagCar(swap.originalVehicle.hasFastag, [start, swap.oldVehicleFastagBalance]),
      vehicleHasFastag: swap.originalVehicle.hasFastag,
      startBalance: start,
      endBalance: swap.oldVehicleFastagBalance,
      endedBySwapPublicId: swap.publicId,
    });
    start = swap.newVehicleFastagBalance;
  }
  const last = midRentalSwaps[midRentalSwaps.length - 1]!;
  legs.push({
    regNo: last.newVehicle.regNo,
    hasFastag: countsAsFastagCar(last.newVehicle.hasFastag, [start]),
    vehicleHasFastag: last.newVehicle.hasFastag,
    startBalance: start,
    endBalance: dropBalance,
    endedBySwapPublicId: null,
  });
  return legs;
}

export interface FastagLegUsage extends FastagLeg {
  /** max(0, start − end); null when a reading is missing or the car has no FASTag */
  usage: Decimal | null;
  /** The balance went up (tag recharged) — that leg is not charged. */
  recharged: boolean;
}

/**
 * COMPUTED         every car with a FASTag has both readings — `amount` is billed
 * READINGS_MISSING a car with a FASTag lacks a reading — staff type the charge by hand
 * NO_FASTAG        none of the cars has a FASTag
 */
export type FastagUsageStatus = "COMPUTED" | "READINGS_MISSING" | "NO_FASTAG";

export interface FastagUsage {
  status: FastagUsageStatus;
  /** Σ leg usage (COMPUTED); 0 otherwise */
  amount: Decimal;
  legs: FastagLegUsage[];
  recharged: boolean;
  /** Drop bill line label with the readings, e.g. "FASTag usage: ₹480 → ₹215" (COMPUTED only) */
  label: string | null;
  notes: string[];
}

export const FASTAG_RECHARGED_NOTE = "FASTag balance went up (recharged?) — no charge for that part";

const ZERO = new Decimal(0);

/** ₹480 / ₹480.50 */
export function fastagRupees(d: Decimal): string {
  return `₹${d.isInteger() ? d.toFixed(0) : d.toFixed(2)}`;
}

function legReadings(leg: FastagLeg): string {
  return `${fastagRupees(leg.startBalance!)} → ${fastagRupees(leg.endBalance!)}`;
}

export function calculateFastagUsage(legs: FastagLeg[]): FastagUsage {
  const tagged = legs.filter((l) => l.hasFastag);
  const measured: FastagLegUsage[] = legs.map((leg) => {
    if (!leg.hasFastag || leg.startBalance == null || leg.endBalance == null) {
      return { ...leg, usage: null, recharged: false };
    }
    const diff = leg.startBalance.minus(leg.endBalance);
    return { ...leg, usage: Decimal.max(ZERO, diff), recharged: diff.lt(0) };
  });

  if (tagged.length === 0) {
    return { status: "NO_FASTAG", amount: ZERO, legs: measured, recharged: false, label: null, notes: [] };
  }
  if (tagged.some((l) => l.startBalance == null || l.endBalance == null)) {
    return { status: "READINGS_MISSING", amount: ZERO, legs: measured, recharged: false, label: null, notes: [] };
  }

  const taggedUsage = measured.filter((l) => l.hasFastag);
  const amount = taggedUsage.reduce((s, l) => s.plus(l.usage ?? ZERO), ZERO).toDecimalPlaces(2);
  const recharged = taggedUsage.some((l) => l.recharged);
  const label =
    taggedUsage.length === 1
      ? `FASTag usage: ${legReadings(taggedUsage[0]!)}`
      : `FASTag usage: ${taggedUsage.map((l) => `${l.regNo ?? "car"} ${legReadings(l)}`).join(", ")}`;
  return {
    status: "COMPUTED",
    amount,
    legs: measured,
    recharged,
    label,
    notes: recharged ? [FASTAG_RECHARGED_NOTE] : [],
  };
}

/**
 * How the drop handles FASTag before the drop reading exists — for the drop
 * screens and the compute:
 *  - READINGS  every reading so far is there: the drop bill works the charge out
 *              (staff enter the balance now when the car coming back has a FASTag)
 *  - MANUAL    a car with a FASTag lacks a reading: staff type the charge, as before
 *  - NONE      no car on the booking has a FASTag
 */
export type FastagDropMode = "READINGS" | "MANUAL" | "NONE";

export interface FastagBeforeDrop {
  mode: FastagDropMode;
  /** The car coming back has a FASTag. */
  currentHasFastag: boolean;
  /** Its balance when the customer got it (pickup, or the last swap's replacement reading). */
  currentStartBalance: Decimal | null;
  /** Usage on the cars already handed back (READINGS only, else 0). */
  priorUsage: Decimal;
  /** Readings so far show a recharge on a car already handed back. */
  priorRecharged: boolean;
  /** Mid-rental swaps (legs − 1). */
  swapCount: number;
}

/** `legs` as loaded before the drop (the last leg's endBalance is ignored). */
export function fastagBeforeDrop(legs: FastagLeg[]): FastagBeforeDrop {
  const current = legs[legs.length - 1] ?? null;
  const finished = legs.slice(0, -1);
  const tagged = legs.filter((l) => l.hasFastag);
  const base = {
    currentHasFastag: current?.hasFastag ?? false,
    currentStartBalance: current?.hasFastag ? current.startBalance : null,
    swapCount: Math.max(0, legs.length - 1),
  };
  if (tagged.length === 0) {
    return { ...base, mode: "NONE", priorUsage: ZERO, priorRecharged: false };
  }
  const complete =
    tagged.every((l) => l.startBalance != null) &&
    finished.every((l) => !l.hasFastag || l.endBalance != null);
  if (!complete) {
    return { ...base, mode: "MANUAL", priorUsage: ZERO, priorRecharged: false };
  }
  const prior = calculateFastagUsage(finished);
  return {
    ...base,
    mode: "READINGS",
    priorUsage: prior.status === "COMPUTED" ? prior.amount : ZERO,
    priorRecharged: prior.recharged,
  };
}

/** JSON shape for clients and RETURN session metadata (Decimals as strings). */
export function serializeFastagUsage(usage: FastagUsage) {
  return {
    status: usage.status,
    amount: usage.amount.toFixed(2),
    label: usage.label,
    recharged: usage.recharged,
    notes: usage.notes,
    legs: usage.legs.map((l) => ({
      regNo: l.regNo,
      hasFastag: l.hasFastag,
      startBalance: l.startBalance?.toFixed(2) ?? null,
      endBalance: l.endBalance?.toFixed(2) ?? null,
      endedBySwapPublicId: l.endedBySwapPublicId,
      usage: l.usage?.toFixed(2) ?? null,
      recharged: l.recharged,
    })),
  };
}

export type SerializedFastagUsage = ReturnType<typeof serializeFastagUsage>;

/**
 * True when a computed drop bill's FASTag readings no longer match the booking
 * — the pickup balance was entered or corrected after the bill was computed.
 * `billFastag` is RETURN session metadata.fastag; bills computed before FASTag
 * readings existed have none and are never stale for this.
 */
export function fastagBillStale(
  billFastag: unknown,
  pickupFastagBalance: { toString(): string } | null,
): boolean {
  if (!billFastag || typeof billFastag !== "object") return false;
  const recorded = (billFastag as { pickupBalance?: string | null }).pickupBalance;
  if (recorded === undefined) return false;
  const current = pickupFastagBalance == null ? null : new Decimal(pickupFastagBalance.toString()).toFixed(2);
  return (recorded ?? null) !== current;
}

export function serializeFastagBeforeDrop(s: FastagBeforeDrop) {
  return {
    mode: s.mode,
    currentHasFastag: s.currentHasFastag,
    currentStartBalance: s.currentStartBalance?.toFixed(2) ?? null,
    priorUsage: s.priorUsage.toFixed(2),
    priorRecharged: s.priorRecharged,
    swapCount: s.swapCount,
  };
}
