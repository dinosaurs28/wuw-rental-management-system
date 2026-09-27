/**
 * Drop damage — damage staff record while closing a drop.
 *
 * A drop damage is a DamageReport whose notes carry `source: "DROP"`. On a
 * payment-session branch a customer-charged damage (`chargedAtDrop`) is billed
 * as a DAMAGE line on the RETURN session ledger, so the manager review only sets
 * the vehicle disposition and never charges it a second time. On a branch
 * without payment sessions the manager charges it through the damage review.
 */
import Decimal from "decimal.js";
import {
  prisma,
  BookingStatus,
  DamageReportStatus,
  LedgerEntryType,
  PaymentSessionStatus,
  PaymentSessionType,
  VehicleStatus,
  VehicleReturnDisposition,
} from "@repo/database/client";
import type { TxClient } from "../payment/paymentSession.service.js";

export const DROP_DAMAGE_SOURCE = "DROP";

/** LedgerEntry.referenceType of a drop damage line (referenceId = DamageReport.publicId). */
export const DROP_DAMAGE_REF = "DROP_DAMAGE";

/** LedgerEntry.referenceType of the discount given at drop. */
export const DROP_DISCOUNT_REF = "DROP_DISCOUNT";

/** 409 body when payment is attempted on a drop bill computed before the latest change. */
export const DROP_BILL_STALE = {
  code: "DROP_BILL_STALE",
  message:
    "The drop bill is out of date — damage or the rental period changed after it was computed. Recompute the drop charges and try again.",
} as const;

/**
 * Row-locks the booking for the rest of the transaction. Everything that changes
 * or settles a drop bill (compute, drop damage add/remove, record payment/refund)
 * takes this lock first, so they run one at a time per booking and re-check
 * their preconditions under it.
 */
export async function lockBookingForDrop(tx: TxClient, bookingId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
}

export function isDropDamage(notes: unknown): boolean {
  return (
    !!notes &&
    typeof notes === "object" &&
    (notes as Record<string, unknown>).source === DROP_DAMAGE_SOURCE
  );
}

/**
 * How a drop damage reaches the customer (null for reports not raised at drop):
 *  - DROP     billed on the RETURN session at drop (chargedAtDrop)
 *  - MANAGER  customer pays; the manager charges it in the damage review
 *             (branches without payment sessions)
 *  - COMPANY  company expense; never billed to the customer
 */
export type DropDamageBilling = "DROP" | "MANAGER" | "COMPANY";

export function dropDamageBilling(report: {
  notes: unknown;
  chargedAtDrop: boolean;
}): DropDamageBilling | null {
  if (!isDropDamage(report.notes)) return null;
  if (report.chargedAtDrop) return "DROP";
  return (report.notes as Record<string, unknown>).chargeCustomer === true ? "MANAGER" : "COMPANY";
}

/**
 * True when the manager review of a report only sets the vehicle disposition:
 * a company expense, or a charged drop damage the drop bill carries (the drop is
 * still open, or its completed RETURN session billed it). False = the manager
 * charges it through the normal review.
 */
export function reviewIsDispositionOnly(
  billing: DropDamageBilling | null,
  bookingStatus: BookingStatus,
  billedOnDrop: boolean,
): boolean {
  return (
    billing === "COMPANY" ||
    (billing === "DROP" && (bookingStatus !== BookingStatus.RETURNED || billedOnDrop))
  );
}

/** Amount billed for a charged drop damage — the cost staff entered at drop. */
export function dropDamageAmount(report: {
  finalCost: { toString(): string } | null;
  estimatedCost: { toString(): string };
}): Decimal {
  return new Decimal((report.finalCost ?? report.estimatedCost).toString());
}

// Most restrictive first — a car with any DAMAGED report stays off the fleet.
const DISPOSITION_STATUS: [VehicleReturnDisposition, VehicleStatus][] = [
  [VehicleReturnDisposition.DAMAGED, VehicleStatus.INACTIVE],
  [VehicleReturnDisposition.MAINTENANCE, VehicleStatus.MAINTENANCE],
  [VehicleReturnDisposition.AVAILABLE, VehicleStatus.AVAILABLE],
];

