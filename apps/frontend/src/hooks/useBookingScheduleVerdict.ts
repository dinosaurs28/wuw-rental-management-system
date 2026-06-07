import { useMemo } from "react";
import {
  validateBookingSchedule,
  type ScheduleVerdict,
} from "@/utils/branchScheduleValidator";
import type { BranchScheduleConfig } from "@/services/branch.service";

/**
 * Computes the schedule verdict for a pickup+return pair against the branch
 * operating hours. Returns the verdict and, when a bump is needed,
 * `adjustedEndDateTime` as an ISO string that callers should write back to
 * their booking store.
 */
export function useBookingScheduleVerdict(
  schedule: BranchScheduleConfig | undefined,
  startDateTime: string | undefined,
  endDateTime: string | undefined,
): {
  verdict: ScheduleVerdict | null;
  adjustedEndDateTime: string | undefined;
} {
  return useMemo(() => {
    if (!schedule || !startDateTime || !endDateTime) {
      return { verdict: null, adjustedEndDateTime: undefined };
    }

    const pickup = new Date(startDateTime);
    const ret = new Date(endDateTime);

    if (isNaN(pickup.getTime()) || isNaN(ret.getTime())) {
      return { verdict: null, adjustedEndDateTime: undefined };
    }

    const verdict = validateBookingSchedule(schedule, pickup, ret);

    const adjustedEndDateTime =
      verdict.status === "RETURN_BUMPED" && verdict.adjustedReturn
        ? verdict.adjustedReturn.toISOString()
        : verdict.status === "OK" || verdict.status === "RETURN_GRACE"
        ? endDateTime
        : undefined;

    return { verdict, adjustedEndDateTime };
  }, [schedule, startDateTime, endDateTime]);
}
