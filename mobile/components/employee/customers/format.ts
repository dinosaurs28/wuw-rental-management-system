// Display helpers for the Customers tab — same labels as the branch manager's
// web page (apps/frontend/src/pages/manager/CustomerDetailPage.tsx).
import type { BadgeTone } from '../../ui/StatusBadge';
import type { RentBucket, RentRow } from '../../../types/customers';

/** "₹1,416.00" — the server sends 2-dp strings. */
export function inr(val: string | number | null | undefined): string {
  return `₹${Number(val ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const isPositive = (val: string | number | null | undefined) => Number(val ?? 0) > 0;

/** Booking / credit reference as staff read it: last 8 of the publicId. */
export const shortRef = (publicId: string) => `#${publicId.slice(-8).toUpperCase()}`;

export const humanize = (s: string) => s.replace(/_/g, ' ');

export const methodLabel = (m: string) =>
  m === 'CASH' ? 'Cash' : m === 'ONLINE' ? 'Online' : m === 'SPLIT' ? 'Split' : humanize(m);

export const RENT_BUCKETS: { key: RentBucket; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'active', label: 'Active' },
  { key: 'past', label: 'Past' },
];

export const RENT_EMPTY_TEXT: Record<RentBucket, string> = {
  upcoming: 'No upcoming rents.',
  active: 'No vehicle is currently out with this customer.',
  past: 'No past rents.',
};

export function rentStatus(r: RentRow): { label: string; tone: BadgeTone } {
  if (r.isOverdue) return { label: 'Overdue', tone: 'bad' };
  if (r.awaitingPayment) return { label: 'Awaiting payment', tone: 'warn' };
  if (r.status === 'PICKED_UP') return { label: 'Picked up', tone: 'good' };
  if (r.status === 'CONFIRMED') return { label: 'Confirmed', tone: 'info' };
  return { label: humanize(r.status), tone: 'neutral' };
}

export const vehicleLine = (vehicles: { make: string; model: string }[]) =>
  vehicles.map((v) => `${v.make} ${v.model}`).join(', ') || 'Vehicle';
