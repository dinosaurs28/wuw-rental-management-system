/**
 * Pure-logic self-check for the free km an extension adds (#7 / client item 4).
 * No DB queries.
 *
 *   npx tsx src/scripts/verifyExtensionFreeKm.ts
 *
 * Verifies the per-extension rule (whole 24 h → freeKm24Hour, a remaining
 * ≥ 12 h block → freeKm12Hour, other hours → 0) and which extension rows the
 * drop's km allowance counts — including an extension made at the counter
 * before pickup, while the booking is still CONFIRMED. The allowance is
 * includedKm = freeKmOriginal + Σ these per-extension km (km-allowance.service),
 * the same figures the rental timeline lists per extension.
 */
import { ExtensionStatus } from "@repo/database/client";
import { extensionFreeKm, extensionMinutes } from "../services/charges/extension-km.js";
import { buildRentalPeriod, type TimelineExtensionInput } from "../services/charges/rental-timeline.service.js";

let failures = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

const HOUR = 3_600_000;
const rates = { freeKm12Hour: 80, freeKm24Hour: 150 };
// A 24 h booking: 10:00 IST → 10:00 IST next day
const startAt = new Date("2026-10-10T04:30:00.000Z");
const endAt = new Date(startAt.getTime() + 24 * HOUR);
const plus = (from: Date, hours: number) => new Date(from.getTime() + hours * HOUR);

// --- Per-extension rule ---
for (const [hours, km] of [
  [2, 0],
  [12, 80],
  [14, 80],
  [24, 150],
  [26, 150],
  [36, 230],
  [48, 300],
] as const) {
  eq(`${hours} h extension adds ${km} km`, extensionFreeKm(extensionMinutes(endAt, plus(endAt, hours)), rates).km, km);
}
eq(
  "1 day 12 h label",
  extensionFreeKm(36 * 60, rates).label,
  "150 km for 1 day + 80 km for 12 h",
);
eq("under 12 h label", extensionFreeKm(2 * 60, rates).label, "Extensions under 12 hours add no free km");

// --- Which extensions the allowance counts ---
let nextId = 1;
const extension = (
  status: ExtensionStatus,
  oldEndAt: Date,
  hours: number,
  committed = true,
): TimelineExtensionInput => {
  const id = nextId++;
  return {
    id,
    publicId: `ext-${id}`,
    oldEndAt,
    requestedEndAt: plus(oldEndAt, hours),
    actualNewEndAt: status === ExtensionStatus.CONFIRMED ? plus(oldEndAt, hours) : null,
    extensionStatus: status,
    resolutionType: committed ? "SAME_VEHICLE" : null,
    extensionTrigger: "EMPLOYEE",
    additionalAmount: "0",
    taxAmount: "0",
    createdAt: new Date(startAt.getTime() + id * 60_000),
  };
};
const extensionKm = (
  booking: { endAt: Date; activeExtensionId: number | null },
  extensions: TimelineExtensionInput[],
) =>
  buildRentalPeriod({ startAt, endAt: booking.endAt, originalEndAt: null, activeExtensionId: booking.activeExtensionId }, extensions, rates)
    .extensionFreeKmTotal;

// At the counter before pickup: committed, not paid yet (the hold already moved endAt)
{
  const e = extension(ExtensionStatus.PENDING_PAYMENT, endAt, 24);
  eq("pre-pickup +1 day, committed unpaid", extensionKm({ endAt: e.requestedEndAt, activeExtensionId: e.id }, [e]), 150);
}
// Cash taken, awaiting the branch manager
{
  const e = extension(ExtensionStatus.PAYMENT_COLLECTED, endAt, 12);
  eq("pre-pickup +12 h, cash awaiting manager", extensionKm({ endAt: e.requestedEndAt, activeExtensionId: e.id }, [e]), 80);
}
// Confirmed
{
  const e = extension(ExtensionStatus.CONFIRMED, endAt, 48);
  eq("+2 days confirmed", extensionKm({ endAt: e.requestedEndAt, activeExtensionId: null }, [e]), 300);
}
// A quote never committed holds nothing and adds no km
{
  const e = extension(ExtensionStatus.PENDING_PAYMENT, endAt, 24, false);
  eq("uncommitted quote adds nothing", extensionKm({ endAt, activeExtensionId: e.id }, [e]), 0);
}
// Cancelled / rejected rows add nothing
{
  const c = extension(ExtensionStatus.CANCELLED, endAt, 24);
  const r = extension(ExtensionStatus.REJECTED, endAt, 24);
  eq("cancelled + rejected add nothing", extensionKm({ endAt, activeExtensionId: null }, [c, r]), 0);
}
// Two extensions: +12 h at pickup, then +1 day — each earns its own km
{
  const first = extension(ExtensionStatus.CONFIRMED, endAt, 12);
  const second = extension(ExtensionStatus.CONFIRMED, first.requestedEndAt, 24);
  eq("+12 h then +1 day", extensionKm({ endAt: second.requestedEndAt, activeExtensionId: null }, [first, second]), 230);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll extension free-km checks passed");
process.exit(0);
