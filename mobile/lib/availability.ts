// Availability semantics shared by cards, vehicle detail, and trip status.
// Driven by the real `availableCount` the list/group endpoints return.
import { Colors } from '../constants/colors';

export type AvailabilityLevel = 'good' | 'low' | 'none';

export function availabilityLevel(count?: number | null): AvailabilityLevel {
  if (count == null || count <= 0) return 'none';
  if (count <= 2) return 'low';
  return 'good';
}

export function availabilityColor(count?: number | null): string {
  switch (availabilityLevel(count)) {
    case 'good':
      return Colors.availGood;
    case 'low':
      return Colors.availLow;
    default:
      return Colors.availNone;
  }
}

// Short human label, e.g. "4 available", "2 left", "Sold out".
export function availabilityLabel(count?: number | null): string | null {
  if (count == null) return null;
  if (count <= 0) return 'Sold out';
  if (count <= 2) return `${count} left`;
  return `${count} available`;
}
