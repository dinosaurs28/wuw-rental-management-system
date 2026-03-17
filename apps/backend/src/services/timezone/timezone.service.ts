import { DateTime, Settings } from "luxon";

/**
 * System timezone configuration
 * IST = Indian Standard Time = UTC+5:30
 */
export const SYSTEM_TIMEZONE = "Asia/Kolkata";

/**
 * Configure Luxon default timezone
 * This ensures all DateTime operations use IST by default
 */
Settings.defaultZone = SYSTEM_TIMEZONE;

export class TimezoneService {
  /**
   * Get current time in IST
   *
   * @returns DateTime object in IST
   */
  static getCurrentTime(): DateTime {
    return DateTime.now().setZone(SYSTEM_TIMEZONE);
  }

  /**
   * Parse user-provided date and time into IST DateTime
   */
  static parseUserDateTime(dateStr: string, timeStr: string): DateTime {
    const isoString = `${dateStr}T${timeStr}:00`;
    return DateTime.fromISO(isoString, { zone: SYSTEM_TIMEZONE });
  }

  /**
   * Parse ISO string into IST DateTime
   */
  static parseISO(isoString: string): DateTime {
    return DateTime.fromISO(isoString, { zone: SYSTEM_TIMEZONE });
  }

  /**
   * Convert JavaScript Date object to IST DateTime
   */
  static fromJSDate(date: Date): DateTime {
    return DateTime.fromJSDate(date, { zone: SYSTEM_TIMEZONE });
  }

  /**
   * Convert Prisma DateTime (Date) to Luxon DateTime in IST
   */
  static fromPrisma(prismaDate: Date): DateTime {
    return DateTime.fromJSDate(prismaDate, { zone: SYSTEM_TIMEZONE });
  }

  /**
   * Convert DateTime to JavaScript Date for Prisma storage
   */
  static toPrisma(dt: DateTime): Date {
    return dt.toJSDate();
  }

  /**
   * Format DateTime for display to users
   */
  static formatForDisplay(
    dt: DateTime,
    format: "full" | "date" | "time" | "datetime" = "full",
  ): string {
    const istDt = dt.setZone(SYSTEM_TIMEZONE);

    switch (format) {
      case "full":
        return istDt.toFormat("dd MMM yyyy, hh:mm a"); // "08 Mar 2026, 02:30 PM"
      case "date":
        return istDt.toFormat("dd MMM yyyy"); // "08 Mar 2026"
      case "time":
        return istDt.toFormat("hh:mm a"); // "02:30 PM"
      case "datetime":
        return istDt.toFormat("dd/MM/yyyy hh:mm a"); // "08/03/2026 02:30 PM"
      default:
        return istDt.toFormat("dd MMM yyyy, hh:mm a");
    }
  }

  /**
   * Format DateTime for API responses (ISO format with timezone)
   */
  static formatForAPI(dt: DateTime): string {
    return dt.setZone(SYSTEM_TIMEZONE).toISO() as string;
  }

  /**
   * Format DateTime for database queries
   * Uses SQL-friendly format without timezone
   */
  static formatForSQL(dt: DateTime): string {
    return dt.setZone(SYSTEM_TIMEZONE).toFormat("yyyy-MM-dd HH:mm:ss");
  }

  /**
   * Get start of day in IST (00:00:00)
   */
  static startOfDay(date?: DateTime): DateTime {
    const dt = date || this.getCurrentTime();
    return dt.setZone(SYSTEM_TIMEZONE).startOf("day");
  }

  /**
   * Get end of day in IST (23:59:59.999)
   */
  static endOfDay(date?: DateTime): DateTime {
    const dt = date || this.getCurrentTime();
    return dt.setZone(SYSTEM_TIMEZONE).endOf("day");
  }

  /**
   * Check if a datetime is within business hours
   * Business hours: 6:00 AM - 10:00 PM IST
   */
  static isWithinBusinessHours(dt: DateTime): boolean {
    const istDt = dt.setZone(SYSTEM_TIMEZONE);
    const hour = istDt.hour;
    return hour >= 6 && hour < 22; // 6 AM to 10 PM
  }

  /**
   * Get next business day opening time (6:00 AM IST)
   */
  static getNextBusinessDayOpening(fromDate?: DateTime): DateTime {
    const dt = fromDate || this.getCurrentTime();
    const istDt = dt.setZone(SYSTEM_TIMEZONE);

    // If before 6 AM, return today at 6 AM
    if (istDt.hour < 6) {
      return istDt.set({ hour: 6, minute: 0, second: 0, millisecond: 0 });
    }

    // Otherwise, return tomorrow at 6 AM
    return istDt
      .plus({ days: 1 })
      .set({ hour: 6, minute: 0, second: 0, millisecond: 0 });
  }

  /**
   * Add duration to a datetime
   */
  static addDuration(
    dt: DateTime,
    duration: { hours?: number; days?: number; minutes?: number },
  ): DateTime {
    return dt.setZone(SYSTEM_TIMEZONE).plus(duration);
  }

  /**
   * Calculate difference between two datetimes in hours
   */
  static diffInHours(start: DateTime, end: DateTime): number {
    return end.diff(start, "hours").hours;
  }

  /**
   * Calculate difference between two datetimes in days
   */
  static diffInDays(start: DateTime, end: DateTime): number {
    return end.diff(start, "days").days;
  }

  /**
   * Validate if a datetime string is valid
   */
  static isValid(dateStr: string, timeStr: string): boolean {
    const dt = this.parseUserDateTime(dateStr, timeStr);
    return dt.isValid;
  }

  /**
   * Get timezone offset string
   */
  static getTimezoneOffset(): string {
    const dt = this.getCurrentTime();
    return dt.toFormat("ZZ"); // Returns "+05:30"
  }

  /**
   * Get timezone abbreviation
   */
  static getTimezoneAbbr(): string {
    const dt = this.getCurrentTime();
    return dt.toFormat("ZZZZ"); // Returns "IST"
  }
}

export default TimezoneService;
