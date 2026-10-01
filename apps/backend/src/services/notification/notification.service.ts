import { prisma, Prisma, Role } from "@repo/database/client";
import type { NotificationType } from "@repo/database/client";
import type { NotificationData, NotificationItem, NotificationTypeName } from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";
import { sendPushForNotifications } from "./push.service.js";

/**
 * In-app notifications (+ Expo push) for customers, Fleet (STAFF) and branch
 * managers.
 *
 * Rules every caller follows:
 *   - Call notify() only AFTER the business transaction has committed.
 *   - notify() never throws: failures are logged and swallowed, so a broken
 *     notification can never fail a booking/payment flow. Callers fire it with
 *     `void notify(...)` (or `void notifyEvents.x(...)`).
 *   - One row per recipient, keyed by (userId, dedupeKey). Re-running the same
 *     event (verify/webhook/poll races, retries, several worker instances)
 *     never duplicates a row or a push.
 *   - The actor of an action is never notified about their own action.
 */

/** A user id, or every active user of the given roles in a branch. */
export type NotificationRecipient = number | { branchId: number; roles: Role[] };

export interface NotifyInput {
  type: NotificationType;
  recipients: Array<NotificationRecipient | null | undefined>;
  /** The user who caused the event — excluded from the recipients. */
  actorUserId?: number | null;
  branchId?: number | null;
  bookingId?: number | null;
  title: string;
  body: string;
  data?: NotificationData;
  /** Stable per-event key, e.g. `booking-confirmed:{bookingPublicId}`. */
  dedupeKey: string;
}

async function resolveRecipients(
  recipients: NotifyInput["recipients"],
): Promise<Set<number>> {
  const userIds = new Set<number>();
  const directIds: number[] = [];

  for (const recipient of recipients) {
    if (recipient === null || recipient === undefined) continue;
    if (typeof recipient === "number") {
      directIds.push(recipient);
      continue;
    }
    if (recipient.roles.length === 0) continue;
    const users = await prisma.user.findMany({
      where: {
        branchId: recipient.branchId,
        role: { in: recipient.roles },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    users.forEach((u) => userIds.add(u.id));
  }

  if (directIds.length > 0) {
    // Deleted accounts never receive anything.
    const users = await prisma.user.findMany({
      where: { id: { in: directIds }, deletedAt: null },
      select: { id: true },
    });
    users.forEach((u) => userIds.add(u.id));
  }

  return userIds;
}

/**
 * Writes one notification row per recipient and pushes the newly created ones.
 * Returns the number of rows created (0 when everything was a duplicate or on
 * failure). Never throws.
 */
export async function notify(input: NotifyInput): Promise<number> {
  try {
    const recipients = await resolveRecipients(input.recipients);
    if (input.actorUserId) recipients.delete(input.actorUserId);
    if (recipients.size === 0) return 0;

    const data = (input.data ?? {}) as Prisma.InputJsonObject;
    const created = await prisma.notification.createManyAndReturn({
      data: [...recipients].map((userId) => ({
        publicId: createID(),
        userId,
        branchId: input.branchId ?? null,
        bookingId: input.bookingId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        data,
        dedupeKey: input.dedupeKey,
      })),
      // (userId, dedupeKey) is unique — an event that already reached a user is skipped.
      skipDuplicates: true,
      select: {
        id: true,
        publicId: true,
        userId: true,
        type: true,
        title: true,
        body: true,
        data: true,
      },
    });

    if (created.length > 0) {
      await sendPushForNotifications(created);
    }
    return created.length;
  } catch (error) {
    console.error(`[notify] ${input.type} dedupeKey=${input.dedupeKey} failed:`, error);
    return 0;
  }
}

// ── Inbox (used by the per-role /notifications routers) ─────────────────────

type NotificationRow = {
  publicId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
};

const INBOX_SELECT = {
  id: true,
  publicId: true,
  type: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

export function toNotificationItem(row: NotificationRow): NotificationItem {
  const data =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as NotificationData)
      : {};
  return {
    publicId: row.publicId,
    type: row.type as NotificationTypeName,
    title: row.title,
    body: row.body,
    data,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class NotificationCursorError extends Error {
  readonly code = "INVALID_CURSOR";
  constructor() {
    super("The notification cursor is invalid or has expired. Reload the list.");
  }
}

export async function countUnread(userId: number): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** Newest first. `cursor` is the publicId of the last item of the previous page. */
export async function listNotifications(
  userId: number,
  opts: { cursor?: string; limit: number; unreadOnly: boolean },
): Promise<{ items: NotificationItem[]; nextCursor: string | null; unreadCount: number }> {
  let beforeId: number | undefined;
  if (opts.cursor) {
    const anchor = await prisma.notification.findFirst({
      where: { publicId: opts.cursor, userId },
      select: { id: true },
    });
    if (!anchor) throw new NotificationCursorError();
    beforeId = anchor.id;
  }

  const rows = await prisma.notification.findMany({
    where: {
      userId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(beforeId !== undefined ? { id: { lt: beforeId } } : {}),
    },
    // id is monotonic with createdAt, and unique — stable keyset pagination.
    orderBy: { id: "desc" },
    take: opts.limit + 1,
    select: INBOX_SELECT,
  });

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const unreadCount = await countUnread(userId);

  return {
    items: page.map(toNotificationItem),
    nextCursor: hasMore ? page[page.length - 1]!.publicId : null,
    unreadCount,
  };
}

/** Marks one of the user's notifications read. Returns null when it isn't theirs. */
export async function markNotificationRead(
  userId: number,
  publicId: string,
): Promise<NotificationItem | null> {
  const row = await prisma.notification.findFirst({
    where: { publicId, userId },
    select: INBOX_SELECT,
  });
  if (!row) return null;
  if (row.readAt) return toNotificationItem(row);

  const updated = await prisma.notification.update({
    where: { id: row.id },
    data: { readAt: new Date() },
    select: INBOX_SELECT,
  });
  return toNotificationItem(updated);
}

export async function markAllNotificationsRead(userId: number): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/**
 * Registers a device. The token is unique, so a device that switches accounts
 * (customer ⇄ Fleet on one phone) follows the latest sign-in.
 */
export async function registerPushToken(
  userId: number,
  token: string,
  platform: "ios" | "android",
): Promise<void> {
  await prisma.pushToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { userId, platform },
  });
}

/** Detaches a device from this user. Returns how many rows were removed (0 or 1). */
export async function unregisterPushToken(userId: number, token: string): Promise<number> {
  const result = await prisma.pushToken.deleteMany({ where: { token, userId } });
  return result.count;
}

/** Retention: read notifications older than `days` are removed. */
export async function pruneReadNotifications(days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.notification.deleteMany({
    where: { readAt: { lt: cutoff } },
  });
  return result.count;
}
