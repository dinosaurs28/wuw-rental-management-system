/**
 * One-off data fix: give back coupon uses held by bookings that never happened.
 *
 * Booking create records a CouponUsageLog row at hold time. Since the Oct 2026
 * batch, discountApplicationService.releaseUsage deletes that row when the hold
 * expires or is cancelled (→ HOLD_EXPIRED) or the payment fails (→ CANCELLED +
 * paymentStatus FAILED). Rows written before that release existed are still
 * counted by couponValidationService.checkUsageLimits, so a customer whose
 * payment failed on a perUserLimit=1 coupon keeps getting
 * COUPON_PER_USER_LIMIT_EXCEEDED, and campaign limits stay partly used up.
 *
 * This deletes exactly the rows releaseUsage would have deleted. A booking that
 * is later confirmed by a late payment capture gets its row back
 * (confirmBookingPayment re-records a missing use), so the fix is safe to run
 * at any time and is idempotent. Run once per environment after deploying:
 *
 *   DATABASE_URL=… npx tsx src/scripts/releaseStaleCouponUsage.ts           # dry run: list only
 *   DATABASE_URL=… npx tsx src/scripts/releaseStaleCouponUsage.ts --apply   # delete
 */
import { prisma } from "@repo/database/client";

interface StaleRow {
  id: number;
  bookingPublicId: string;
  bookingStatus: string;
  paymentStatus: string;
  couponCode: string;
}

const apply = process.argv.includes("--apply");

async function main() {
  const stale = await prisma.$queryRaw<StaleRow[]>`
    SELECT l.id,
           b."publicId"        AS "bookingPublicId",
           b.status::text      AS "bookingStatus",
           b."paymentStatus"::text AS "paymentStatus",
           r.code              AS "couponCode"
    FROM "CouponUsageLog" l
    JOIN "Booking" b ON b.id = l."bookingId"
    JOIN "DiscountRule" r ON r.id = l."discountRuleId"
    WHERE b.status = 'HOLD_EXPIRED'
       OR (b.status = 'CANCELLED' AND b."paymentStatus" = 'FAILED')
    ORDER BY l.id`;

  if (stale.length === 0) {
    console.log("No stale coupon uses — nothing to do.");
    return;
  }

  const byCoupon = new Map<string, number>();
  for (const row of stale) byCoupon.set(row.couponCode, (byCoupon.get(row.couponCode) ?? 0) + 1);
  console.log(`${stale.length} coupon use(s) held by bookings that never happened:`);
  for (const [code, count] of byCoupon) console.log(`  ${code}: ${count}`);
  for (const row of stale) {
    console.log(`  log ${row.id} · booking ${row.bookingPublicId} (${row.bookingStatus}/${row.paymentStatus}) · ${row.couponCode}`);
  }

  if (!apply) {
    console.log("\nDry run — re-run with --apply to give these uses back.");
    return;
  }

  // Re-check the booking state in the delete itself, so a hold confirmed
  // between the listing and now keeps its use
  const deleted = await prisma.$executeRaw`
    DELETE FROM "CouponUsageLog" l
    USING "Booking" b
    WHERE b.id = l."bookingId"
      AND (b.status = 'HOLD_EXPIRED' OR (b.status = 'CANCELLED' AND b."paymentStatus" = 'FAILED'))`;
  console.log(`\nReleased ${deleted} coupon use(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
