import { prisma, BookingStatus, PaymentStatus } from "@repo/database/client";
import { AdvanceDepositService } from "../services/booking/advance-deposit.service.js";

const advanceDepositService = new AdvanceDepositService();
const NO_SHOW_GRACE_HOURS = 24;
const SYSTEM_ACTOR = "SYSTEM";

// ============================================================================
// CORE LOGIC (shared between scheduled run and manual trigger)
// ============================================================================

export async function runNoShowAutoCancel(): Promise<{ cancelledCount: number; bookingIds: string[] }> {
  console.log("[NoShowAutoCancel] Starting no-show auto-cancellation run...");

  const cutoff = new Date(Date.now() - NO_SHOW_GRACE_HOURS * 60 * 60 * 1000);

  const eligibleBookings = await prisma.booking.findMany({
    where: {
      status: BookingStatus.CONFIRMED,
      paymentStatus: PaymentStatus.SUCCESS,
      startAt: { lt: cutoff },
    },
    select: { id: true, publicId: true },
  });

  if (eligibleBookings.length === 0) {
    console.log("[NoShowAutoCancel] No eligible bookings found.");
    return { cancelledCount: 0, bookingIds: [] };
  }

  console.log(`[NoShowAutoCancel] Found ${eligibleBookings.length} eligible booking(s).`);

  const cancelledIds: string[] = [];
  for (const booking of eligibleBookings) {
    try {
      await advanceDepositService.handleNoShowCancellation(
        booking.id,
        SYSTEM_ACTOR,
        "Auto-cancelled: Customer no-show (24h grace period elapsed)",
      );
      cancelledIds.push(booking.publicId);
      console.log(`[NoShowAutoCancel] Cancelled booking ${booking.publicId}`);
    } catch (err: any) {
      console.error(`[NoShowAutoCancel] Failed for ${booking.publicId}:`, err.message);
    }
  }

  console.log(`[NoShowAutoCancel] Done. Cancelled: ${cancelledIds.length}/${eligibleBookings.length}`);
  return { cancelledCount: cancelledIds.length, bookingIds: cancelledIds };
}

// ============================================================================
// SCHEDULING — fires at 06:00 AM IST (UTC 00:30) daily
// ============================================================================

function msUntilNext0030UTC(): number {
  const now = new Date();
  const next = new Date(now);
  // Set to today's 00:30 UTC
  next.setUTCHours(0, 30, 0, 0);
  // If that time has already passed today, advance to tomorrow
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleNextRun(): void {
  const delay = msUntilNext0030UTC();
  const nextAt = new Date(Date.now() + delay);
  console.log(`[NoShowAutoCancel] Next scheduled run at ${nextAt.toISOString()} (in ${Math.round(delay / 60000)} min)`);

  setTimeout(async () => {
    try {
      await runNoShowAutoCancel();
    } catch (err) {
      console.error("[NoShowAutoCancel] Unhandled error in scheduled run:", err);
    } finally {
      scheduleNextRun(); // Reschedule after each run
    }
  }, delay);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initNoShowAutoCancelWorker(): void {
  console.log("[NoShowAutoCancel] Initializing — fires daily at 06:00 AM IST (00:30 UTC).");
  scheduleNextRun();
}
