import { router, type Href } from 'expo-router';
import { employeeApi, userApi } from './api';
import { fmtIstDateTime } from './dates';
import { queryClient } from './query-client';
import type { BookingTrip } from '../types/api';
import type { NotificationAudience, NotificationData } from '../types/notifications';

/**
 * In-app notifications (#19): who reads which inbox, where a notification
 * leads, and how its time reads. Shared by the notifications screens and the
 * push-tap handler in the root layout.
 */

/** Fleet Executives (STAFF) read the employee inbox; everyone else the customer one. */
export function notificationAudienceFor(role?: string | null): NotificationAudience {
  return role === 'STAFF' ? 'STAFF' : 'CUSTOMER';
}

/**
 * The inbox screen for a role. STAFF's lives under app/employee/ because the
 * root layout sends STAFF away from every non-employee route.
 */
export function notificationsScreenHref(audience: NotificationAudience): Href {
  return (audience === 'STAFF' ? '/employee/notifications' : '/notifications') as Href;
}

/** React Query key prefix — invalidating it refreshes every badge and list. */
export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const;

/** Badge text, capped at 9+; undefined when there is nothing unread. */
export function unreadBadgeLabel(count: number | undefined): string | undefined {
  if (!count || count <= 0) return undefined;
  return count > 9 ? '9+' : String(count);
}

/** "Just now", "5 min ago", "3 h ago", "2 d ago", then the IST date and time. */
export function notificationTimeLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const minutes = Math.floor((Date.now() - t) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return fmtIstDateTime(iso);
}

// ── Deep links ──────────────────────────────────────────────────────────────

// Same lookup as the trip screen: the customer booking list is the only
// customer booking read, newest first, so a recent booking is on page one.
async function findCustomerTrip(bookingPublicId: string): Promise<BookingTrip | null> {
  for (let page = 1; page <= 5; page++) {
    const res = await userApi.bookings(page, 50);
    const body = res.data as { data?: BookingTrip[]; meta?: { page: number; totalPages: number } };
    const hit = (body.data ?? []).find((b) => b.bookingId === bookingPublicId);
    if (hit) return hit;
    if (!body.meta || body.meta.page >= body.meta.totalPages) break;
  }
  return null;
}

async function openForCustomer(data: NotificationData): Promise<boolean> {
  const bookingPublicId = data.bookingPublicId;
  if (!bookingPublicId) return false;

  let trip: BookingTrip | null = null;
  try {
    // Seeds the trip screen's own ['trip', id] query with the same shape.
    trip = await queryClient.fetchQuery({
      queryKey: ['trip', bookingPublicId],
      queryFn: () => findCustomerTrip(bookingPublicId),
      staleTime: 0,
    });
  } catch {
    trip = null;
  }

  if (!trip) {
    // navigate, not push: return to the existing tabs instead of stacking new ones.
    router.navigate('/(tabs)/trips');
    return true;
  }

  const v = trip.vehicles[0];
  // The same params the Trips list passes, so the trip screen renders fully.
  router.push({
    pathname: '/trip/[bookingId]',
    params: {
      bookingId: trip.bookingId,
      id: String(trip.id),
      status: trip.status,
      make: v?.make ?? '',
      model: v?.model ?? '',
      thumbnail: v?.thumbnail ?? '',
      startAt: trip.startAt,
      endAt: trip.endAt,
      days: String(trip.days),
      total: String(trip.total),
      paymentStatus: trip.paymentStatus ?? '',
      vehiclesJson: JSON.stringify(trip.vehicles),
    },
  });
  return true;
}

// navigate, not push: return to the existing tabs instead of stacking new ones.
function openStaffBookingsTab() {
  router.navigate('/(employee)/bookings');
}

async function openForStaff(type: string, data: NotificationData): Promise<boolean> {
  // An overdue return opens the Recovery tab (call / WhatsApp the customer).
  if (type === 'RETURN_OVERDUE') {
    router.navigate('/(employee)/recovery' as Href);
    return true;
  }
  const bookingPublicId = data.bookingPublicId;
  if (!bookingPublicId) {
    openStaffBookingsTab();
    return true;
  }

  // Open the booking where it can be acted on now, like the QR scanner does:
  // a notification may be tapped long after it was sent (a confirmed booking
  // may already be out on the road).
  let status: string | null = null;
  try {
    const res = await employeeApi.scanBooking(bookingPublicId);
    status = (res.data?.data?.status as string | undefined) ?? null;
  } catch {
    status = null;
  }

  // Route by the live status; when the lookup failed (offline, removed), by
  // the notification type instead.
  const toPickup = status
    ? status === 'CONFIRMED'
    : type === 'BOOKING_CONFIRMED' || type.startsWith('PICKUP_');
  const toReturn = status ? status === 'PICKED_UP' : type.startsWith('RETURN_');

  if (toPickup) {
    router.push(`/employee/pickup/${bookingPublicId}` as Href);
  } else if (toReturn) {
    router.push(`/employee/return/${bookingPublicId}` as Href);
  } else {
    // HOLD / RETURNED / CANCELLED: nothing to process at the counter.
    openStaffBookingsTab();
  }
  return true;
}

/**
 * Navigates to whatever a notification is about. Resolves false when it has
 * no destination (the caller then just leaves the user where they are).
 * Unknown types fall back to the booking, if any.
 */
export async function openNotificationTarget(
  audience: NotificationAudience,
  type: string | undefined,
  data: NotificationData | undefined,
): Promise<boolean> {
  const safeData = data ?? {};
  return audience === 'STAFF'
    ? openForStaff(type ?? '', safeData)
    : openForCustomer(safeData);
}
