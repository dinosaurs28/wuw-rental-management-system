// Shared rental-pricing display helpers.
// Mirrors the web VehicleCard typeMaps exactly so mobile labels match the site.
import type { RentalDuration } from '../types/api';

// Short PER-PERIOD unit suffix shown next to a per-period rate (e.g. "₹1,200 / day").
// Pair ONLY with a per-period rate (ListPricing.price / pricingBreakdown.applicablePrice),
// never with a duration total — for a total, label it "total" explicitly.
export function unitLabel(periodType?: string | null): string {
  switch (periodType) {
    case 'HOURLY':
      return '/ hr';
    case 'HALF_DAY':
      return '/ half day';
    case 'FULL_DAY':
      return '/ day';
    case 'MULTI_DAY':
      return '/ day'; // applicablePrice for a multi-day rental is the daily rate
    case 'MONTHLY':
      return '/ mo';
    default:
      return '/ day';
  }
}

// Human label for the rental period type (e.g. shown as a badge).
export function periodLabel(periodType?: string | null): string | null {
  switch (periodType) {
    case 'HOURLY':
      return 'Hourly';
    case 'HALF_DAY':
      return 'Half day';
    case 'FULL_DAY':
      return 'Full day';
    case 'MULTI_DAY':
      return 'Multi day';
    case 'MONTHLY':
      return 'Monthly';
    default:
      return null;
  }
}

// Concise real-duration string from the engine's RentalDuration object.
export function durationLabel(d?: RentalDuration | null): string | null {
  if (!d) return null;
  if (d.days >= 1) return `${d.days} day${d.days !== 1 ? 's' : ''}`;
  if (d.hours >= 1) return `${d.hours} hr${d.hours !== 1 ? 's' : ''}`;
  return null;
}
