import { useMemo } from "react";
import {
  validateBookingSchedule,
  type ScheduleVerdict,
} from "@/utils/branchScheduleValidator";
import { maxReturnFor } from "@/utils/bookingPickers";
import type { BranchScheduleConfig } from "@/services/branch.service";

/**
 * Computes the schedule verdict for a pickup+return pair against the branch
 * operating hours. Returns the verdict and, when a bump is needed,
 * `adjustedEndDateTime` as an ISO string that callers should write back to
 * their booking store.
 *
 * An adjusted return that would pass the 15-day limit (or 180 days on the
 * monthly plan) is not offered — the server refuses it with
 * BOOKING_MAX_PERIOD_EXCEEDED — so the verdict becomes RETURN_OUTSIDE_HOURS
 * and the caller asks for an earlier return instead.
 */
export function useBookingScheduleVerdict(
  schedule: BranchScheduleConfig | undefined,
  startDateTime: string | undefined,
  endDateTime: string | undefined,
  opts: { monthly?: boolean } = {},
): {
  verdict: ScheduleVerdict | null;
  adjustedEndDateTime: string | undefined;
} {
  const monthly = !!opts.monthly;
  return useMemo(() => {
    if (!schedule || !startDateTime || !endDateTime) {
      return { verdict: null, adjustedEndDateTime: undefined };
    }

    const pickup = new Date(startDateTime);
    const ret = new Date(endDateTime);

    if (isNaN(pickup.getTime()) || isNaN(ret.getTime())) {
      return { verdict: null, adjustedEndDateTime: undefined };
    }

    let verdict = validateBookingSchedule(schedule, pickup, ret);
    if (
      verdict.status === "RETURN_BUMPED" &&
      verdict.adjustedReturn &&
      verdict.adjustedReturn > maxReturnFor(pickup, { monthly })
    ) {
      verdict = { ...verdict, status: "RETURN_OUTSIDE_HOURS", adjustedReturn: undefined };
    }

    const adjustedEndDateTime =
      verdict.status === "RETURN_BUMPED" && verdict.adjustedReturn
        ? verdict.adjustedReturn.toISOString()
        : verdict.status === "OK" || verdict.status === "RETURN_GRACE"
        ? endDateTime
        : undefined;

    return { verdict, adjustedEndDateTime };
  }, [schedule, startDateTime, endDateTime, monthly]);
}
