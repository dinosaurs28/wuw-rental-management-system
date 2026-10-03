/**
 * One-off data fix for item 8 (Oct 3 2026): drop / recovery charges — extra km,
 * late return, fuel, FASTag, damage, vehicle-swap difference, other charges —
 * carry no GST any more. Bills still open when that shipped are restated
 * without GST; completed ones are left as they were.
 *
 *  - Unified Payments drop bills (RETURN sessions not completed): nothing to
 *    write. A bill whose lines still carry GST is reported stale by
 *    GET /return/session (billStale, billStaleReason DROP_GST_REMOVED) and
 *    payment on it is refused (DROP_BILL_STALE) until staff compute it again,
 *    which rebuilds every line without GST. They are listed here.
 *  - Legacy drops (ChargeEntry rows the branch manager collects in
 *    Settlements): rows of a booking whose settlement is not settled yet have
 *    their frozen GST removed, and the booking's PENDING invoice is rebuilt.
 *
 * Idempotent. The staging deploy (.github/workflows/deploy-staging.yml) runs
 * it with --apply after every backend restart (compiled: dist/scripts/
 * restateOpenDropGst.js, with apps/backend/.env); any other environment runs
 * it once after deploying:
 *   DATABASE_URL=… REDIS_URL=… npx tsx src/scripts/restateOpenDropGst.ts           # dry run: list only
 *   DATABASE_URL=… REDIS_URL=… npx tsx src/scripts/restateOpenDropGst.ts --apply   # restate legacy rows
 */
import Decimal from "decimal.js";
import { prisma, PaymentSessionStatus, PaymentSessionType } from "@repo/database/client";
import {
  LEGACY_RETURN_CHARGE_TYPES,
  chargeEntryGst,
  stripLegacyReturnChargeGst,
} from "../services/charges/legacy-return-charges.service.js";
import { settlementEngineService } from "../services/payment/settlement-engine.service.js";
import { syncLegacyReturnInvoice } from "../services/invoice-finalization.service.js";

const apply = process.argv.includes("--apply");

async function main() {
  // ── Unified drop bills still open with GST on a drop line ─────────────────
  const openSessions = await prisma.paymentSession.findMany({
    where: {
      sessionType: PaymentSessionType.RETURN,
      status: {
        in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.AWAITING_PAYMENT, PaymentSessionStatus.PAYMENT_INITIATED],
      },
      entries: {
        some: {
          isVoided: false,
          entryType: { notIn: ["BOOKING_BASE", "EXTENSION"] },
          NOT: { gstAmount: 0 },
        },
      },
    },
    select: { publicId: true, status: true, gstAmount: true, booking: { select: { publicId: true } } },
  });
  console.log(`Open drop bills with GST on drop charges: ${openSessions.length} (staff recompute them; payment is refused until then)`);
  for (const s of openSessions) {
    console.log(`  booking ${s.booking.publicId}  session ${s.publicId}  ${s.status}  GST ₹${new Decimal(s.gstAmount.toString()).toFixed(2)}`);
  }

  // ── Legacy drops: return-charge rows still carrying frozen GST ────────────
  const rows = await prisma.chargeEntry.findMany({
    where: { chargeType: { in: LEGACY_RETURN_CHARGE_TYPES } },
    select: {
      bookingId: true,
      gstAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      taxRate: true,
      notes: true,
      booking: { select: { publicId: true } },
    },
  });
  const bookings = new Map<number, string>();
  for (const r of rows) {
    if (chargeEntryGst(r)) bookings.set(r.bookingId, r.booking.publicId);
  }

  let restated = 0;
  for (const [bookingId, publicId] of bookings) {
    const completedBill = await prisma.paymentSession.findFirst({
      where: { bookingId, sessionType: PaymentSessionType.RETURN, status: PaymentSessionStatus.COMPLETED },
      select: { id: true },
    });
    if (completedBill) continue;
    const { isSettled, returnCharges } = await settlementEngineService.calculateSettlement(bookingId);
    if (isSettled) {
      console.log(`  booking ${publicId}: settled — left as it was`);
      continue;
    }
    if (!apply) {
      console.log(`  booking ${publicId}: open legacy return charges ₹${returnCharges} incl. GST — would restate without GST`);
      continue;
    }
    const changed = await prisma.$transaction((tx) => stripLegacyReturnChargeGst(bookingId, tx as any));
    await syncLegacyReturnInvoice(bookingId);
    restated++;
    console.log(`  booking ${publicId}: ${changed} return-charge row(s) restated without GST; invoice re-synced`);
  }
  console.log(apply ? `Restated ${restated} legacy drop(s).` : "Dry run — pass --apply to restate the legacy drops above.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