/**
 * Status of a booking's vehicle once its drop is complete, from the drop damage
 * reports raised on it:
 *  - none                → null (caller keeps its default)
 *  - any still PENDING   → MANAGER_REPORTED (the manager sets the disposition)
 *  - all reviewed        → the most restrictive disposition the manager chose
 */
export async function vehicleStatusAfterDrop(
  bookingId: number,
  vehicleId: number,
  tx?: TxClient,
): Promise<VehicleStatus | null> {
  const db = tx ?? prisma;
  const reports = await db.damageReport.findMany({
    where: { bookingId, vehicleId },
    select: { status: true, disposition: true, notes: true },
  });
  const dropReports = reports.filter((r) => isDropDamage(r.notes));
  if (dropReports.length === 0) return null;

  if (dropReports.some((r) => r.status === DamageReportStatus.PENDING)) {
    return VehicleStatus.MANAGER_REPORTED;
  }

  for (const [disposition, status] of DISPOSITION_STATUS) {
    if (dropReports.some((r) => r.disposition === disposition)) return status;
  }
  return VehicleStatus.AVAILABLE;
}

/**
 * True when the RETURN session's bill still matches the booking: the drop damage
 * lines are exactly the booking's charged drop damages (same reports, same
 * amounts) and the rental period is the one the bill was computed for. Staff can
 * add or remove a damage, or commit an extension, after computing the bill, so
 * payment must not be taken on a stale one.
 */
export async function isDropBillInSync(
  bookingId: number,
  sessionId: number,
  tx?: TxClient,
): Promise<boolean> {
  const db = tx ?? prisma;
  const [reports, entries, session, booking] = await Promise.all([
    db.damageReport.findMany({
      where: { bookingId, chargedAtDrop: true },
      select: { publicId: true, finalCost: true, estimatedCost: true },
    }),
    db.ledgerEntry.findMany({
      where: { sessionId, isVoided: false, referenceType: DROP_DAMAGE_REF },
      select: { referenceId: true, amount: true },
    }),
    db.paymentSession.findUnique({ where: { id: sessionId }, select: { metadata: true } }),
    db.booking.findUnique({ where: { id: bookingId }, select: { endAt: true } }),
  ]);

  // Sessions computed before the period was recorded have no bookingEndAt to compare
  const computedEndAt = (session?.metadata as any)?.bookingEndAt as string | undefined;
  if (computedEndAt && booking && new Date(computedEndAt).getTime() !== booking.endAt.getTime()) {
    return false;
  }

  if (reports.length !== entries.length) return false;

  const billed = new Map(
    entries.map((e) => [e.referenceId, new Decimal(e.amount.toString())]),
  );
  return reports.every((r) => billed.get(r.publicId)?.eq(dropDamageAmount(r)) ?? false);
}

/**
 * Public ids (of those given) of charged drop damages that a COMPLETED RETURN
 * session actually billed — a non-voided DAMAGE line referencing the report.
 * Only those are settled; any other charged drop damage still has to be charged
 * by the manager.
 */
export async function billedOnCompletedDrop(
  damagePublicIds: string[],
  tx?: TxClient,
): Promise<Set<string>> {
  if (damagePublicIds.length === 0) return new Set();
  const db = tx ?? prisma;
  const entries = await db.ledgerEntry.findMany({
    where: {
      entryType: LedgerEntryType.DAMAGE,
      referenceType: DROP_DAMAGE_REF,
      referenceId: { in: damagePublicIds },
      isVoided: false,
      session: { sessionType: PaymentSessionType.RETURN, status: PaymentSessionStatus.COMPLETED },
    },
    select: { referenceId: true },
  });
  return new Set(entries.map((e) => e.referenceId!).filter(Boolean));
}
