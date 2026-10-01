// In-app notifications (#19). Mirrors packages/schemas/src/notification.schema.ts
// — mobile cannot import @repo/schemas, so keep the two in step.

export type NotificationTypeName =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_DISPLACED'
  | 'PAYMENT_NEEDS_REFUND'
  | 'REFUND_COMPLETED'
  | 'EXTENSION_CONFIRMED'
  | 'EXTENSION_REJECTED'
  | 'PICKUP_COMPLETED'
  | 'PICKUP_APPROVAL_REQUESTED'
  | 'RETURN_COMPLETED'
  | 'RETURN_APPROVAL_REQUESTED'
  | 'RETURN_OVERDUE'
  | 'DAMAGE_REPORTED'
  | 'DAMAGE_CHARGED'
  | 'VEHICLE_SWAPPED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_RESOLVED'
  | 'CASH_DELAYED'
  | 'SHIFT_DISCREPANCY';

/** What an APPROVAL_* (or CASH_DELAYED / *_APPROVAL_REQUESTED) notification is about. */
export type NotificationApprovalKind =
  | 'MANUAL_DISCOUNT'
  | 'CHARGE_OVERRIDE'
  | 'SAFETY_DEPOSIT'
  | 'REFUND'
  | 'CASH_PAYMENT'
  | 'PICKUP'
  | 'RETURN';

/** Routing hints only — the server never stores URLs. `{}` when none. */
export interface NotificationData {
  bookingPublicId?: string;
  extensionPublicId?: string;
  entity?: string;
  entityPublicId?: string;
  approvalKind?: NotificationApprovalKind;
  /** APPROVAL_RESOLVED only: true = approved/confirmed, false = rejected. */
  approved?: boolean;
}

/**
 * One inbox row. `type` stays a plain string on the wire: a newer backend may
 * send types this build does not know — render title/body, skip the deep link.
 */
export interface AppNotification {
  publicId: string;
  type: NotificationTypeName | (string & {});
  /** Ready to render. */
  title: string;
  /** Ready to render — IST times and ₹ amounts are already formatted. */
  body: string;
  data: NotificationData;
  /** ISO; null while unread. */
  readAt: string | null;
  /** ISO. */
  createdAt: string;
}

/** GET .../notifications → data */
export interface NotificationPage {
  items: AppNotification[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  unreadCount: number;
}

/** Push payload `data` as sent to Expo: the row's data plus its type and id. */
export interface NotificationPushData extends NotificationData {
  type?: string;
  notificationPublicId?: string;
}

/**
 * Whose inbox the signed-in user reads on this device. Customers use
 * /api/user/notifications, Fleet Executives (STAFF) /api/employee/notifications.
 * The mobile app has no branch-manager role.
 */
export type NotificationAudience = 'CUSTOMER' | 'STAFF';
