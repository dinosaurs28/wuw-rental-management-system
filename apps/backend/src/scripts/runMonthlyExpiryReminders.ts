/**
 * Runs the monthly rental expiry reminder pass once (the backend's
 * notification worker also runs it every 15 minutes). Idempotent: a reminder
 * already sent for a booking's current endAt is never sent again.
 *
 *   DATABASE_URL=… npx tsx src/scripts/runMonthlyExpiryReminders.ts
 *   DATABASE_URL=… node dist/scripts/runMonthlyExpiryReminders.js
 *
 * Prints one JSON line: { candidates, notified: [bookingPublicId…], alreadySent }.
 */
import { prisma } from "@repo/database/client";
import { runMonthlyExpiryScan } from "../jobs/notification.worker.js";

async function main() {
  const result = await runMonthlyExpiryScan(new Date());
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error("[runMonthlyExpiryReminders] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Redis / queue clients pulled in by imports may hold the event loop open.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  });
