/**
 * One reading of "a vehicle's insurance" for every screen (Nov 16 2026).
 *
 * The branch manager form writes Vehicle.insuranceExpiry and appends a
 * VehicleInsurance row on every change. Admin reports used to take the row with
 * the LATEST validTill, so after a BM corrected an expiry to an earlier date
 * (or a typo'd year) admin kept showing the old, wrong date, provider and
 * policy, while the BM portal showed the saved one.
 *
 * Rules now:
 *  - expiry = Vehicle.insuranceExpiry (what the BM saved, and what booking
 *    eligibility already uses);
 *  - policy number / provider = the most recently written VehicleInsurance row
 *    (highest id), never the one with the furthest date.
 */
import type { Prisma } from "@repo/database/client";

/** orderBy for `insuranceRecords` — newest written row first. */
export const CURRENT_INSURANCE_ORDER: Prisma.VehicleInsuranceOrderByWithRelationInput[] = [{ id: "desc" }];

export interface InsuranceRecordLike {
  policyNumber: string;
  provider: string;
  validTill?: Date | null;
}

export interface CurrentInsurance {
  expiry: Date | null;
  policyNumber: string | null;
  provider: string | null;
}

/** `latestRecord` must come from a query ordered by CURRENT_INSURANCE_ORDER. */
export function currentInsurance(
  vehicle: { insuranceExpiry: Date | null },
  latestRecord: InsuranceRecordLike | null | undefined,
): CurrentInsurance {
  return {
    expiry: vehicle.insuranceExpiry ?? latestRecord?.validTill ?? null,
    policyNumber: latestRecord?.policyNumber ?? null,
    provider: latestRecord?.provider ?? null,
  };
}

/** Pick the newest-written record from an unordered list (highest id). */
export function newestRecord<T extends { id: number }>(records: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of records) if (!best || r.id > best.id) best = r;
  return best;
}
