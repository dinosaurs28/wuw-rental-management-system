import { prisma, BookingStatus, type Prisma } from "@repo/database/client";
import { notifyEvents } from "../services/notification/notification.events.js";
import { pruneReadNotifications } from "../services/notification/notification.service.js";
import { isLiveReturnSession } from "../services/booking/overdue-returns.service.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG, type FrozenChargeConfig } from "../types/charge-engine.types.js";

/**
 * Time-driven notifications, every 15 minutes:
 *   - RETURN_OVERDUE: PICKED_UP bookings past endAt + the late-return grace the
 *     booking is billed under (frozen charge config, else the branch's). Skips
 *     cars already back (awaiting manager confirmation, or a live RETURN
 *     payment session), as the overdue list does. Once per endAt, so an
 *     extension that moves endAt re-arms it.
 *   - CASH_DELAYED: counter cash still COLLECTED (unconfirmed) past the
 *     branch's delayedCashAlertHours. Once per transaction.
 *   - Retention: read notifications older than 90 days are deleted (daily).
 *
 * Runs in every backend process; the (userId, dedupeKey) unique key keeps
 * rows and pushes single even when several instances scan at once.
 */

const INTERVAL_MS = 15 * 60 * 1000;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const READ_RETENTION_DAYS = 90;
const DEFAULT_DELAYED_CASH_HOURS = 2;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastPruneAt = 0;

/** Bookings whose key already has a row are skipped before any further loading. */
async function alreadyNotified(bookingId: number, dedupeKey: string): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: { bookingId, dedupeKey },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Grace the late-return bill uses: the policy frozen on the booking, else the
 * branch's live config, else the defaults (late-return.service `pick`).
 */
function graceMinutesFor(
  frozenChargeConfig: Prisma.JsonValue | null,
  live: { gracePolicyEnabled: boolean; graceMinutes: number } | null,
): number {
  const frozen = (frozenChargeConfig ?? null) as Partial<FrozenChargeConfig> | null;
  const enabled =
    frozen?.gracePolicyEnabled ?? live?.gracePolicyEnabled ?? DEFAULT_FROZEN_CHARGE_CONFIG.gracePolicyEnabled;
  const minutes = Number(frozen?.graceMinutes ?? live?.graceMinutes ?? DEFAULT_FROZEN_CHARGE_CONFIG.graceMinutes);
  return enabled && Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

async function scanOverdueReturns(now: Date): Promise<number> {
  const candidates = await prisma.booking.findMany({
    where: {
      status: BookingStatus.PICKED_UP,
      endAt: { lt: now },
      deletedAt: null,
      // Car already handed back, waiting on the manager (overdue list: AWAITING_MANAGER_CONFIRMATION)
      requiresManagerConfirmation: false,
    },
    select: {
      id: true,
      publicId: true,
      endAt: true,
      frozenChargeConfig: true,
      activePaymentSession: {
        select: { sessionType: true, status: true, expiresAt: true, updatedAt: true },
      },
      branch: { select: { chargeConfig: { select: { gracePolicyEnabled: true, graceMinutes: true } } } },
    },
  });

  let sent = 0;
  for (const booking of candidates) {
    // Drop bill being settled (overdue list: RETURN_IN_PROGRESS)
    if (isLiveReturnSession(booking.activePaymentSession, now)) continue;
    const graceMinutes = graceMinutesFor(booking.frozenChargeConfig, booking.branch.chargeConfig);
    if (booking.endAt.getTime() + graceMinutes * 60_000 >= now.getTime()) continue;

    const dedupeKey = `overdue:${booking.publicId}:${booking.endAt.toISOString()}`;
    if (await alreadyNotified(booking.id, dedupeKey)) continue;
    await notifyEvents.returnOverdue({ bookingId: booking.id });
    sent++;
  }
  return sent;
}

async function scanDelayedCash(now: Date): Promise<number> {
  const configs = await prisma.branchPaymentConfig.findMany({
    select: { branchId: true, delayedCashAlertHours: true },
  });
  const thresholdByBranch = new Map(configs.map((c) => [c.branchId, c.delayedCashAlertHours]));
  const minHours = Math.min(DEFAULT_DELAYED_CASH_HOURS, ...configs.map((c) => c.delayedCashAlertHours));

  const stale = await prisma.paymentTransaction.findMany({
    where: {
      status: "COLLECTED",
      collectedAt: { lt: new Date(now.getTime() - minHours * 60 * 60 * 1000) },
    },
    select: { id: true, publicId: true, bookingId: true, branchId: true, collectedAt: true },
  });

  let sent = 0;
  for (const txn of stale) {
    const hours = thresholdByBranch.get(txn.branchId) ?? DEFAULT_DELAYED_CASH_HOURS;
    if (!txn.collectedAt || txn.collectedAt.getTime() > now.getTime() - hours * 60 * 60 * 1000) continue;
    if (await alreadyNotified(txn.bookingId, `delayed-cash:${txn.publicId}`)) continue;
    await notifyEvents.cashDelayed({ transactionId: txn.id, thresholdHours: hours });
    sent++;
  }
  return sent;
}

export async function runNotificationScan(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();

    try {
      const overdue = await scanOverdueReturns(now);
      if (overdue > 0) console.log(`[NotificationWorker] RETURN_OVERDUE sent for ${overdue} booking(s)`);
    } catch (error) {
      console.error("[NotificationWorker] overdue scan failed:", error);
    }

    try {
      const delayed = await scanDelayedCash(now);
      if (delayed > 0) console.log(`[NotificationWorker] CASH_DELAYED sent for ${delayed} transaction(s)`);
    } catch (error) {
      console.error("[NotificationWorker] delayed-cash scan failed:", error);
    }

    if (now.getTime() - lastPruneAt >= PRUNE_EVERY_MS) {
      try {
        const removed = await pruneReadNotifications(READ_RETENTION_DAYS);
        lastPruneAt = now.getTime();
        if (removed > 0) console.log(`[NotificationWorker] pruned ${removed} read notification(s)`);
      } catch (error) {
        console.error("[NotificationWorker] prune failed:", error);
      }
    }
  } finally {
    running = false;
  }
}

export function initNotificationWorker(): void {
  if (intervalHandle) return;

  console.log("[NotificationWorker] Worker initialized — running every 15 minutes");
  void runNotificationScan();
  intervalHandle = setInterval(() => void runNotificationScan(), INTERVAL_MS);
}
