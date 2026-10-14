/**
 * The pickup / swap readings a drop is billed from — the odometer segments
 * (pickup odometer, swap readings) and the FASTag legs (pickup balance, swap
 * balances) — as one comparable string. The drop reads them before taking the
 * booking lock and compares again under it, so a reading corrected in between
 * (an edited pickup, a swap) is never billed from its old value. Pure.
 */
import type { OdometerSegments } from "./km-allowance.service.js";
import type { FastagLeg } from "./fastag-usage.js";

export type OdometerReadings = Pick<OdometerSegments, "complete" | "priorKm" | "currentStartOdometer" | "swapCount">;

export function dropReadingsSignature(segments: OdometerReadings | null, fastagLegs: FastagLeg[]): string {
  return JSON.stringify({
    km: segments
      ? [segments.complete, segments.priorKm, segments.currentStartOdometer, segments.swapCount]
      : null,
    fastag: fastagLegs.map((l) => [
      l.hasFastag,
      l.startBalance?.toFixed(2) ?? null,
      l.endBalance?.toFixed(2) ?? null,
      l.endedBySwapPublicId,
    ]),
  });
}

/** 409 body when the readings changed between reading them and taking the booking lock. */
export const DROP_READINGS_CHANGED = {
  code: "DROP_READINGS_CHANGED",
  message:
    "The pickup or swap readings (odometer / FASTag balance) changed while this drop was being worked out. Try again.",
} as const;
