import { DateTime, Interval } from "luxon";

/**
 * Rental period types
 */
export enum RentalPeriodType {
  HOURLY = "HOURLY",
  HALF_DAY = "HALF_DAY", // 12 hours
  FULL_DAY = "FULL_DAY", // 24 hours
  MULTI_DAY = "MULTI_DAY", // 2+ days
  MONTHLY = "MONTHLY", // 30 days
}

/**
 * Rental duration details
 */
export interface RentalDuration {
  periodType: RentalPeriodType;
  hours: number; // Actual hours (rounded up)
  days: number; // Actual days (rounded up)
  actualDuration: number; // Precise hours (decimal)
  billableDuration: number; // Hours to bill for (rounded up)
}

/**
 * Service for calculating rental durations
 */
export class DurationCalculatorService {
  /**
   * Calculate rental duration based on start and end times
   *
   * Key Rules:
   * - Up to 12 hours = HALF_DAY (charge for 12 hours)
   * - 12-24 hours = FULL_DAY (charge for 24 hours)
   * - 24+ hours = MULTI_DAY (round up partial days)
   * - 30+ days = MONTHLY (special monthly rate)
   *
   * Examples:
   * - 5:00 PM to 5:00 AM next day = 12 hours = HALF_DAY
   * - 9 March 5:00 PM to 10 March 5:00 PM = 24 hours = FULL_DAY (NOT 2 days!)
   * - 9 March 5:00 PM to 11 March 10:00 AM = 41.5 hours = 2 days = MULTI_DAY
   *
   * @param startAt - Rental start datetime (IST)
   * @param endAt - Rental end datetime (IST)
   * @returns RentalDuration object with all details
   */
  static calculate(startAt: DateTime, endAt: DateTime): RentalDuration {
    // Validate inputs
    if (!startAt.isValid) {
      throw new Error("Invalid start datetime");
    }
    if (!endAt.isValid) {
      throw new Error("Invalid end datetime");
    }
    if (endAt <= startAt) {
      throw new Error("End time must be after start time");
    }

    // Calculate actual duration in hours
    const interval = Interval.fromDateTimes(startAt, endAt);
    const actualHours = interval.length("hours");

    let periodType: RentalPeriodType;
    let billableDuration: number;

    if (actualHours <= 1) {
      // Very short rentals - minimum 1 hour
      periodType = RentalPeriodType.HOURLY;
      billableDuration = 1;
    } else if (actualHours <= 12) {
      // Up to 12 hours - charge for 12 hours
      periodType = RentalPeriodType.HALF_DAY;
      billableDuration = 12;
    } else if (actualHours <= 24) {
      // 12-24 hours - charge for full day (24 hours)
      // This handles the "5PM to 5PM = 1 day" requirement
      periodType = RentalPeriodType.FULL_DAY;
      billableDuration = 24;
    } else if (actualHours <= 720) {
      // Multi-day rental — determine billable hours using the same half-day rule
      // as PricingEngineService.determineBasePrice:
      //   remainder = 0          → exact full days
      //   remainder 1–12 hrs     → add a half day (12 hr slab)
      //   remainder 13–24 hrs    → round up to full day
      const fullDays = Math.floor(actualHours / 24);
      const remainingHours = actualHours % 24;

      let billableHours: number;
      if (remainingHours <= 0) {
        billableHours = fullDays * 24;
      } else if (remainingHours <= 12) {
        billableHours = fullDays * 24 + 12;
      } else {
        billableHours = (fullDays + 1) * 24;
      }

      // Cap at monthly (720 hr) and classify accordingly
      if (billableHours >= 720) {
        periodType = RentalPeriodType.MONTHLY;
        billableDuration = 720;
      } else {
        periodType = RentalPeriodType.MULTI_DAY;
        billableDuration = billableHours;
      }
    } else {
      // More than 30 days - charge monthly rate
      periodType = RentalPeriodType.MONTHLY;
      billableDuration = 720; // 30 days
    }

    return {
      periodType,
      hours: Math.ceil(actualHours),
      days: Math.ceil(actualHours / 24),
      actualDuration: actualHours,
      billableDuration,
    };
  }

  /**
   * Calculate extra hours beyond expected return time
   * Includes 15-minute grace period
   *
   * @param expectedReturnTime - Expected return datetime
   * @param actualReturnTime - Actual return datetime
   * @returns Number of extra hours to charge (0 if within grace period)
   */
  static calculateExtraHours(
    expectedReturnTime: DateTime,
    actualReturnTime: DateTime,
  ): number {
    const GRACE_PERIOD_MINUTES = 15;

    const interval = Interval.fromDateTimes(
      expectedReturnTime,
      actualReturnTime,
    );
    const delayMinutes = interval.length("minutes");

    // If within grace period, no extra charge
    if (delayMinutes <= GRACE_PERIOD_MINUTES) {
      return 0;
    }

    // Calculate extra hours (round up to nearest hour)
    const extraMinutes = delayMinutes - GRACE_PERIOD_MINUTES;
    return Math.ceil(extraMinutes / 60);
  }

  /**
   * Get human-readable description of rental period
   *
   * @param duration - RentalDuration object
   * @returns Human-readable string
   */
  static getDescription(duration: RentalDuration): string {
    switch (duration.periodType) {
      case RentalPeriodType.HOURLY:
        return `${duration.hours} hour${duration.hours > 1 ? "s" : ""}`;
      case RentalPeriodType.HALF_DAY:
        return "12 hours";
      case RentalPeriodType.FULL_DAY:
        return "1 day (24 hours)";
      case RentalPeriodType.MULTI_DAY:
        return `${duration.days} days`;
      case RentalPeriodType.MONTHLY:
        return "1 month (30 days)";
      default:
        return "Unknown period";
    }
  }
}

export default DurationCalculatorService;
