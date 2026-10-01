import type { NotificationItem } from "@repo/schemas";
import type { NotificationRole } from "@/services/notification.service";

/**
 * Maps a notification (type + data routing hints) to the web route the user
 * should land on. Nothing is stored server-side; each client owns its own
 * mapping. Returns null for unknown types — the item still renders and can
 * be marked read, it just doesn't navigate.
 */
export function notificationLink(
  role: NotificationRole,
  notification: Pick<NotificationItem, "type" | "data">,
): string | null {
  // `type` is typed as the known union, but older/newer servers may send
  // values this build doesn't know, so compare as a plain string.
  const type: string = notification.type;
  const data = notification.data ?? {};
  const booking = data.bookingPublicId
    ? encodeURIComponent(data.bookingPublicId)
    : null;

  switch (role) {
    case "CUSTOMER":
      return customerLink(type);
    case "STAFF":
      return staffLink(type, booking);
    case "MANAGER":
      return managerLink(type, booking, data.approvalKind);
    default:
      return null;
  }
}

const CUSTOMER_TYPES = new Set([
  "BOOKING_CONFIRMED",
  "BOOKING_CANCELLED",
  "BOOKING_DISPLACED",
  "PAYMENT_NEEDS_REFUND",
  "REFUND_COMPLETED",
  "EXTENSION_CONFIRMED",
  "EXTENSION_REJECTED",
  "PICKUP_COMPLETED",
  "RETURN_COMPLETED",
  "RETURN_OVERDUE",
  "DAMAGE_CHARGED",
  "VEHICLE_SWAPPED",
]);

/** Customers have no per-booking page keyed by publicId — every booking event opens My Bookings. */
function customerLink(type: string): string | null {
  return CUSTOMER_TYPES.has(type) ? "/my-bookings" : null;
}

const STAFF_TYPES = new Set([
  "BOOKING_CONFIRMED",
  "BOOKING_CANCELLED",
  "EXTENSION_CONFIRMED",
  "RETURN_OVERDUE",
  "VEHICLE_SWAPPED",
  "APPROVAL_RESOLVED",
]);

function staffLink(type: string, booking: string | null): string | null {
  if (booking && (type === "BOOKING_CONFIRMED" || type.startsWith("PICKUP_"))) {
    return `/staff/pickups/${booking}`;
  }
  if (booking && type.startsWith("RETURN_")) {
    return `/employee/dashboard/return/${booking}`;
  }
  return STAFF_TYPES.has(type) ? "/employee/dashboard" : null;
}

function managerLink(
  type: string,
  booking: string | null,
  approvalKind: string | undefined,
): string | null {
  switch (type) {
    case "APPROVAL_REQUESTED":
      if (approvalKind === "MANUAL_DISCOUNT") return "/manager/payment/discount-approvals";
      if (approvalKind === "REFUND") return "/manager/payment/refunds";
      if (approvalKind === "SAFETY_DEPOSIT") return "/manager/confirmations";
      // Charge overrides have no dedicated web queue; they surface on the dashboard.
      return "/manager/dashboard";
    case "PICKUP_APPROVAL_REQUESTED":
    case "RETURN_APPROVAL_REQUESTED":
      return booking ? `/manager/confirmations?booking=${booking}` : "/manager/confirmations";
    case "CASH_DELAYED":
      return "/manager/payment/cash-confirmations";
    case "SHIFT_DISCREPANCY":
      return "/manager/payment/cash-shifts";
    case "BOOKING_DISPLACED":
      return "/manager/extensions/displaced";
    case "DAMAGE_REPORTED":
      return "/manager/damage-reports";
    case "RETURN_OVERDUE":
      return "/manager/fleet";
    case "PAYMENT_NEEDS_REFUND":
      return "/manager/payment/refunds";
    case "VEHICLE_SWAPPED":
      return booking ? `/manager/bookings/${booking}/swap-vehicle` : "/manager/dashboard";
    case "EXTENSION_CONFIRMED":
      return "/manager/payment/extensions";
    case "BOOKING_CANCELLED":
      // Managers only receive the automatic no-show cancellation.
      return "/manager/no-show";
    case "BOOKING_CONFIRMED":
      return "/manager/dashboard";
    default:
      return null;
  }
}
