// Shared rental-pricing display helpers.
// Mirrors the web VehicleCard typeMaps exactly so mobile labels match the site.
import type { RentalDuration } from '../types/api';
import { rentalLengthLabel } from './dates';

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
    case 'MONTHLY':
      // The API's price for these is the TOTAL for the whole period (listing
      // price / applicablePrice), never a per-day or per-month rate (#5).
      return 'total';
    default:
      return '/ day';
  }
}

// Suffix for a listed period price: what it covers when the server says
// ("for 12 hours", "for 1 day + 2 hours" — #5), else the period-type unit.
export function priceUnitFor(info?: { billedAs?: string | null; type?: string | null } | null): string {
  if (info?.billedAs) return `for ${info.billedAs}`;
  return unitLabel(info?.type);
}

// Badge for a listed price: the billed length ("12 hours", "1 day") when the
// server sends it, else the period type ("Half day").
export function billedBadge(info?: { billedAs?: string | null; type?: string | null } | null): string | null {
  return info?.billedAs ?? periodLabel(info?.type);
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

// Concise real-duration string from the engine's RentalDuration object:
// "3 hours" under a day, otherwise "1 day" / "2 days". The engine's `hours`
// is already rounded up, and ceil(hours / 24) equals its `days`.
export function durationLabel(d?: RentalDuration | null): string | null {
  if (!d) return null;
  return rentalLengthLabel(d.hours);
}
