import { z } from "zod";

/** Mirrors the Prisma NotificationType enum. */
export const NOTIFICATION_TYPES = [
  "BOOKING_CONFIRMED",
  "BOOKING_CANCELLED",
  "BOOKING_DISPLACED",
  "PAYMENT_NEEDS_REFUND",
  "REFUND_COMPLETED",
  "EXTENSION_CONFIRMED",
  "EXTENSION_REJECTED",
  "PICKUP_COMPLETED",
  "PICKUP_APPROVAL_REQUESTED",
  "RETURN_COMPLETED",
  "RETURN_APPROVAL_REQUESTED",
  "RETURN_OVERDUE",
  "DAMAGE_REPORTED",
  "DAMAGE_CHARGED",
  "VEHICLE_SWAPPED",
  "APPROVAL_REQUESTED",
  "APPROVAL_RESOLVED",
  "CASH_DELAYED",
  "SHIFT_DISCREPANCY",
] as const;

export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number];

/** What an APPROVAL_REQUESTED / APPROVAL_RESOLVED notification is about. */
export const NOTIFICATION_APPROVAL_KINDS = [
  "MANUAL_DISCOUNT",
  "CHARGE_OVERRIDE",
  "SAFETY_DEPOSIT",
  "REFUND",
  "CASH_PAYMENT",
  "PICKUP",
  "RETURN",
] as const;

export type NotificationApprovalKind = (typeof NOTIFICATION_APPROVAL_KINDS)[number];

/**
 * Routing hints stored on every notification. Clients map type + data to
 * their own routes; no URLs are stored server-side.
 */
export interface NotificationData {
  bookingPublicId?: string;
  extensionPublicId?: string;
  /** Model name of the record the notification is about, e.g. "RefundRequest". */
  entity?: string;
  entityPublicId?: string;
  approvalKind?: NotificationApprovalKind;
  /** APPROVAL_RESOLVED only: true = approved/confirmed, false = rejected. */
  approved?: boolean;
}

/** One row as returned by GET .../notifications. */
export interface NotificationItem {
  publicId: string;
  type: NotificationTypeName;
  title: string;
  body: string;
  data: NotificationData;
  readAt: string | null;
  createdAt: string;
}

const booleanQuery = z
  .enum(["true", "false", "1", "0"], {
    errorMap: () => ({ message: "unreadOnly must be true or false" }),
  })
  .transform((v) => v === "true" || v === "1");

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce
    .number({ invalid_type_error: "limit must be a number between 1 and 50" })
    .int("limit must be a number between 1 and 50")
    .min(1, "limit must be a number between 1 and 50")
    .max(50, "limit must be a number between 1 and 50")
    .default(20),
  unreadOnly: booleanQuery.default("false"),
});

export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export const registerPushTokenSchema = z.object({
  token: z
    .string({ required_error: "token is required" })
    .trim()
    .max(255)
    .regex(EXPO_PUSH_TOKEN_PATTERN, "token must be an Expo push token (ExponentPushToken[...])"),
  platform: z.enum(["ios", "android"], {
    errorMap: () => ({ message: "platform must be 'ios' or 'android'" }),
  }),
});

export const unregisterPushTokenSchema = z.object({
  token: z.string({ required_error: "token is required" }).trim().min(1, "token is required").max(255),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
export type UnregisterPushTokenInput = z.infer<typeof unregisterPushTokenSchema>;
